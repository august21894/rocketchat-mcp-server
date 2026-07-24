#!/bin/sh

set -eu

usage() {
  cat <<'EOF'
Usage:
  sh scripts/deploy.sh check
  sh scripts/deploy.sh current [--yes]
  sh scripts/deploy.sh patch [--yes]
  sh scripts/deploy.sh minor [--yes]
  sh scripts/deploy.sh major [--yes]

Modes:
  check    Build and pack create-rocketchat-mcp without publishing.
  current  Publish create-rocketchat-mcp at its current version.
  patch    Bump only the initializer patch version, then publish it.
  minor    Bump only the initializer minor version, then publish it.
  major    Bump only the initializer major version, then publish it.

This script does not bump, build, or publish rocketchat-mcp-server. The
initializer keeps installing the runtime version pinned in
packages/create-rocketchat-mcp/package.json#rocketchatMcp.runtimeVersion.

Options:
  --yes    Skip the interactive publish confirmation (intended for trusted CI).
EOF
}

mode=${1:-}
confirm_flag=${2:-}

case "$mode" in
  check | current | patch | minor | major) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

case "$confirm_flag" in
  "" | --yes) ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
initializer_manifest="$project_dir/packages/create-rocketchat-mcp/package.json"
lockfile="$project_dir/package-lock.json"
cd "$project_dir"

for required_command in node npm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Error: required command not found: %s\n' "$required_command" >&2
    exit 1
  fi
done

if [ ! -f "$initializer_manifest" ] || [ ! -f "$lockfile" ]; then
  printf '%s\n' 'Error: initializer package.json or root package-lock.json is missing.' >&2
  exit 1
fi

initializer_name=$(node -p "require('./packages/create-rocketchat-mcp/package.json').name")
initializer_version=$(node -p "require('./packages/create-rocketchat-mcp/package.json').version")
runtime_version=$(
  node -p "require('./packages/create-rocketchat-mcp/package.json').rocketchatMcp.runtimeVersion"
)

is_git_repo=0
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  is_git_repo=1
  if [ -n "$(git status --porcelain)" ]; then
    if [ "$mode" = "check" ]; then
      printf '%s\n' 'Warning: Git worktree is not clean; check mode will continue.'
    else
      printf '%s\n' 'Error: Git worktree is not clean. Commit or stash changes before deploying.' >&2
      exit 1
    fi
  fi
else
  printf '%s\n' 'Warning: not inside a Git repository; no release commit or tag will be created.'
fi

version_backup_dir=
version_files_changed=0
publish_started=0

on_exit() {
  exit_status=$?
  trap - EXIT

  if [ "$exit_status" -ne 0 ] &&
    [ "$version_files_changed" -eq 1 ] &&
    [ "$publish_started" -eq 0 ] &&
    [ -n "$version_backup_dir" ] &&
    [ -d "$version_backup_dir" ]; then
    cp "$version_backup_dir/package-lock.json" "$lockfile"
    cp "$version_backup_dir/initializer-package.json" "$initializer_manifest"
    printf '%s\n' 'Release failed before publishing; restored initializer version files.' >&2
  fi

  if [ -n "$version_backup_dir" ] && [ -d "$version_backup_dir" ]; then
    rm -r "$version_backup_dir"
  fi
  exit "$exit_status"
}

trap on_exit EXIT
trap 'exit 130' HUP INT TERM

run_release_checks() {
  printf '\nRelease candidate:\n'
  printf '  %s@%s (installs rocketchat-mcp-server@%s)\n' \
    "$initializer_name" \
    "$initializer_version" \
    "$runtime_version"
  printf '%s\n' 'Running initializer release checks...'

  npm run format:check
  npm run typecheck:initializer
  npm run build:initializer
  npm run lint
  npm test
  npm pack --workspace="$initializer_name" --dry-run
}

bump_initializer_version() {
  version_backup_dir=$(mktemp -d "${TMPDIR:-/tmp}/rocketchat-mcp-initializer-release.XXXXXX")
  cp "$lockfile" "$version_backup_dir/package-lock.json"
  cp "$initializer_manifest" "$version_backup_dir/initializer-package.json"
  version_files_changed=1

  npm version "$mode" --workspace="$initializer_name" --no-git-tag-version
  initializer_version=$(node -p "require('./packages/create-rocketchat-mcp/package.json').version")

  printf '\nInitializer version updated:\n'
  printf '  %s@%s -> runtime %s\n' \
    "$initializer_name" \
    "$initializer_version" \
    "$runtime_version"
}

version_is_published() {
  check_name=$1
  check_version=$2
  published_output=$(npm view "$check_name@$check_version" version --json 2>/dev/null || true)

  [ "$published_output" = "$check_version" ] ||
    [ "$published_output" = "\"$check_version\"" ]
}

publish_initializer() {
  if version_is_published "$initializer_name" "$initializer_version"; then
    printf '\nSkipping %s@%s: already published.\n' "$initializer_name" "$initializer_version"
    return 0
  fi

  printf '\nPublishing initializer: %s@%s\n' "$initializer_name" "$initializer_version"
  case "$initializer_name" in
    @*) npm publish --workspace="$initializer_name" --access public ;;
    *) npm publish --workspace="$initializer_name" ;;
  esac
}

run_release_checks

if [ "$mode" = "check" ]; then
  printf '\nInitializer release checks passed. Nothing was published.\n'
  exit 0
fi

if ! npm whoami >/dev/null 2>&1; then
  printf '%s\n' 'Error: npm authentication is required. Run `npm login`, then retry.' >&2
  exit 1
fi

if [ "$confirm_flag" != "--yes" ]; then
  if [ ! -t 0 ]; then
    printf '%s\n' 'Error: interactive confirmation requires a TTY. Pass --yes only in trusted CI.' >&2
    exit 1
  fi

  if [ "$mode" = "current" ]; then
    action="publish $initializer_name@$initializer_version"
  else
    action="bump its $mode version and publish $initializer_name"
  fi

  printf '\nReady to %s. Continue? [y/N] ' "$action"
  read -r answer
  case "$answer" in
    y | Y | yes | YES) ;;
    *)
      printf '%s\n' 'Deploy cancelled. No version was changed and nothing was published.'
      exit 0
      ;;
  esac
fi

if [ "$mode" != "current" ]; then
  bump_initializer_version
fi

printf '\nRunning final initializer publish dry-run...\n'
npm publish --workspace="$initializer_name" --dry-run

# npm publication is irreversible. From this point onward, keep bumped metadata
# if publishing fails so the same initializer version can be retried.
publish_started=1
publish_initializer

printf '\nPublished initializer successfully:\n'
printf '  %s@%s (runtime %s)\n' \
  "$initializer_name" \
  "$initializer_version" \
  "$runtime_version"

if [ "$is_git_repo" -eq 1 ] && [ "$mode" != "current" ]; then
  release_tag="$initializer_name-v$initializer_version"
  git add "$lockfile" "$initializer_manifest"
  git commit -m "release: $initializer_name@$initializer_version"

  if git rev-parse -q --verify "refs/tags/$release_tag" >/dev/null 2>&1; then
    printf 'Warning: Git tag %s already exists; no new tag was created.\n' "$release_tag" >&2
  else
    git tag "$release_tag"
  fi

  printf '%s\n' 'Push the initializer release commit and tag with:'
  printf '%s\n' '  git push origin HEAD --follow-tags'
fi
