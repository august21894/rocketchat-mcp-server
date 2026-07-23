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
  check    Check and pack both packages without changing versions or publishing.
  current  Publish both packages at their current versions.
  patch    Bump both package patch versions, then publish runtime followed by initializer.
  minor    Bump both package minor versions, then publish runtime followed by initializer.
  major    Bump both package major versions, then publish runtime followed by initializer.

Publish order:
  1. rocketchat-mcp-server
  2. create-rocketchat-mcp

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
cd "$project_dir"

for required_command in node npm; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Error: required command not found: %s\n' "$required_command" >&2
    exit 1
  fi
done

if [ ! -f package.json ] || [ ! -f "$initializer_manifest" ]; then
  printf '%s\n' 'Error: runtime or initializer package.json is missing.' >&2
  exit 1
fi

runtime_name=$(node -p "require('./package.json').name")
runtime_version=$(node -p "require('./package.json').version")
initializer_name=$(node -p "require('./packages/create-rocketchat-mcp/package.json').name")
initializer_version=$(node -p "require('./packages/create-rocketchat-mcp/package.json').version")
compatible_runtime_version=$(
  node -p "require('./packages/create-rocketchat-mcp/package.json').rocketchatMcp.runtimeVersion"
)

is_git_repo=0
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  is_git_repo=1
  if [ -n "$(git status --porcelain)" ]; then
    printf '%s\n' 'Error: Git worktree is not clean. Commit or stash changes before deploying.' >&2
    exit 1
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
    cp "$version_backup_dir/package.json" "$project_dir/package.json"
    cp "$version_backup_dir/package-lock.json" "$project_dir/package-lock.json"
    cp "$version_backup_dir/initializer-package.json" "$initializer_manifest"
    printf '%s\n' 'Release failed before publishing; restored package version files.' >&2
  fi

  if [ -n "$version_backup_dir" ] && [ -d "$version_backup_dir" ]; then
    rm -r "$version_backup_dir"
  fi
  exit "$exit_status"
}

trap on_exit EXIT
trap 'exit 130' HUP INT TERM

validate_version_link() {
  if [ "$compatible_runtime_version" != "$runtime_version" ]; then
    printf 'Error: %s@%s targets runtime %s, but the runtime package is %s.\n' \
      "$initializer_name" \
      "$initializer_version" \
      "$compatible_runtime_version" \
      "$runtime_version" >&2
    printf '%s\n' \
      'Update packages/create-rocketchat-mcp/package.json#rocketchatMcp.runtimeVersion.' >&2
    return 1
  fi
}

run_release_checks() {
  validate_version_link

  printf '\nRelease candidates:\n'
  printf '  1. %s@%s\n' "$runtime_name" "$runtime_version"
  printf '  2. %s@%s (runtime %s)\n' \
    "$initializer_name" \
    "$initializer_version" \
    "$compatible_runtime_version"
  printf '%s\n' 'Running release checks for both packages...'

  npm run format:check
  npm run typecheck
  npm run typecheck:initializer
  npm run build:all
  npm run lint
  npm test
  npm pack --dry-run
  npm pack --workspace="$initializer_name" --dry-run
}

bump_versions() {
  version_backup_dir=$(mktemp -d "${TMPDIR:-/tmp}/rocketchat-mcp-release.XXXXXX")
  cp package.json "$version_backup_dir/package.json"
  cp package-lock.json "$version_backup_dir/package-lock.json"
  cp "$initializer_manifest" "$version_backup_dir/initializer-package.json"
  version_files_changed=1

  npm version "$mode" --no-git-tag-version
  npm version "$mode" --workspace="$initializer_name" --no-git-tag-version

  runtime_version=$(node -p "require('./package.json').version")
  initializer_version=$(node -p "require('./packages/create-rocketchat-mcp/package.json').version")
  npm pkg set "rocketchatMcp.runtimeVersion=$runtime_version" --workspace="$initializer_name"
  compatible_runtime_version=$(
    node -p "require('./packages/create-rocketchat-mcp/package.json').rocketchatMcp.runtimeVersion"
  )

  validate_version_link
  printf '\nVersions updated:\n'
  printf '  %s@%s\n' "$runtime_name" "$runtime_version"
  printf '  %s@%s -> runtime %s\n' \
    "$initializer_name" \
    "$initializer_version" \
    "$compatible_runtime_version"
}

version_is_published() {
  check_name=$1
  check_version=$2
  published_output=$(npm view "$check_name@$check_version" version --json 2>/dev/null || true)

  [ "$published_output" = "$check_version" ] ||
    [ "$published_output" = "\"$check_version\"" ]
}

publish_runtime() {
  if version_is_published "$runtime_name" "$runtime_version"; then
    printf '\nSkipping %s@%s: already published.\n' "$runtime_name" "$runtime_version"
    return 0
  fi

  printf '\nPublishing runtime first: %s@%s\n' "$runtime_name" "$runtime_version"
  case "$runtime_name" in
    @*) npm publish --access public ;;
    *) npm publish ;;
  esac
}

publish_initializer() {
  if version_is_published "$initializer_name" "$initializer_version"; then
    printf '\nSkipping %s@%s: already published.\n' "$initializer_name" "$initializer_version"
    return 0
  fi

  printf '\nPublishing initializer second: %s@%s\n' "$initializer_name" "$initializer_version"
  case "$initializer_name" in
    @*) npm publish --workspace="$initializer_name" --access public ;;
    *) npm publish --workspace="$initializer_name" ;;
  esac
}

run_release_checks

if [ "$mode" = "check" ]; then
  printf '\nRelease checks passed for both packages. Nothing was published.\n'
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
    action="publish both current package versions"
  else
    action="bump both $mode versions and publish both packages"
  fi

  printf '\nReady to %s (runtime first, initializer second). Continue? [y/N] ' "$action"
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
  bump_versions
fi

printf '\nRunning final publish dry-runs...\n'
npm publish --dry-run
npm publish --workspace="$initializer_name" --dry-run

# npm publication is irreversible. From this point onward, keep bumped metadata
# if a later publish fails so the remaining package can be retried at the same version.
publish_started=1

runtime_status=0
publish_runtime || runtime_status=$?
if [ "$runtime_status" -ne 0 ]; then
  printf '\nRuntime publish failed; initializer was not published.\n' >&2
  exit "$runtime_status"
fi

initializer_status=0
publish_initializer || initializer_status=$?
if [ "$initializer_status" -ne 0 ]; then
  printf '\nRuntime is published, but initializer publish failed.\n' >&2
  printf 'Retry only the initializer with:\n  npm publish --workspace=%s\n' \
    "$initializer_name" >&2
  exit "$initializer_status"
fi

printf '\nPublished release successfully:\n'
printf '  %s@%s\n' "$runtime_name" "$runtime_version"
printf '  %s@%s\n' "$initializer_name" "$initializer_version"

if [ "$is_git_repo" -eq 1 ] && [ "$mode" != "current" ]; then
  release_tag="v$runtime_version"
  git add package.json package-lock.json "$initializer_manifest"
  git commit -m "release: $runtime_name@$runtime_version and $initializer_name@$initializer_version"

  if git rev-parse -q --verify "refs/tags/$release_tag" >/dev/null 2>&1; then
    printf 'Warning: Git tag %s already exists; no new tag was created.\n' "$release_tag" >&2
  else
    git tag "$release_tag"
  fi

  printf '%s\n' 'Push the release commit and tag with:'
  printf '%s\n' '  git push origin HEAD --follow-tags'
fi
