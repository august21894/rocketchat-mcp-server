#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Build the local MCP server and point Codex at dist/index.js.

Usage:
  bash scripts/use-local-codex.sh [options]

Options:
  --name <name>       Codex MCP server name (default: rocketchat).
  --env-file <path>   Environment file passed as ROCKETCHAT_ENV_FILE
                      (default: <project>/.env).
  --dry-run           Build and print the planned config change without writing it.
  -h, --help          Show this help.

Examples:
  npm run mcp:local
  npm run mcp:local -- --name rocketchat-local
  npm run mcp:local -- --env-file ./config/local.env
  npm run mcp:local -- --dry-run
EOF
}

server_name=rocketchat
env_file=
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      if [ "$#" -lt 2 ]; then
        printf '%s\n' 'Error: --name requires a value.' >&2
        exit 2
      fi
      server_name=$2
      shift 2
      ;;
    --env-file)
      if [ "$#" -lt 2 ]; then
        printf '%s\n' 'Error: --env-file requires a path.' >&2
        exit 2
      fi
      env_file=$2
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'Error: unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$server_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf '%s\n' 'Error: --name may contain only letters, numbers, dot, underscore and hyphen.' >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
cd "$project_dir"

for required_command in node npm codex; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Error: required command not found: %s\n' "$required_command" >&2
    exit 1
  fi
done

if [ -z "$env_file" ]; then
  env_file="$project_dir/.env"
elif [[ "$env_file" != /* ]]; then
  env_file="$project_dir/$env_file"
fi

if [ ! -f "$env_file" ]; then
  printf 'Error: environment file not found: %s\n' "$env_file" >&2
  printf '%s\n' 'Create it from .env.example or pass --env-file <path>.' >&2
  exit 1
fi

env_dir=$(CDPATH= cd -- "$(dirname -- "$env_file")" && pwd -P)
env_file="$env_dir/$(basename -- "$env_file")"

printf '%s\n' 'Building local MCP server...'
npm run build

node_path=$(node -p 'process.execPath')
server_path="$project_dir/dist/index.js"

if [ ! -f "$server_path" ]; then
  printf 'Error: build output not found: %s\n' "$server_path" >&2
  exit 1
fi

codex_home=${CODEX_HOME:-${HOME:?HOME is required}/.codex}
config_path="$codex_home/config.toml"
backup_path=

printf '\nLocal MCP configuration:\n'
printf '  name:     %s\n' "$server_name"
printf '  node:     %s\n' "$node_path"
printf '  server:   %s\n' "$server_path"
printf '  env file: %s\n' "$env_file"
printf '  config:   %s\n' "$config_path"

if [ "$dry_run" -eq 1 ]; then
  printf '\nDry run only. Planned Codex command:\n  '
  printf '%q ' codex mcp add "$server_name" --env "ROCKETCHAT_ENV_FILE=$env_file" -- \
    "$node_path" "$server_path"
  printf '\nNo Codex configuration was changed.\n'
  exit 0
fi

mkdir -p "$codex_home"
had_config=0
if [ -f "$config_path" ]; then
  had_config=1
  backup_path=$(mktemp "$config_path.bak.XXXXXX")
  cp "$config_path" "$backup_path"
  printf '  backup:   %s\n' "$backup_path"
fi

restore_config() {
  local status=$1
  trap - ERR

  if [ "$had_config" -eq 1 ] && [ -n "$backup_path" ] && [ -f "$backup_path" ]; then
    cp "$backup_path" "$config_path"
    printf '\nConfiguration failed; restored %s from backup.\n' "$config_path" >&2
  elif [ "$had_config" -eq 0 ] && [ -f "$config_path" ]; then
    rm -f "$config_path"
    printf '\nConfiguration failed; removed the newly created config file.\n' >&2
  fi

  exit "$status"
}
trap 'restore_config "$?"' ERR

if codex mcp get "$server_name" >/dev/null 2>&1; then
  codex mcp remove "$server_name"
fi

codex mcp add \
  "$server_name" \
  --env "ROCKETCHAT_ENV_FILE=$env_file" \
  -- \
  "$node_path" \
  "$server_path"

trap - ERR

printf '\nCodex MCP configured successfully:\n'
codex mcp get "$server_name"
printf '\nStart a new Codex session, then use /mcp to verify the local server.\n'
