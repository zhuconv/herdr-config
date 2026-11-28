// my-tabs: one name per agent, its session's. Renaming a tab that holds one Claude or one
// Antigravity (agy) (a double-click on the tab, the tab menu's Rename: both are Herdr's own
// rename) renames its session too: `/rename <name>` typed into the agent once it is idle with an
// empty box, then the tab goes back to Herdr's automatic name, which follows the terminal's
// title, where the agent puts its session's name (Claude itself; agy through agent-note's title
// command, agent-plugin/antigravity). The bar, the Agents list and ⌃Tab then all show that one
// name, and a later /rename in the agent changes it everywhere. Codex (it has no /rename), a tab
// with several agents and every other tab keep a plain tab name.
//
// hc's send is no guard for the box: it waits for a draft a person is typing, but after a minute
// of quiet it pastes behind it and sends both. So the screen is read first (boxEmpty).

const WAIT = 30 * 60 * 1000; // a busy agent, or one with a draft in its box, is waited for this long
const POLL = 3000;

// Sends one line as a person would, but never wrapped as a message from an hc terminal
// (<hc from=…>): Herdr's environment has no HC_TERMINAL_ID, and this makes sure of it. $3, when
// given, is hc's --if guard ("idle").
const SEND = 'unset HC_TERMINAL_ID; H=$(command -v hc) || H="$HOME/.local/bin/hc"; exec "$H" send ${3:+--if "$3"} --json "$1" "$2"';

// The agents whose session takes a name from /rename, by what they report (OSC 7501 `app`), and
// what the toasts call them.
const NAMERS = { "claude-code": "Claude", antigravity: "Antigravity" };

/** The tabs' given names ({ id → name, or null while Herdr names it }), and the tabs given a new
 *  name since `prev` (the last call's map; null the first time: nothing is new then). A tab not
 *  seen before (new, or its machine just connected) isn't renamed. */
export function renamedTabs(prev, spaces) {
  const now = new Map();
  for (const s of spaces ?? []) for (const t of s.tabs ?? []) now.set(t.id, t.named ? t.name : null);
  const events = [];
  if (prev) for (const [id, name] of now) if (name !== null && prev.has(id) && prev.get(id) !== name) events.push({ id, name });
  return { now, events };
}

/** The one agent in a tab when it is a Claude or an Antigravity that reports to Herdr (`app`; a
 *  `claude attach` view doesn't): its pane, else null. */
export function soleNamer(panes, tabId) {
  const agents = (panes ?? []).filter((p) => p.tab === tabId && p.terminal && (p.app || p.program?.agent));
  return agents.length === 1 && NAMERS[agents[0].app] ? agents[0] : null;
}

/** A border of the agent's box; Claude's top one may carry the session's name: "──── api-fix ─". */
const RULE = /^\s*─{4,}.*─\s*$/;

/** What the input box holds on this screen, without its ❯ (Claude) or > (agy) (as the phone
 *  hub's stuck.js reads it): the lines between the last two rules, the first of them starting
 *  with ❯ or >. null when no box shows (a menu, a dialog). */
export function boxOf(screen) {
  const lines = String(screen ?? "").split("\n");
  const rules = [];
  for (let i = lines.length - 1; i >= 0 && rules.length < 2; i--) if (RULE.test(lines[i])) rules.push(i);
  if (rules.length < 2) return null;
  const inner = lines.slice(rules[1] + 1, rules[0]);
  if (!/^\s*[❯>]/.test(inner[0] ?? "")) return null;
  return inner.join("\n").replace(/^\s*[❯>]\s?/, "");
}

/** Whether the box shows and holds nothing. A new box shows a hint, which isn't a draft: Claude's
 *  example (`Try "…"`), agy's mode ("Auto mode: edits & safe commands auto-approved (shift+tab to
 *  cycle)"). */
export function boxEmpty(screen) {
  const box = boxOf(screen);
  if (box === null) return false;
  const s = box.trim();
  return s === "" || /^Try "[^"\n]*"$/.test(s) || /^[\w-]+ mode: [^\n]*\(shift\+tab to cycle\)$/.test(s);
}

/** Whether a terminal's title shows the session's name: "api-fix", or "✳ api-fix" (Claude's mark first). */
export function titled(title, name) {
  const t = String(title ?? "").trim().replace(/\s+/g, " "), n = String(name ?? "").trim().replace(/\s+/g, " ");
  return Boolean(n) && (t === n || t.replace(/^[^\p{L}\p{N}\s]+\s+/u, "") === n);
}

/** Whether agy's answer to the last /rename on this screen is that it has no conversation yet (a
 *  new agy starts one only with its first input; that /rename did start it). */
export function noConversation(screen) {
  const said = String(screen ?? "").split("\n").filter((l) => /Conversation renamed to:|Failed to rename conversation/.test(l));
  return /no active conversation/.test(said.at(-1) ?? "");
}

export class Namer {
  // h: the herdr functions it uses (spaces, panes, run, hc, exec, notify). opts: shorter waits
  // for the tests.
  constructor(h, { wait = WAIT, poll = POLL, settle = 5000 } = {}) {
    this.h = h;
    this.wait = wait;
    this.poll = poll;
    this.settleFor = settle;
    this.names = null; // each tab's given name, as last seen
    this.expected = new Map(); // tab → { name, until }: names this mod gives, not a person
    this.pending = new Map(); // tab → the rename now waiting for its agent
  }

