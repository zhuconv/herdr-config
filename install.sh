#!/bin/bash
# Sets this Mac's Herdr up like the others: keys, the my-main layout, the mods, the theme,
# the Claude Code (and Codex) hook behind the ⌃Tab cards, the hc-workers and hc-find skills (for
# Claude Code and Codex), Claude Code's short command names (/ren, /u, /m, /st), and the Raycast
# ⌘G script.
# Safe to run again to update. Anything it replaces is copied first to
# ~/.config/herdr-app.backup-<time>/ (paths relative to your home folder).
#
#   ./install.sh --remote <machine>   (a machine from `hc machine ls`)
# puts the hook on that machine, so Claude and Codex sessions running there in Herdr terminals
# fill their ⌃Tab cards too (codex there runs --no-daemon in them, and Codex is asked to trust the
# hook), the hc-workers and hc-find skills, so an agent there can be a manager and find a
# session by its name, and the short command names. It needs python3 there.
set -euo pipefail
cd "$(dirname "$0")"

# Codex in Herdr's terminals runs its sessions itself (--no-daemon), so the hook knows their
# terminal: the codex shell function in agent-plugin/codex/codex.sh, loaded by this line in ~/.bashrc and
# ~/.zshrc (each one there, and the login shell's even if not yet; added once, after a copy).
RC_LINE='if [ -f "$HOME/.local/share/agent-note/codex.sh" ]; then . "$HOME/.local/share/agent-note/codex.sh"; fi  # agent-note: Codex in Herdr terminals (herdr-config agent-plugin/codex/codex.sh)'
ADD_RC='for f in "$HOME/.bashrc" "$HOME/.zshrc"; do
  case $f in */."${SHELL##*/}"rc) ;; *) [ -f "$f" ] || continue ;; esac
  grep -qsF share/agent-note/codex.sh "$f" && continue
  if [ -f "$f" ]; then cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"; fi
  printf "\n%s\n" "$1" >>"$f" && echo "codex in Herdr terminals runs --no-daemon: loaded from $f"
done'
# codex-hooks-trust on a machine: does Codex there trust the hooks (and trust them if not). A Vista
# login node runs no Codex, so there it runs on a compute node of yours, which has the same home.
trust_on() { # machine
  case $1 in
    vista | vista2 | vista3)
      hc exec --on "$1" -- bash -c 'n=$(squeue --me -h -t R -o %N 2>/dev/null | head -1)
        n=$(scontrol show hostnames "$n" 2>/dev/null | head -1)
        if [ -z "$n" ]; then echo "codex-hooks-trust: not run (no compute node of yours is running); the codex command runs it on one."; exit 0; fi
        timeout 120 ssh -o ConnectTimeout=10 "$n" .local/bin/codex-hooks-trust </dev/null' || true ;;
    *) hc exec --on "$1" -- .local/bin/codex-hooks-trust || true ;;
  esac
}

if [ "${1:-}" = "--remote" ]; then
  m=${2:?usage: ./install.sh --remote <machine>}
  hc file write --on "$m" .local/bin/agent-note <agent-plugin/shared/agent-note >/dev/null
  hc exec --on "$m" -- chmod +x .local/bin/agent-note
  hc exec --on "$m" -i -- python3 - <agent-plugin/claude/add-agent-note.py
  hc exec --on "$m" -i -- python3 - <agent-plugin/codex/add-agent-note.py
  hc exec --on "$m" -- mkdir -p .local/share/agent-note
  hc file write --on "$m" .local/share/agent-note/codex.sh <agent-plugin/codex/codex.sh >/dev/null
  hc file write --on "$m" .local/bin/codex-hooks-trust <agent-plugin/codex/codex-hooks-trust >/dev/null
  hc exec --on "$m" -- chmod +x .local/bin/codex-hooks-trust
  hc exec --on "$m" -- sh -c "$ADD_RC" sh "$RC_LINE"
  trust_on "$m"
  # The skills as on a Mac (see below): one copy in ~/.agents/skills, a link in ~/.claude/skills.
  for s in hc-workers hc-find; do
    hc exec --on "$m" -- rm -rf ".agents/skills/$s"
    for f in "agent-plugin/shared/skills/$s"/*; do
      hc file write --on "$m" ".agents/skills/$s/${f##*/}" <"$f" >/dev/null
    done
    hc exec --on "$m" -- sh -c 'd=$HOME/.claude/skills/$1; mkdir -p "${d%/*}"
      if [ -L "$d" ] || [ ! -e "$d" ]; then ln -sfn "../../.agents/skills/$1" "$d"
      else echo "$d is a folder, so Claude Code keeps that copy" >&2; fi' sh "$s"
  done
  # Claude Code's mods in ~/.claude/mods, loaded by new sessions: the short command names, and
  # accounts (/auth, and the account tag on artifact links).
  (cd agent-plugin/claude/mods && find short-names accounts -type f ! -name .DS_Store ! -name tsconfig.json ! -path '*/.claude-plugin/types/*') | while read -r f; do
    hc file write --on "$m" ".claude/mods/$f" <"agent-plugin/claude/mods/$f" >/dev/null
  done
  hc exec --on "$m" -i -- python3 - <agent-plugin/claude/add-mods.py
  # The accounts mod's table of aliases and emails, readable by its owner only.
  table="$HOME/.config/claude-accounts/accounts.json"
  if [ -f "$table" ]; then
    hc exec --on "$m" -i -- sh -c 'umask 077; d=$HOME/.config/claude-accounts
      mkdir -p "$d" && cat >"$d/accounts.json" && chmod 600 "$d/accounts.json"' <"$table"
  fi
  echo "$m: agent-note, the codex function, the hc-workers and hc-find skills, the short command names and /auth are in place. Claude sessions there pick up the hook on their next prompt, Codex ones when they start; new shells and sessions see the rest."
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
  if [ -e "${dst%/}" ] && ! diff -rq -x gpui-kit.d.ts -x jsconfig.json -x .DS_Store -x tsconfig.json -x types "${src%/}" "${dst%/}" >/dev/null 2>&1; then
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
link_skill hc-find

# Claude Code: run agent-note on UserPromptSubmit, Stop, SessionStart, PreCompact and
# PermissionRequest (added once, never twice). Codex: the same hook, trusted (only where Codex has run, ~/.codex).
python3 agent-plugin/claude/add-agent-note.py
python3 agent-plugin/codex/add-agent-note.py
# Claude Code's mods (agent-plugin/claude/mods/short-names and accounts, put in ~/.claude/mods by
# paths.sh): every new session loads them.
python3 agent-plugin/claude/add-mods.py
# Codex in Herdr's terminals runs --no-daemon (see RC_LINE above), and Codex is asked whether it
# trusts the hooks, which are then trusted with its own hashes if not.
sh -c "$ADD_RC" sh "$RC_LINE"
chmod +x "$HOME/.local/bin/codex-hooks-trust"
"$HOME/.local/bin/codex-hooks-trust" || true

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
