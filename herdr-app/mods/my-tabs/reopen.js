// my-tabs: ⌘W closes the focused pane, the tab with its last pane, and the space with its
// last tab; ⌘⇧W (or ⌘⇧T) brings back what was closed, like a browser's reopen.
//
// `my-tabs.close` (⌘W) closes the focused pane when its tab has other panes, else the whole
// tab; the active tab's × always closes the tab. Neither ends terminals: they are parked
// (terminal.park: no pane, still running) and the pane or tab is remembered.
// `my-tabs.reopen` takes the most recently closed one and gives its terminals the
// herdr.space / herdr.tab labels again (the same ids). A pane rejoins its tab as a split
// (Herdr picks where). A tab comes back with its position and name, a space that went with
// its last tab with its id, name and position; then the closed pane, or the pane that had
// focus, gets focus. Again reopens the one closed before it.
//
// Parked terminals end after a grace period: 10 min with an agent, 1 min otherwise (so a
// server's port frees soon). Reopened after that, it gets new terminals in the same
// folders on the same machine:
// - An agent whose session was found comes back with `claude --resume <id>` or
//   `codex resume <id>`, inside the same shell when it ran in one. Claude Code's session id
//   is in ~/.claude/sessions/<pid>.json while it runs; Codex keeps its rollout-…-<id>.jsonl
//   open. Both are read on the agent's machine just after ⌘W.
// - A shell comes back as a shell.
// - Anything else (a server, a script, ssh) is not started again: it gets a shell there,
//   and a toast names the command.
// A mod pane (a viewer) closes at once and doesn't come back; so do terminals closed with
// the right-click menu's Close or a pane's ×.

const AGENT_GRACE = 10 * 60 * 1000;
const OTHER_GRACE = 60 * 1000;
const KEEP = 20; // closed tabs remembered
const MAX_AGE = 24 * 3600 * 1000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "elvish"]);

// On the terminal's machine, with its root pid as $1: the root's command line now (after any
// exec), then each claude / codex process under it: kind, depth (0: the root itself), pid,
// session file or rollout file ("-": none), command line. Agents behind ssh or tmux aren't
// under it, so they aren't found.
export const CAPTURE = String.raw`root=$1
T=$(printf '\t')
ps -A -ww -o pid=,ppid=,args= 2>/dev/null | awk -v root="$root" '
function base(s,  n, p) { n = split(s, p, "/"); s = p[n]; sub(/^-/, "", s); return s }
{ pid = $1; par[pid] = $2; $1 = ""; $2 = ""; sub(/^ +/, ""); cmd[pid] = $0 }
END {
  if (!(root in cmd)) exit
  print "ROOT\t" cmd[root]
  for (p in cmd) {
    q = p; d = 0
    while (q != root && (q in par) && d < 8) { q = par[q]; d++ }
    if (q != root) continue
    n = split(cmd[p], w, " ")
    b0 = base(w[1]); b1 = n > 1 ? base(w[2]) : ""
    k = ""
    if (b0 == "claude" || (b0 == "node" && (w[2] ~ /claude-code\// || b1 == "claude"))) k = "CLAUDE"
    else if ((b0 == "codex" || (b0 == "node" && b1 == "codex")) && cmd[p] !~ /app-server/) k = "CODEX"
    if (k != "") print k "\t" d "\t" p "\t" cmd[p]
  }
}' | while IFS="$T" read -r k d p a; do
  case $k in
    ROOT) printf 'ROOT\t%s\n' "$d" ;;
    CLAUDE)
      f="$HOME/.claude/sessions/$p.json"
      s=-; [ -f "$f" ] && s=$(tr -d '\n\t' < "$f")
      printf 'CLAUDE\t%s\t%s\t%s\t%s\n' "$d" "$p" "$s" "$a" ;;
    CODEX)
      r=$( { ls -l "/proc/$p/fd" 2>/dev/null; lsof -p "$p" -Fn 2>/dev/null; } | grep -o 'rollout-[^ ]*\.jsonl' | head -n 1)
      [ -n "$r" ] || r=-
      printf 'CODEX\t%s\t%s\t%s\t%s\n' "$d" "$p" "$r" "$a" ;;
  esac
done`;

