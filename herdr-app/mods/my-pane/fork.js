// my-pane: Fork, a copy of the Claude conversation a pane shows, started beside it. The copy is
// `claude --resume <session> --fork-session`, Claude Code's own way to branch off a session that
// runs elsewhere (in another terminal, or in the background): it gets a new id, so the two never
// share one session. Pure but FIND, a shell script for exec (node test: .dev/test/fork.test.mjs).

// Which session a pane's foreground program (`hc get`: foreground.argv) shows: { attach: <x> }
// for `claude attach <x>` (a background session: its id, the start of it, or its name),
// { attach: null } for Claude itself; null for anything else.
export function claudeIn(argv) {
  if (!Array.isArray(argv) || !argv.length || String(argv[0]).split("/").pop() !== "claude") return null;
  const n = argv.length;
  if (argv[1] === "attach") return n >= 3 && argv[n - 1] ? { attach: String(argv[n - 1]) } : null;
  return { attach: null };
}

// Claude Code's own records, printed one per line on the pane's machine. $1: the foreground
// process; $2: what `claude attach` was given, or "". Claude itself: its entry in
// ~/.claude/sessions/<pid>.json (every running session's, kept by Claude: the session it shows
// now, its folder and name). A background session: its job's state.json, found by the start of
// its id (each job folder is named by the id's first 8 characters), or all of them for a name.
// JSON keeps newlines inside strings escaped, so dropping the file's own makes it one line.
export const FIND = String.raw`c="$HOME/.claude"
if [ -z "$2" ]; then
  set -- "$c/sessions/$1.json"
else
  case $2 in
    *[!0-9a-fA-F-]*) set -- "$c"/jobs/*/state.json ;;
    *) set -- "$c"/jobs/"$(printf '%.8s' "$2")"*/state.json ;;
  esac
fi
for f in "$@"; do [ -f "$f" ] && { tr -d '\n' < "$f"; echo; }; done
exit 0`;

const isId = (s) => /^[0-9a-f-]{4,}$/i.test(s);

// FIND's output → { session, cwd, name } (null: none). For `claude attach <x>`: the job whose
// session id starts with x, or that is named x; the latest one when several fit.
export function pick(out, attach) {
  const recs = [];
  for (const line of String(out ?? "").split("\n")) {
    let r = null;
    try { r = JSON.parse(line); } catch {}
    if (r && typeof r === "object" && typeof r.sessionId === "string" && r.sessionId) recs.push(r);
  }
  const fits = attach ? recs.filter((r) => (isId(attach) ? r.sessionId.startsWith(attach) : r.name === attach)) : recs.slice(0, 1);
  const when = (r) => Date.parse(r.updatedAt) || Number(r.updatedAt) || 0;
  const r = fits.reduce((a, b) => (a && when(a) >= when(b) ? a : b), null);
  if (!r) return null;
  return { session: r.sessionId, cwd: typeof r.cwd === "string" && r.cwd ? r.cwd : null, name: String(r.name ?? "").trim() || null };
}

// The copy's name, as Claude Code names its own forks: "<name> (fork)", then "(fork 2)", ...
export function forkName(name) {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const m = /^(.*) \(fork(?: (\d{1,15}))?\)$/.exec(s);
  return m ? `${m[1]} (fork ${Number(m[2] ?? 1) + 1})` : `${s} (fork)`;
}

// The command that starts the copy. Unnamed, it would take the session's own name.
export function forkArgv(found) {
  const name = forkName(found?.name);
  return ["claude", "--resume", found.session, "--fork-session", ...(name ? ["-n", name] : [])];
}
