#!/bin/bash
# Sets this Mac's Herdr up like the others: keys, the my-main layout, the mods, the theme,
# the Claude Code (and Codex) hook behind the ⌃Tab cards, the hc-workers skill (for Claude Code and
# Codex), and the Raycast ⌘G script.
# Safe to run again to update. Anything it replaces is copied first to
# ~/.config/herdr-app.backup-<time>/ (paths relative to your home folder).
#
#   ./install.sh --remote <machine>   (a machine from `hc machine ls`)
# puts the hook on that machine, so Claude sessions running there in Herdr terminals fill
# their ⌃Tab cards too (and Codex ones run --no-daemon), and the hc-workers skill, so an agent
# there can be a manager. It needs python3 there.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--remote" ]; then
  m=${2:?usage: ./install.sh --remote <machine>}
  hc file write --on "$m" .local/bin/agent-note <claude/agent-note >/dev/null
  hc exec --on "$m" -- chmod +x .local/bin/agent-note
  hc exec --on "$m" -i -- python3 - <claude/merge-hooks.py
  hc exec --on "$m" -i -- python3 - <claude/merge-codex-hooks.py
  # The skill as on a Mac (see below): one copy in ~/.agents/skills, a link in ~/.claude/skills.
  hc exec --on "$m" -- rm -rf .agents/skills/hc-workers
  for f in skills/hc-workers/*; do
    hc file write --on "$m" ".agents/skills/hc-workers/${f##*/}" <"$f" >/dev/null
  done
  hc exec --on "$m" -- sh -c 'd=$HOME/.claude/skills/hc-workers; mkdir -p "${d%/*}"
    if [ -L "$d" ] || [ ! -e "$d" ]; then ln -sfn ../../.agents/skills/hc-workers "$d"
    else echo "$d is a folder, so Claude Code keeps that copy" >&2; fi'
  echo "$m: agent-note and the hc-workers skill are in place. Claude sessions there pick up the hook on their next prompt, Codex ones when they start; new sessions see the skill."
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

# Skills are laid out as `npx skills` installs them: one copy in ~/.agents/skills (paths.sh puts it
# there), which Codex reads, and a link to it in ~/.claude/skills for Claude Code.
link_skill() { # name
  local d="$HOME/.claude/skills/$1"
  [ "$(readlink "$d" 2>/dev/null)" = "../../.agents/skills/$1" ] && return
  if [ -e "$d" ] || [ -L "$d" ]; then keep "$d"; rm -rf "$d"; fi
  mkdir -p "$HOME/.claude/skills"
  ln -s "../../.agents/skills/$1" "$d"
}
link_skill hc-workers

# Claude Code: run agent-note on UserPromptSubmit, Stop, SessionStart and PreCompact (added once,
# never twice). Codex: the same hook, trusted (only where Codex has run, ~/.codex).
python3 claude/merge-hooks.py
python3 claude/merge-codex-hooks.py

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
