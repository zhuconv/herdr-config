#!/bin/bash
# Copies this Mac's live Herdr setup into the repo, then commits and pushes it, so the
# other Macs can `git pull && ./install.sh`.
set -euo pipefail
cd "$(dirname "$0")"
. ./paths.sh

for item in "${ITEMS[@]}"; do
  dst=${item%%|*} src=${item#*|}
  if [ ! -e "${src%/}" ]; then
    echo "skipped (not on this Mac): $src"
    continue
  fi
  mkdir -p "$(dirname "${dst%/}")"
  rsync -a --delete "${SKIP[@]}" "$src" "$dst"
done
rc=$(raycast_script)
[ -f "$rc" ] && cp "$rc" raycast/herdr-waiting.sh

git add -A
if git diff --cached --quiet; then
  echo "Nothing changed."
else
  git commit -q -m "Update from $(scutil --get ComputerName 2>/dev/null || hostname)"
  git push -q
  git log -1 --stat --format="Pushed: %s"
fi
