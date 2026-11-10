#!/bin/bash
# Sets this Mac's Herdr up like the others: keys, the my-main layout, the mods, the theme,
# the Claude Code hook behind the ⌃Tab cards, and the Raycast ⌘G script.
# Safe to run again to update. Anything it replaces is copied first to
# ~/.config/herdr-app.backup-<time>/ (paths relative to your home folder).
set -euo pipefail
cd "$(dirname "$0")"
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

# Claude Code: run agent-note on UserPromptSubmit and Stop (added once, never twice).
settings="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
[ -f "$settings" ] || echo '{}' >"$settings"
hook='{"type":"command","command":"\"$HOME/.local/bin/agent-note\"","timeout":5,"async":true}'
jq --argjson h "$hook" '
  def add(ev): .hooks[ev] = ((.hooks[ev] // [])
    | if any(.[]?.hooks[]?; (.command // "") | test("agent-note")) then . else . + [{hooks: [$h]}] end);
  add("UserPromptSubmit") | add("Stop")' "$settings" >"$settings.new"
if jq -e . "$settings.new" >/dev/null && ! jq -S . "$settings" | cmp -s - <(jq -S . "$settings.new"); then
  keep "$settings"
  mv "$settings.new" "$settings"
  echo "Claude Code: hooks added to ~/.claude/settings.json"
else
  rm -f "$settings.new"
fi

# postkey hands ⌘G back to VS Code. The Command Line Tools' default SDK can be newer
# than its compiler; then an older SDK that links is used.
src="$HOME/.local/share/postkey/postkey.c" out="$HOME/.local/bin/postkey"
built=""
for sdk in "" $(ls -d /Library/Developer/CommandLineTools/SDKs/MacOSX[0-9]*.sdk 2>/dev/null | sort -r); do
  if clang -O2 ${sdk:+-isysroot "$sdk"} -framework ApplicationServices -o "$out" "$src" 2>/dev/null; then built=1; break; fi
done
[ -n "$built" ] || echo "postkey wasn't built (needs the Xcode Command Line Tools): ⌘G in VS Code won't find-next."

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
