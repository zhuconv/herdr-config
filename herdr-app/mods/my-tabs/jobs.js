// my-tabs: Claude Code's background sessions, as Herdr's agents. A pane running `claude attach
// <id>` reports nothing to Herdr, so Herdr neither knows its state nor tells you when it finishes.
// Claude Code keeps each session's own record in ~/.claude/jobs/<id>/state.json: main.js watches
// that folder here, and on another machine the agent-note hook reads it and puts the state on
// the session's terminals (note.bg). This file reads either the way Herdr reads an agent's
// report (model.rs set_word, alert). Pure (node test: .dev/test/jobs.test.mjs).

// A session that isn't running and waits for a prompt to start it again, in Claude Code's words.
const DORMANT = "send a prompt to start";

// A record's state as Herdr shows an agent's: "working", "blocked" (needs you), "done" (the turn
// ended: it shows until you look) or "idle"; null for no record.
// tempo says what's happening now: "active" from the moment a prompt arrives (while state still
// says how the last turn ended) until the turn ends; "blocked" while it waits for you. "idle":
// the turn ended, and state says how: "done", "blocked", or "working" when it waits on work of
// its own (a background task, a sub-agent), which wakes it again. Anything else is idle.
// claude/agent-note has the same rules (job_status), for other machines.
export function jobStatus(r) {
  if (!r || typeof r !== "object") return null;
  if (r.tempo === "active") return "working";
  if (r.tempo === "blocked") return r.needs === DORMANT ? "idle" : "blocked";
  if (r.state === "working" || r.state === "starting" || r.state === "resuming") return "working";
  if (r.state === "blocked") return "blocked";
  if (r.state === "done") return "done";
  return "idle";
}

// A record here, as the tracker takes it: its state, and what tells one ending from the next
// (its one-line detail: other fields change while it sits idle). null for none.
export function fromRecord(r) {
  const status = jobStatus(r);
  return status ? { status, end: String(r.detail ?? ""), name: r.name ?? null, session: r.sessionId ?? null } : null;
}

// The hook's label on another machine's session terminal (note.bg = "<state> <job> <time>": the
// record's time when it was written, the same until the next change). null when it isn't one.
export function fromNote(value) {
  const m = /^(working|blocked|done|idle) ([0-9a-f]{6,}) (\S+)$/.exec(String(value ?? "").trim());
  return m ? { status: m[1], job: m[2], end: m[3], name: null, session: null } : null;
}

// The session a pane shows, from its foreground program (Herdr's terminals(): foreground.argv):
// the id (or its start, or the session's name) after `claude attach`; null for anything else.
export function attachedTo(argv) {
  if (!Array.isArray(argv) || argv.length < 3 || argv[argv.length - 2] !== "attach") return null;
  return String(argv[0]).split("/").pop() === "claude" ? String(argv[argv.length - 1]) || null : null;
}

// Whether an attach argument can name a job: its id or the start of it (or a name, which can't
// be checked here).
export const matches = (id, job) => !/^[0-9a-f-]{4,}$/i.test(id) || job.startsWith(id) || id.startsWith(job);

// Each session's state, and when to tell you about it. A session here is known by its job (its
// folder's name), one on another machine by "<machine>/<job>".
// seen: { <session>: the ending you looked at }, kept across restarts.
export class Jobs {
  constructor(seen = {}) {
    this.recs = new Map(); // session → { status, end, name, session }
    this.seen = { ...seen };
    this.seq = new Map(); // session → its place among Herdr's agents' seq (⌘G: the latest rang)
    this.last = 0;
  }

  // The job here an attach argument names: the session id or its start (the folder's name is
  // its first 8 characters), else the session's name.
  find(id) {
    if (!id) return null;
    if (/^[0-9a-f-]{4,}$/i.test(id)) {
      for (const [job, r] of this.recs) if (!job.includes("/") && (job.startsWith(id) || id.startsWith(job) || r.session?.startsWith(id))) return job;
    }
    for (const [job, r] of this.recs) if (!job.includes("/") && r.name === id) return job;
    return null;
  }

  // A session's state read now (e: fromRecord / fromNote; null: gone). Returns what Herdr would
  // ring for: "blocked" when it starts needing you (even while you look), "done" when a turn you
  // weren't looking at ends; else null. Nothing rings for the first reading (first: what it was
  // before this started watching), or for a turn that ended while you looked: that one is seen.
  // top: the highest seq among Herdr's agents now, so this change sorts after the ones Herdr had
  // numbered by then (Herdr numbers each change of state, one count for every machine).
  read(key, e, { first = false, looking = false, top = 0 } = {}) {
    const was = this.recs.get(key)?.status ?? null;
    if (!e?.status) { this.recs.delete(key); return null; }
    const status = e.status;
    this.recs.set(key, { status, end: String(e.end ?? ""), name: e.name ?? null, session: e.session ?? null });
    if (first || status === was) return null;
    this.last = Math.max(this.last, top) + 0.001;
    this.seq.set(key, this.last);
    if (status === "blocked") return was === "blocked" ? null : "blocked";
    if (status !== "done" || (was !== "working" && was !== "blocked")) return null;
    if (looking) { this.seen[key] = this.recs.get(key).end; return null; }
    delete this.seen[key];
    return "done";
  }

  // As the lists show it: a finish is "done" until you look at it, then "idle".
  shown(key) {
    const r = this.recs.get(key);
    if (!r) return null;
    return r.status === "done" && this.seen[key] === r.end ? "idle" : r.status;
  }

  // You're looking at it now. True when that turned a "done" into "idle".
  look(key) {
    if (this.shown(key) !== "done") return false;
    this.seen[key] = this.recs.get(key).end;
    return true;
  }

  // Once this machine's records are read: the first time this runs, every ending so far counts
  // as seen (no wall of old "done"s); afterwards the seen list keeps only jobs still here.
  // Another machine's sessions are kept: their records come later, from their labels.
  settle(fresh) {
    for (const [key, r] of this.recs) if (fresh && r.status === "done") this.seen[key] = r.end;
    for (const key of Object.keys(this.seen)) if (!key.includes("/") && !this.recs.has(key)) delete this.seen[key];
  }
}
