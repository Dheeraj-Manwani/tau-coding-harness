#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: bash server/scripts/ec2-server-only.sh [--prune-untracked]

Configure this Git checkout to contain only server/.

  --prune-untracked  Also permanently delete ignored and untracked items at
                     the repository root (for example node_modules/). Files
                     inside server/, including server/.env, are preserved.

Run this from a clean EC2 deployment checkout. Git sparse-checkout remains
enabled, so later `git pull --ff-only` commands fetch and materialize only the
server/ tree.
EOF
}

prune_untracked=false
case "${1:-}" in
  "") ;;
  --prune-untracked) prune_untracked=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: run this script from inside the Tau Git checkout" >&2
  exit 1
}
repo_root="$(cd "$repo_root" && pwd -P)"

if [[ ! -f "$repo_root/server/package.json" || ! -f "$repo_root/server/bun.lock" ]]; then
  echo "error: expected server/package.json and server/bun.lock in $repo_root" >&2
  exit 1
fi

tracked_changes="$(git -C "$repo_root" status --porcelain --untracked-files=no)"
if [[ -n "$tracked_changes" ]]; then
  echo "error: tracked changes are present; commit or discard them before pruning" >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 1
fi

echo "Configuring sparse checkout for server/ ..."
git -C "$repo_root" sparse-checkout init --no-cone
git -C "$repo_root" sparse-checkout set --no-cone /server/

if [[ "$prune_untracked" == true ]]; then
  echo "Deleting untracked and ignored root items outside server/ ..."
  while IFS= read -r -d '' item; do
    resolved_parent="$(cd "$(dirname "$item")" && pwd -P)"
    if [[ "$resolved_parent" != "$repo_root" ]]; then
      echo "error: refusing to delete path outside repository root: $item" >&2
      exit 1
    fi
    rm -rf -- "$item"
  done < <(
    find "$repo_root" -mindepth 1 -maxdepth 1 \
      ! -name .git \
      ! -name server \
      -print0
  )
fi

echo
echo "Server-only checkout ready at: $repo_root/server"
echo "Next:"
echo "  cd '$repo_root/server'"
echo "  bun install --frozen-lockfile"
echo "  bun run generate"
echo "  bunx playwright install --with-deps chromium"
echo "  bunx prisma migrate deploy"
echo "  bun run start"
