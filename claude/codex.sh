# agent-note's codex wrapper, for bash and zsh (herdr-config claude/codex.sh). install.sh copies it
# to ~/.local/share/agent-note/codex.sh and loads it from ~/.bashrc and ~/.zshrc.
#
# In a Herdr terminal (hc's: $HC_TERMINAL_ID is set), a Codex you start runs its session itself
# (--no-daemon). By default Codex hands sessions to a shared background server, which runs their
# hooks with its own environment: the agent-note hook then can't tell which terminal a session is
# in, and Herdr gets no ⌃Tab card text or approval notes for it. resume and fork take the flag
# after their name. Other subcommands (exec, login, mcp, …), and a command that has the flag
# already, go as typed. A program that starts the codex binary itself (`exec codex`, `hc run --
# codex`, Claude's Codex plugin) doesn't come through here.
#
# Once after the codex program changes (an update), a codex command first runs codex-hooks-trust:
# it asks Codex whether it still trusts the agent-note hooks, and trusts them again if not. A new
# Codex may hash hooks differently, and an untrusted hook makes every Codex start wait at "Hooks
# need review", which a Codex that a relay or a manager starts can't answer.

_agent_note_codex_trust() {
  local bin now seen state="$HOME/.local/state/agent-note/codex-checked"
  [ -x "$HOME/.local/bin/codex-hooks-trust" ] || return 0
  if [ -n "${ZSH_VERSION-}" ]; then bin=$(whence -p codex); else bin=$(type -P codex); fi
  [ -n "$bin" ] || return 0
  now=$(command ls -lL "$bin" 2>/dev/null) || return 0
  { read -r seen <"$state"; } 2>/dev/null
  [ "$now" = "$seen" ] && return 0
  "$HOME/.local/bin/codex-hooks-trust" --quiet
  mkdir -p "${state%/*}" && printf '%s\n' "$now" >"$state"
}

codex() {
  _agent_note_codex_trust
  if [ -n "${HC_TERMINAL_ID-}" ]; then
    local a sub
    for a in "$@"; do
      [ "$a" = --no-daemon ] && { command codex "$@"; return; }
    done
    case "${1-}" in
      resume | fork)
        sub=$1
        shift
        command codex "$sub" --no-daemon "$@"
        return
        ;;
      agents | exec | e | review | login | logout | mcp | plugin | app-server | remote-control | app | \
        completion | update | doctor | sandbox | debug | apply | a | queue | archive | delete | unarchive | \
        migrate-rollouts | migrate-nfs-db | cloud | exec-server | features | help) ;;
      *)
        command codex --no-daemon "$@"
        return
        ;;
    esac
  fi
  command codex "$@"
}