const local = (id) => String(id ?? "").slice(String(id ?? "").lastIndexOf("/") + 1);
const machineOf = (address) => {
  const a = String(address ?? "");
  return a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : null;
};
const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean);
const base = (s) => String(s ?? "").split("/").pop().replace(/^-/, "");
const q = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);
const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const title = (rec) => (rec.kind !== "pane" && rec.tab.named && rec.tab.name) || rec.panes.map((p) => clean(p.title)).find(Boolean)
  || (rec.kind === "pane" ? "pane" : `tab ${rec.tab.index}`);

// CAPTURE's output: { root, agent: { kind, depth, args, session, cwd } | null }. The agent is
// the shallowest one (a Claude whose tool runs codex is a Claude); Codex's session can come
// from its native child, which holds the rollout file.
export function parseCapture(out) {
  let root = null;
  const found = [];
  for (const line of String(out ?? "").split("\n")) {
    const f = line.split("\t");
    if (f[0] === "ROOT") root = f.slice(1).join(" ").trim() || null;
    if (f[0] !== "CLAUDE" && f[0] !== "CODEX") continue;
    const depth = Number(f[1]), pid = Number(f[2]), detail = f[3] ?? "-", args = f.slice(4).join(" ").trim();
    if (f[0] === "CLAUDE") {
      let s = null;
      try { s = JSON.parse(detail); } catch {}
      const ok = s?.pid === pid && UUID.test(s?.sessionId ?? "");
      found.push({ kind: "claude", depth, args, session: ok ? s.sessionId : null, cwd: ok ? s.cwd ?? null : null });
    } else {
      const named = args.match(new RegExp(`\\bresume\\s+(${UUID.source})`));
      found.push({ kind: "codex", depth, args, session: detail.match(UUID)?.[0] ?? named?.[1] ?? null, cwd: null });
    }
  }
  if (!found.length) return { root, agent: null };
  found.sort((a, b) => a.depth - b.depth || (a.kind === "claude" ? -1 : 1));
  const top = found[0];
  const session = top.session ?? (top.kind === "codex" ? found.find((a) => a.kind === "codex" && a.session)?.session ?? null : null);
  return { root, agent: { ...top, session } };
}

// The shell a root command line is, when it is one with no script or -c command.
export function shellOf(root) {
  const w = words(root);
  if (!w.length || !SHELLS.has(base(w[0])) || w.slice(1).some((x) => !x.startsWith("-"))) return null;
  return w[0].replace(/^-/, "");
}

// Flags worth keeping when an agent starts again with its session. ps loses quoting, so a
// value with anything but plain characters is dropped with its flag.
function keptFlags(kind, args) {
  const pair = kind === "claude" ? ["--permission-mode", "--model"] : ["-m", "--model", "-s", "--sandbox", "-a", "--ask-for-approval"];
  const single = kind === "claude" ? ["--dangerously-skip-permissions"] : ["--no-daemon", "--full-auto", "--dangerously-bypass-approvals-and-sandbox"];
  const plain = (v) => /^[\w@%+=:,./-]+$/.test(v ?? "");
  const w = words(args), out = [];
  for (let i = 1; i < w.length; i++) {
    if (single.includes(w[i])) out.push(w[i]);
    else if (pair.includes(w[i]) && i + 1 < w.length) { if (plain(w[i + 1])) out.push(w[i], w[i + 1]); i++; }
    else if (w[i].includes("=") && pair.includes(w[i].split("=")[0]) && plain(w[i])) out.push(w[i]);
  }
  return out;
}

export function resumeLine(agent) {
  const flags = keptFlags(agent.kind, agent.args);
  const argv = agent.kind === "claude" ? ["claude", "--resume", agent.session, ...flags] : ["codex", "resume", ...flags, agent.session];
  return argv.map(q).join(" ");
}

