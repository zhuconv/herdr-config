#!/bin/bash
# Sets this Mac's Herdr up like the others: keys, the my-main layout, the mods, the theme,
# the Claude Code hook behind the ⌃Tab cards, and the Raycast ⌘G script.
# Safe to run again to update. Anything it replaces is copied first to
# ~/.config/herdr-app.backup-<time>/ (paths relative to your home folder).
#
#   ./install.sh --remote <machine>   (a machine from `hc machine ls`)
# puts only the hook on that machine, so Claude sessions running there in Herdr
# terminals fill their ⌃Tab cards too. It needs python3 there.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--remote" ]; then
  m=${2:?usage: ./install.sh --remote <machine>}
  hc file write --on "$m" .local/bin/agent-note <claude/agent-note >/dev/null
  hc exec --on "$m" -- chmod +x .local/bin/agent-note
  hc exec --on "$m" -i -- python3 - <claude/merge-hooks.py
  echo "$m: agent-note is in place. Sessions there pick it up on their next prompt."
  exit 0
fi

. ./paths.sh

if [ ! -d "$H" ]; then
  echo "Herdr isn't set up yet: install it and open it once, then run this again." >&2
  exit 1
fi

backup="$HOME/.config/herdr-app.backup-$(date +%Y%m%d-%H%M%S)"
keep() { # keep <live path>: copy it into the backup before it changes
  local rel="${1#"$HOME"/}"
  mkdir -p "$backup/$(dirname "$rel")"
  cp -R "$1" "$backup/$rel"
}

for item in "${ITEMS[@]}"; do
  src=${item%%|*} dst=${item#*|}
  if [ -e "${dst%/}" ] && ! diff -rq -x gpui-kit.d.ts -x jsconfig.json -x .DS_Store "${src%/}" "${dst%/}" >/dev/null 2>&1; then
    keep "${dst%/}"
  fi
  mkdir -p "$(dirname "${dst%/}")"
  rsync -a --delete "${SKIP[@]}" "$src" "$dst"
done
chmod +x "$HOME/.local/bin/agent-note"

# Claude Code: run agent-note on UserPromptSubmit, Stop and SessionStart (added once, never twice).
python3 claude/merge-hooks.py

# Small C helpers. The Command Line Tools' default SDK can be newer than its compiler; then an
# older SDK that links is used.
build_c() { # source, binary
  for sdk in "" $(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null | sort -r); do
    clang -O2 ${sdk:+-isysroot "$sdk"} -framework ApplicationServices -o "$2" "$1" 2>/dev/null && return 0
  done
  return 1
}
# postkey hands ⌘G back to VS Code.
build_c "$HOME/.local/share/postkey/postkey.c" "$HOME/.local/bin/postkey" \
  || echo "postkey wasn't built (needs the Xcode Command Line Tools): ⌘G in VS Code won't find-next."
# herdr-optwatch tells the Projects panel when ⌥ is held, to show the projects' ⌥1–⌥9 numbers.
build_c "$H/mods/my-projects/optwatch.c" "$HOME/.local/bin/herdr-optwatch" \
  || echo "herdr-optwatch wasn't built (needs the Xcode Command Line Tools): holding ⌥ won't number the projects."

rc=$(raycast_script)
mkdir -p "$(dirname "$rc")"
[ -e "$rc" ] && ! cmp -s raycast/herdr-waiting.sh "$rc" && keep "$rc"
cp raycast/herdr-waiting.sh "$rc"
chmod +x "$rc"

herdr-app do layout.switch --name my-main >/dev/null 2>&1 || true

[ -d "$backup" ] && echo "Replaced files were saved in $backup"
cat <<EOF
Done. Herdr picks the changes up live (in Herdr, ⌘⇧L switches layouts if my-main isn't shown).
Two steps only you can do, once per Mac:
  1. Raycast → Settings → Extensions: if "Go to Waiting Agent" isn't listed, press + →
     Add Script Directory → $(dirname "$rc"). Then record ⌘G as its hotkey.
  2. System Settings → Privacy & Security → Accessibility: allow Raycast
     (so ⌘G still does find-next in VS Code).
EOF