  // A name this mod gives a tab (⌘⇧W gives a tab back its name): not a person's rename.
  expect(id, name) {
    if (id && name) this.expected.set(id, { name, until: Date.now() + 10000 });
  }

  // From the bar's render: the tabs a person has just renamed that hold one Claude or Antigravity,
  // as [{ id, name, terminal }].
  see(spaces, panes) {
    const { now, events } = renamedTabs(this.names, spaces);
    this.names = now;
    const at = Date.now(), out = [];
    for (const e of events) {
      const mine = this.expected.get(e.id);
      if (mine) {
        this.expected.delete(e.id);
        if (mine.name === e.name && mine.until > at) continue;
      }
      const p = soleNamer(panes, e.id);
      if (p && e.name.trim()) out.push({ id: e.id, name: e.name, terminal: p.terminal });
    }
    for (const [id, x] of this.expected) if (x.until <= at) this.expected.delete(id);
    return out;
  }

  // Tab `id` was named `name`: its agent (`terminal`) takes the name as its session's, then the
  // tab follows the session. Waits while the agent works or its box holds a draft; gives up if the
  // tab is renamed again, or the agent leaves it.
  async rename(cx, id, name, terminal) {
    const token = {};
    this.pending.set(id, token);
    const clean = name.trim();
    const tab = () => this.h.spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === id);
    const pane = () => this.h.panes().find((p) => p.terminal === terminal && p.tab === id);
    const still = () => this.pending.get(id) === token && tab()?.named && tab().name === name && Boolean(pane());
    const who = NAMERS[pane()?.app] ?? "agent";
    const shows = async () => {
      for (let i = 0; i * 200 < this.settleFor && !titled(pane()?.title, clean); i++) await cx.sleep(200);
      return titled(pane()?.title, clean);
    };
    let said = false;
    try {
      const until = Date.now() + this.wait;
      for (let first = true; Date.now() < until; first = false) {
        if (!first) await cx.sleep(this.poll);
        if (!still()) return;
        const p = pane();
        if (titled(p.title, clean)) return void this.follow(id, name); // already its name
        let why = "busy";
        if (p.status === "idle" || p.status === "done") {
          const screen = await this.read(terminal);
          if (!still()) return;
          if (screen === null) why = null; // couldn't look: try again
          else if (!boxEmpty(screen)) why = "draft";
          else if (await this.send(terminal, `/rename ${clean}`)) {
            if (await shows()) return void this.follow(id, name);
            // A new agy has no conversation until its first input, which that /rename was: again.
            if (p.app === "antigravity" && noConversation(await this.read(terminal)) && still()
              && await this.send(terminal, `/rename ${clean}`) && await shows()) return void this.follow(id, name);
            this.h.notify({ title: `Only the tab is called “${clean}”`, body: `Its ${who} didn't show the new name. Rename the tab again to retry.`, level: "warning", timeout: 8000 });
            return;
          }
        }
        if (why && !said) {
          said = true;
          this.h.notify({ title: `Renaming the session once its ${who} is free`, body: `“${clean}”: ${why === "draft" ? "its box holds a draft" : "it's busy"}. Until then only the tab has the name.`, timeout: 5000 });
        }
      }
      if (still()) this.h.notify({ title: `Only the tab is called “${clean}”`, body: `Its ${who} stayed busy, or kept a draft in its box. Rename the tab again to retry.`, level: "warning", timeout: 10000 });
    } finally {
      if (this.pending.get(id) === token) this.pending.delete(id);
    }
  }

  // The session has the name: the tab takes Herdr's automatic name again, which follows it.
  follow(id, name) {
    const t = this.h.spaces().flatMap((s) => s.tabs ?? []).find((x) => x.id === id);
    if (t?.named && t.name === name) this.h.run("tab.rename", { id, name: "" });
  }

  async read(terminal) {
    try {
      const r = await this.h.hc(["read", terminal, "--json"]);
      return r.code === 0 ? JSON.parse(r.stdout).text ?? null : null;
    } catch {
      return null;
    }
  }

  // Types the line if the agent is idle. One that finished while nobody looked stays "done" in
  // hc until it hears you looked (Herdr may call it idle already), and hc's guard then refuses:
  // its box was just read empty, so it gets the line without the guard. hc exits 0 once it has
  // typed; its "started" says whether a turn began, which a /rename never does.
  async send(terminal, text) {
    const go = async (guard) => {
      const r = await this.h.exec("/bin/sh", ["-c", SEND, "sh", terminal, text, ...(guard ? [guard] : [])], { timeout: 90000 });
      let out = null;
      try { out = JSON.parse(r.stdout); } catch {}
      return { ok: r.code === 0, done: out?.error?.kind === "status_mismatch" && / is done, /.test(out.error.message ?? "") };
    };
    try {
      const r = await go("idle");
      return r.ok || (r.done && (await go(null)).ok);
    } catch {
      return false;
    }
  }
}