// How to start a terminal that has ended again: { argv, cwd, note }. `note` says what
// didn't come back; the terminal's own labels and name come back only without one.
export function plan(pane, info) {
  const agent = info?.agent ?? null;
  const root = info?.root ?? (Array.isArray(info?.argv) ? info.argv.join(" ") : "");
  const shell = shellOf(root);
  const cwd = pane.cwd ?? info?.cwd ?? null;
  const login = (line) => ["sh", "-c", 'exec "${SHELL:-/bin/sh}" -lic "$0"', line];
  if (agent?.session) {
    const line = resumeLine(agent), at = agent.cwd ?? cwd;
    if (shell) return { argv: [shell, "-lic", `${line}; exec ${q(shell)} -l`], cwd: at, note: null };
    return { argv: login(agent.depth === 0 ? `exec ${line}` : `${line}; exec "$SHELL" -l`), cwd: at, note: null };
  }
  const lost = pane.agent ? `${clean(pane.title) || "Its agent"}: no session found to resume (it may have run over ssh); start it again by hand.` : null;
  if (shell) return { argv: [shell, "-l"], cwd, note: lost };
  if (!root) return { argv: ["sh", "-c", 'exec "${SHELL:-/bin/sh}" -l'], cwd, note: lost }; // nothing was learned about it
  return { argv: ["sh", "-c", 'exec "${SHELL:-/bin/sh}" -l'], cwd, note: `Not started again: ${root}` };
}

export class Reopener {
  // h: the herdr functions it uses; store: get/set strings (the mod copy's localStorage).
  constructor(h, store) {
    this.h = h;
    this.store = store;
    this.closed = [];
    try {
      const v = JSON.parse(store.get("closed") ?? "[]");
      if (Array.isArray(v)) this.closed = v;
    } catch {}
  }

  save() {
    try { this.store.set("closed", JSON.stringify(this.closed)); } catch {}
  }

  ready(machine) {
    const m = this.h.machines().find((x) => (x.name ?? null) === machine);
    return machine === null ? !m || m.layout === "ready" : m?.layout === "ready";
  }

  // ⌘W: the focused pane when its tab has other panes, else the whole tab (the space goes
  // with its last tab). `id` names a tab ("tb…": the tab's ×) or a pane ("p…") instead.
  close(cx, id) {
    const all = this.h.panes();
    let pane = null, tabId = null;
    if (id && local(id).startsWith("p")) {
      pane = all.find((p) => p.pane === id) ?? null;
      tabId = pane?.tab ?? null;
    } else if (id) tabId = id;
    else {
      const f = this.h.focused();
      tabId = f?.tab ?? null;
      const mine = all.filter((p) => p.tab === tabId);
      if (mine.length > 1) pane = mine.find((p) => p.pane === f?.pane) ?? null;
    }
    const space = this.h.spaces().find((s) => s.tabs.some((t) => t.id === tabId));
    const tab = space?.tabs.find((t) => t.id === tabId);
    if (!tab) {
      this.h.run("tab.close", tabId ? { id: tabId } : {});
      return;
    }
    if (pane && !pane.terminal) {
      this.h.run("pane.close", { pane: pane.pane }); // a mod pane: nothing to park
      return;
    }
    const inTab = all.filter((p) => p.tab === tab.id);
    const terms = pane ? [pane] : inTab.filter((p) => p.terminal);
    if (!terms.length) {
      this.h.run("tab.close", { id: tab.id });
      return;
    }
    const agent = terms.some((p) => p.program?.agent || p.app);
    const now = Date.now();
    const rec = {
      kind: pane ? "pane" : "tab",
      at: now, until: now + (agent ? AGENT_GRACE : OTHER_GRACE), agent,
      machine: space.machine ?? null,
      space: { id: space.id, name: space.name, named: space.named, index: space.index },
      tab: { id: tab.id, name: tab.name, named: tab.named, index: tab.index },
      panes: terms.map((p) => ({ terminal: p.terminal, cwd: p.cwd ?? null, title: p.title ?? "", agent: Boolean(p.program?.agent || p.app), focused: Boolean(p.focused) })),
      info: {},
    };
    for (const p of terms) this.h.run("terminal.park", { terminal: p.terminal });
    this.closed.push(rec);
    this.prune();
    this.save();
    if (agent) this.h.notify({ title: `Closed “${title(rec)}”`, body: "⌘⇧W or ⌘⇧T reopens it. Its agent keeps running for 10 minutes.", timeout: 4000 });
    cx.spawn(async (cx) => this.settle(cx, rec, !pane && inTab.length > terms.length));
  }

