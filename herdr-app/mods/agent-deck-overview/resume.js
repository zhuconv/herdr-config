// agent-deck: a herdr-resume:// link for a running Claude Code agent (Copy link on its card).
// Herdr doesn't know an agent's session id: Claude Code keeps ~/.claude/sessions/<pid>.json
// ({pid, sessionId, …}) while it runs, so the link comes from the pid of the terminal's
// program. The link format is Martin Krcho's (agent-deck-history, resume-link/ in the repo).
// No imports, so node can test it (resume.test.mjs).

// On the agent's machine, with the pid as $1: that pid's session file, then `found` when the
// session's transcript exists (none before the first message: a link would reach nothing).
export const SESSION_OF = String.raw`f="$HOME/.claude/sessions/$1.json"; [ -f "$f" ] || exit 0
cat "$f"; echo
id=$(grep -oE '"sessionId":"[0-9a-f-]{36}"' "$f" | head -1 | cut -d'"' -f4)
[ -n "$id" ] || exit 0
for t in "$HOME"/.claude/projects/*/"$id".jsonl; do [ -f "$t" ] && echo found && break; done
exit 0`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The session id from SESSION_OF's output, when it is that pid's and its transcript exists.
export function sessionFrom(out, pid) {
  const [first, second] = (out ?? "").split("\n");
  let d;
  try { d = JSON.parse(first); } catch { return null; }
  return d?.pid === pid && UUID.test(d?.sessionId ?? "") && second === "found" ? d.sessionId : null;
}

export const resumeLink = (machine, id) => `herdr-resume://${machine ?? "local"}/${id}`;
export const machineOf = (address) => (address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : null);
