// my-tabs: Claude Code's background sessions, as Herdr's agents. A pane running `claude attach
// <id>` reports nothing to Herdr, so Herdr neither knows its state nor tells you when it finishes.
// Claude Code keeps each session's own record in ~/.claude/jobs/<id>/state.json: main.js watches
// that folder, and this file reads a record the way Herdr reads an agent's report (model.rs
// set_word, alert). Pure (node test: .dev/test/jobs.test.mjs).

// A session that isn't running and waits for a prompt to start it again, in Claude Code's words.
const DORMANT = "send a prompt to start";

// A record's state as Herdr shows an agent's: "working", "blocked" (needs you), "done" (the turn
// ended: it shows until you look) or "idle"; null for no record.
// tempo says what's happening now: "active" from the moment a prompt arrives (while state still
// says how the last turn ended) until the turn ends; "blocked" while it waits for you. "idle":
// the turn ended, and state says how: "done", "blocked", or "working" when it waits on work of
// its own (a background task, a sub-agent), which wakes it again. Anything else is idle.
export function jobStatus(r) {
  if (!r || typeof r !== "object") return null;
  if (r.tempo === "active") return "working";
  if (r.tempo === "blocked") return r.needs === DORMANT ? "idle" : "blocked";
  if (r.state === "working" || r.state === "starting" || r.state === "resuming") return "working";
  if (r.state === "blocked") return "blocked";
  if (r.state === "done") return "done";
  return "idle";
}

// The session a pane shows, from its foreground program (hc get: foreground.argv): the id (or its
// start, or the session's name) after `claude attach`; null for anything else.
export function attachedTo(argv) {
  if (!Array.isArray(argv) || argv.length < 3 || argv[argv.length - 2] !== "attach") return null;
  return String(argv[0]).split("/").pop() === "claude" ? String(argv[argv.length - 1]) || null : null;
}

// Each session's state, and when to tell you about it.
// seen: { <job>: the ending you looked at (its record's detail) }, kept across restarts.
export class Jobs {
  constructor(seen = {}) {
    this.recs = new Map(); // job (its folder's name) → { status, detail, name, session }
    this.seen = { ...seen };
    this.seq = new Map(); // job → its place among Herdr's agents' seq (⌘G: the latest rang)
    this.last = 0;
  }

  // The job an attach argument names: the session id or its start (the folder's name is its
  // first 8 characters), else the session's name.
  find(id) {
    if (!id) return null;
    if (/^[0-9a-f-]{4,}$/i.test(id)) {
      for (const [job, r] of this.recs) if (job.startsWith(id) || id.startsWith(job) || r.session?.startsWith(id)) return job;
    }
    for (const [job, r] of this.recs) if (r.name === id) return job;
    return null;
  }

  // A record read now (r: state.json parsed; null: gone). Returns what Herdr would ring for:
  // "blocked" when it starts needing you (even while you look), "done" when a turn you weren't
  // looking at ends; else null. Nothing rings while starting up (first), or for a turn that
  // ended while you looked at it: that one counts as seen.
  // top: the highest seq among Herdr's agents now, so this change sorts after the ones Herdr had
  // numbered by then (Herdr numbers each change of state, one count for every machine).
  read(job, r, { first = false, looking = false, top = 0 } = {}) {
    const status = jobStatus(r);
    const was = this.recs.get(job)?.status ?? null;
    if (!status) { this.recs.delete(job); return null; }
    this.recs.set(job, { status, detail: String(r.detail ?? ""), name: r.name ?? null, session: r.sessionId ?? null });
    if (first || status === was) return null;
    this.last = Math.max(this.last, top) + 0.001;
    this.seq.set(job, this.last);
    if (status === "blocked") return was === "blocked" ? null : "blocked";
    if (status !== "done" || (was !== "working" && was !== "blocked")) return null;
    if (looking) { this.seen[job] = this.recs.get(job).detail; return null; }
    delete this.seen[job];
    return "done";
  }

  // As the lists show it: a finish is "done" until you look at it, then "idle".
  shown(job) {
    const r = this.recs.get(job);
    if (!r) return null;
    return r.status === "done" && this.seen[job] === r.detail ? "idle" : r.status;
  }

  // You're looking at it now. True when that turned a "done" into "idle".
  look(job) {
    if (this.shown(job) !== "done") return false;
    this.seen[job] = this.recs.get(job).detail;
    return true;
  }

  // The first time this runs, every ending so far counts as seen (no wall of old "done"s).
  // Afterwards, the seen list keeps only jobs that still exist.
  settle(fresh) {
    for (const [job, r] of this.recs) if (fresh && r.status === "done") this.seen[job] = r.detail;
    for (const job of Object.keys(this.seen)) if (!this.recs.has(job)) delete this.seen[job];
  }
}