  // After ⌘W: drop terminals whose pane didn't go (parking failed), close what is left of
  // the tab (mod panes), then note how each terminal could start again once it has ended.
  async settle(cx, rec, mods) {
    const addrs = new Set(rec.panes.map((p) => p.terminal));
    const shown = () => new Set(this.h.panes().map((p) => p.terminal).filter((t) => addrs.has(t)));
    for (let i = 0; i < 50 && shown().size; i++) await cx.sleep(200);
    const stuck = shown();
    if (stuck.size) {
      rec.panes = rec.panes.filter((p) => !stuck.has(p.terminal));
      if (!rec.panes.length) this.closed = this.closed.filter((r) => r !== rec);
      this.save();
      if (!rec.panes.length) return;
    }
    if (mods && this.h.spaces().some((s) => s.tabs.some((t) => t.id === rec.tab.id))) this.h.run("tab.close", { id: rec.tab.id, confirmed: true });
    for (const p of rec.panes) {
      try {
        const d = JSON.parse((await this.h.hc(["get", p.terminal, "--json"])).stdout || "{}");
        const info = { argv: d.argv ?? null, name: d.name ?? null, labels: d.labels ?? {}, cwd: d.cwd ?? null, root: null, agent: null };
        if (d.pid) {
          const r = await this.h.exec("sh", ["-c", CAPTURE, "sh", String(d.pid)], { on: rec.machine, timeout: 20000 });
          Object.assign(info, parseCapture(r.stdout));
        }
        rec.info[p.terminal] = info;
      } catch (err) {
        console.log("my-tabs reopen: capture", p.terminal, String(err?.message ?? err));
      }
    }
    this.save();
  }

  // ⌘⇧W: bring back the most recently closed pane or tab.
  async reopen(cx) {
    this.prune();
    const rec = this.closed.pop();
    this.save();
    if (!rec) {
      this.h.notify({ title: "Nothing to reopen", timeout: 2500 });
      return;
    }
    if (!this.ready(rec.machine)) {
      this.closed.push(rec);
      this.save();
      this.h.notify({ title: `${rec.machine} isn't connected`, body: "⌘⇧W again once it is.", level: "warning", timeout: 5000 });
      return;
    }
    const had = {
      space: this.h.spaces().some((s) => s.id === rec.space.id),
      tab: this.h.spaces().some((s) => s.tabs.some((t) => t.id === rec.tab.id)),
    };
    const live = new Map(this.h.terminals().map((t) => [t.address, t]));
    const shown = new Set(this.h.panes().map((p) => p.terminal).filter(Boolean));
    const notes = [];
    const back = {}; // closed terminal -> the one that shows it again
    for (const p of rec.panes) {
      if (shown.has(p.terminal)) continue; // already shown again some other way
      if (live.get(p.terminal)?.state === "live") {
        const r = await this.h.hc(["label", p.terminal, `herdr.space=${local(rec.space.id)}`, `herdr.tab=${local(rec.tab.id)}`]);
        if (r.code === 0) { back[p.terminal] = p.terminal; continue; }
      }
      const info = rec.info?.[p.terminal] ?? null;
      const how = plan(p, info);
      const address = await this.start(rec, info, how);
      if (address) {
        back[p.terminal] = address;
        if (how.note) notes.push(how.note);
      }
    }
    if (!Object.keys(back).length) {
      this.h.notify({ title: `Couldn't reopen “${title(rec)}”`, level: "warning", timeout: 5000 });
      return;
    }
    await this.arrange(cx, rec, had, back);
    if (notes.length) this.h.notify({ title: `Reopened “${title(rec)}”`, body: notes.join("\n"), level: "warning", timeout: 12000 });
  }

  // A new terminal for one that has ended, in the closed tab's space and tab ids. Its
  // address, or null when it couldn't start.
  async start(rec, info, how) {
    const m = rec.machine;
    const own = !how.note; // its labels and name only when it really comes back
    const taken = info?.name && this.h.terminals().some((t) => t.state === "live" && t.name === info.name && machineOf(t.address) === m);
    const labels = own ? Object.entries(info?.labels ?? {}).filter(([k]) => !k.startsWith("herdr.") && k !== "where") : [];
    const args = ["run", "--bg", "--no-parent", ...(m ? ["--on", m] : []),
      "--label", `herdr.space=${local(rec.space.id)}`, "--label", `herdr.tab=${local(rec.tab.id)}`,
      ...labels.flatMap(([k, v]) => ["--label", `${k}=${v}`]),
      ...(own && info?.name && !taken ? ["--name", info.name] : [])];
    let r = await this.h.hc([...args, ...(how.cwd ? ["--cwd", how.cwd] : []), "--", ...how.argv]);
    if (r.code !== 0 && how.cwd) r = await this.h.hc([...args, "--", ...how.argv]); // its folder is gone
    if (r.code !== 0) {
      console.log("my-tabs reopen: start", r.stderr || r.stdout);
      return null;
    }
    try { return JSON.parse(r.stdout).address || "started"; } catch { return "started"; }
  }

  // Once it shows again: the space's name and place if the space had gone, the tab's if the
  // tab had, then select the tab and focus the closed pane (for a tab, the one with focus).
  async arrange(cx, rec, had, back) {
    const id = rec.tab.id;
    const where = () => this.h.spaces().find((s) => s.tabs.some((t) => t.id === id));
    for (let i = 0; i < 60 && !where(); i++) await cx.sleep(150);
    const s = where();
    if (!s) return;
    if (!had.space) {
      if (rec.space.named && !s.named) this.h.run("space.rename", { id: s.id, name: rec.space.name });
      if (s.index !== rec.space.index) this.h.run("space.move", { id: s.id, index: Math.min(rec.space.index, this.h.spaces().length) });
    }
    const t = s.tabs.find((x) => x.id === id);
    if (!had.tab && t) {
      if (rec.tab.named && !t.named) this.h.run("tab.rename", { id, name: rec.tab.name });
      if (t.index !== rec.tab.index) this.h.run("tab.move", { id, index: Math.min(rec.tab.index, s.tabs.length) });
    }
    this.h.run("space.select", { id: s.id });
    this.h.run("tab.select", { id });
    const f = rec.kind === "pane" ? rec.panes[0] : rec.panes.find((p) => p.focused);
    const target = f && back[f.terminal];
    if (!target) return;
    for (let i = 0; i < 20 && !this.h.panes().some((p) => p.terminal === target); i++) await cx.sleep(150);
    if (this.h.panes().some((p) => p.terminal === target)) this.h.run("pane.focus", { terminal: target });
  }

  // End a closed tab's terminals that are still parked. False when its machine's terminals
  // can't be seen yet (not connected, still loading): try again later.
  expire(rec) {
    const list = this.h.terminals().filter((t) => machineOf(t.address) === rec.machine);
    if (!this.ready(rec.machine) || !list.length) return false;
    const shown = new Set(this.h.panes().map((p) => p.terminal).filter(Boolean));
    for (const p of rec.panes) {
      const t = list.find((x) => x.address === p.terminal);
      if (t?.state === "live" && !shown.has(p.terminal) && !t.labels?.["herdr.space"]) this.h.run("terminal.kill", { terminal: p.terminal });
    }
    rec.expired = true;
    return true;
  }

  // Every 15 s: end parked terminals whose grace has passed. One that has the keyboard (a
  // peek over the tab, where the person can still talk to it) gets another grace period.
  sweep() {
    const now = Date.now();
    const f = this.h.focused();
    let changed = false;
    for (const rec of this.closed) {
      if (rec.expired || now < rec.until) continue;
      if (f && rec.panes.some((p) => p.terminal === f.terminal || p.terminal === f.shown)) {
        rec.until = now + (rec.agent ? AGENT_GRACE : OTHER_GRACE);
        changed = true;
        continue;
      }
      if (this.expire(rec)) changed = true;
    }
    if (this.prune() || changed) this.save();
  }

  // Keep the last KEEP closed panes and tabs from the last day; a dropped one's parked
  // terminals end.
  prune() {
    const now = Date.now();
    const keep = this.closed.filter((r) => now - r.at < MAX_AGE).slice(-KEEP);
    if (keep.length === this.closed.length) return false;
    for (const r of this.closed) if (!keep.includes(r) && !r.expired) this.expire(r);
    this.closed = keep;
    return true;
  }
}
