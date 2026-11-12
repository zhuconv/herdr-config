// agent-deck: every agent on every machine, in a lane per state, grouped by machine;
// a Terminals tab shows every live terminal, a lane per machine, with what runs and its last lines.
// Opened with `mod.open:agent-deck-overview` (again: closes it); a card goes to its agent.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup } from "gpui-base";
import { spaces, agents, terminals, panes, run, hc, theme, props, closeOverlay, openOverlay, settings, nextCommand } from "herdr";
import { parseUsage, usageArgs } from "./usage.js";
import { customLabels, taskMatches, taskCounts, NO_TASK, saveTaskFilter, loadTaskFilter } from "./labels.js";
import { SESSION_OF, sessionFrom, resumeLink, machineOf as machineOfAddress } from "./resume.js";

// agent-deck: edit a terminal's labels in the agent-deck-labels dialog.
const editLabels = (terminal) => openOverlay({ mod: "agent-deck-labels", kind: "dialog", width: 560, props: { terminal } });

const ORDER = ["blocked", "done", "working", "waiting", "idle"];
const RANK = { blocked: 5, done: 4, working: 3, waiting: 2, idle: 1 };
const WORD = { blocked: "needs you", done: "done", working: "working", waiting: "waiting", idle: "idle" };
// agent-deck: "waiting" is an idle agent whose own hook still reports background work as
// a `bg` record (`hc report state=working:id=bg`). Shown in Working; done stays done.
const waits = (s, k) => s === "idle" && bgRunning(k);
const bgRunning = (k) => k?.records?.bg?.state === "working";
const stateColor = (t, s) => (s === "waiting" ? t.waiting ?? t.muted ?? t.dim : t[s] ?? t.dim);
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// The agent's own title (Claude's chat name) when it says something, else its program.
function chatName(a) {
  const live = clean(a.title);
  const telling = live && live !== a.program?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== a.program?.key;
  return telling ? live : a.program?.name || a.address;
}
function counts(list) {
  const n = {};
  for (const a of list) n[a.status] = (n[a.status] ?? 0) + 1;
  return ORDER.filter((k) => n[k]).map((k) => [k, n[k]]);
}
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
const short = (cwd) => (cwd ? cwd.replace(/^\/private(?=\/(tmp|var)\/)/, "").replace(/^\/(Users|home)\/[^/]+/, "~").replace(/^\/root(?=\/|$)/, "~") : "");
const PREVIEW = 2; // last non-empty screen lines on a terminal card
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : null);
// The filter: every word typed must appear somewhere in what a card says.
const matches = (words, ...parts) => {
  const text = parts.flat().filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
};

export default class Overview extends View {
  init(_props, cx) {
    this.machines = [];
    this.tab = localStorage.getItem("tab") ?? "agents";
    this.preview = {}; // address -> its last lines
    this.usage = {}; // machine ("" = this computer) -> {cpu, mem, disk} | {loading} | {error}
    this.query = "";
    // null: every task; NO_TASK: none; else that task. The last pick is remembered.
    this.taskFilter = (() => { try { return loadTaskFilter(localStorage.getItem("taskFilter")); } catch { return null; } })();
    this.taskMenu = false;
    this.input = InputState.new({ placeholder: "Filter: name, machine, space, command…" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.focus();
    this.refresh(cx);
    this.read(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
    cx.timer.every(8000, (cx) => this.read(cx));
    // `agent-deck-overview.agents` / `agent-deck-overview.terminals` pick the tab (keys can name them).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "agents" || c === "terminals") this.show(c, cx);
        if (c === "usage") { this.show("terminals", cx); this.measure(this.machineNames(), cx); }
        if (c === "tasks") { this.taskMenu = !this.taskMenu; cx.notify(); }
        // `agent-deck-overview.task <name>` filters to that task; `task` alone shows all.
        if (c === "task") this.setTaskFilter(null, cx);
        else if (typeof c === "string" && c.startsWith("task ")) this.setTaskFilter(c.slice(5).trim() || null, cx);
        if (c === "label") {
          const a = agents().find((x) => x.focused);
          if (a) editLabels(a.address);
        }
      }
    });
  }

  // The last lines of every live terminal, one at a time, while the Terminals tab shows.
  read(cx) {
    if (this.tab !== "terminals" || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      const reading = terminals().filter((x) => x.state === "live" && !x.program?.agent);
      // Lines of terminals that are gone go too.
      this.preview = Object.fromEntries(reading.filter((x) => this.preview[x.address]).map((x) => [x.address, this.preview[x.address]]));
      for (const x of reading) {
        try {
          const r = await hc(["read", x.address]);
          if (r.code === 0) this.preview[x.address] = r.stdout.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-PREVIEW);
        } catch {}
      }
      this.reading = false;
      cx.notify();
    });
  }

  show(tab, cx) {
    this.tab = tab;
    localStorage.setItem("tab", tab);
    this.read(cx);
    cx.notify();
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
      } catch {}
      cx.notify();
    });
  }

  // This computer (null) first, then every machine with a space or known to hc.
  machineNames() {
    return [null, ...[...new Set([...spaces().map((s) => s.machine).filter(Boolean), ...this.machines.map((m) => m.name)])].sort()];
  }

  // agent-deck: CPU, memory and disk use of every machine, all at once; each lane shows its own.
  // Also `agent-deck-overview.usage` (keys can name it).
  measure(names, cx) {
    for (const m of names) {
      const key = m ?? "";
      if (this.usage[key]?.loading) continue;
      const machine = this.machines.find((k) => k.name === m);
      if (m && machine?.state !== "connected") {
        this.usage[key] = { error: (machine?.state ?? "asleep").replace(/_/g, " ") };
        continue;
      }
      this.usage[key] = { loading: true };
      cx.spawn(async (cx) => {
        try {
          const r = await hc(usageArgs(m));
          this.usage[key] = (r.code === 0 && parseUsage(r.stdout)) || { error: (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop() };
        } catch (e) {
          this.usage[key] = { error: String(e?.message ?? e) };
        }
        cx.notify();
      });
    }
    cx.notify();
  }

  usageRow(t, m) {
    const u = this.usage[m ?? ""];
    const row = h_flex().id(`ov-usage-${m ?? "local"}`).flex_none().h(24).px(12).gap(12).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim);
    if (u.loading) return row.child("Measuring…");
    if (u.error) return row.child(div().id(`ov-usage-err-${m ?? "local"}`).flex_1().min_w(0).truncate().tooltip(u.error).child(`Usage: ${u.error}`));
    const level = (v) => (v >= 90 ? t.blocked : v >= 75 ? t.working : t.foreground);
    return row.children([["CPU", u.cpu], ["MEM", u.mem], ["Disk", u.disk]].map(([k, v]) => h_flex().gap(4)
      .child(div().child(k))
      .child(div().font_semibold().text_color(v === null ? t.dim : level(v)).child(v === null ? "–" : `${v}%`))));
  }

  // Not `close`: Herdr calls a View's close(cx) itself when the overlay goes.
  dismiss() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  // A shell on machine `m` (null: this computer), in a new space there (its home).
  newTerminal(m) {
    run("space.new", { machine: m ?? "" });
    this.dismiss();
  }

  clearFilter(cx) {
    this.query = "";
    this.input.set_value("");
    this.input.focus();
    cx.notify();
  }

  pills(t, list) {
    return counts(list).map(([k, n]) => div().flex_none().px(6).py(1).rounded(4).bg(stateColor(t, k) + "26").text_size(11).text_color(stateColor(t, k)).child(`${n} ${WORD[k]}`));
  }

  setTaskFilter(value, cx) {
    this.taskFilter = value;
    this.taskMenu = false;
    try { localStorage.setItem("taskFilter", saveTaskFilter(value)); } catch {}
    cx.notify();
  }

  // agent-deck: Copy link on a Claude Code card: a herdr-resume:// link to its session
  // (resume.js). The session id is read on click: the pid of the terminal's program, then
  // ~/.claude/sessions/<pid>.json on its machine. The icon says how it went for 2 s.
  copyLink(address, cx) {
    if (this.linkState?.address === address && this.linkState.state === "busy") return;
    const mark = (state, cx) => { this.linkState = { address, state }; cx.notify(); };
    mark("busy", cx);
    cx.spawn(async (cx) => {
      let id = null;
      try {
        let pid = terminals().find((x) => x.address === address)?.foreground?.pid;
        if (!Number.isInteger(pid)) pid = JSON.parse((await hc(["get", address, "--json"])).stdout)?.foreground?.pid;
        const m = machineOfAddress(address);
        if (Number.isInteger(pid)) {
          const r = await hc(["exec", ...(m ? ["--on", m] : []), "--timeout", "20", "--", "sh", "-c", SESSION_OF, "sh", String(pid)]);
          id = sessionFrom(r.stdout, pid);
        }
        if (id) cx.write_to_clipboard(resumeLink(m, id));
      } catch {}
      const state = id ? "copied" : "failed";
      mark(state, cx);
      cx.timer.after(2000, (cx) => { if (this.linkState?.address === address && this.linkState.state === state) { this.linkState = null; cx.notify(); } });
    });
  }

  linkButton(t, address) {
    const st = this.linkState?.address === address ? this.linkState.state : null;
    return div().id(`ov-link-${address}`).flex_none().p(2).rounded(4).cursor_pointer()
      .text_color(st === "copied" ? t.ansi2 ?? t.foreground : st === "failed" ? t.blocked : t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(st === "copied" ? "Link copied" : st === "failed" ? "No session to link yet (send it a message first)" : "Copy a herdr-resume:// link to this session")
      .on_click((_e, cx) => { cx.stop_propagation(); this.copyLink(address, cx); })
      .child(svg("mods/agent-deck-overview/link.svg").size(12));
  }

  // agent-deck: the tag on an agent card opens the label editor (the agent-deck-labels mod).
  tagButton(t, address) {
    return div().id(`ov-tag-${address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Labels: role, task…")
      .on_click((_e, cx) => {
        cx.stop_propagation(); // not the card's own click (go to the agent)
        editLabels(address);
      })
      .child(svg("mods/agent-deck-labels/tag.svg").size(12));
  }

  // --- agent-deck: the task filter ----------------------------------------------------

  taskPicker(t, population) {
    const { tasks, none } = taskCounts(population);
    const f = this.taskFilter;
    const text = f === null ? "All" : f === NO_TASK ? "No task" : f;
    const trigger = h_flex().id("ov-task").flex_none().max_w(240).h(28).px(8).gap(6).items_center().rounded(7).border(1).border_color(f !== null ? t.accent : t.border).bg(t.chrome)
      .text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip("Show only one task's agents and terminals")
      .on_click((_e, cx) => { this.taskMenu = !this.taskMenu; cx.notify(); })
      .child(div().flex_none().text_color(t.dim).child("Task"))
      .child(div().min_w(0).truncate().text_color(t.foreground).child(text))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none().text_color(t.dim));
    const option = (id, value, label, n) => h_flex().id(`ov-task-opt-${id}`).px(8).py(4).gap(8).items_center().rounded(5).cursor_pointer()
      .when(f === value, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.setTaskFilter(value, cx); })
      .child(div().flex_1().min_w(0).truncate().text_color(value === NO_TASK || value === null ? t.dim : t.foreground).child(label))
      .child(div().flex_none().text_color(t.dim).child(String(n)));
    const menu = v_flex().id("ov-task-list").w(280).max_h(360).overflow_y_scrollbar().p(4).gap(1).rounded(8).bg(t.popover ?? t.surface).border(1).border_color(t.border).shadow_lg().text_size(12)
      .child(option("all", null, "All tasks", population.length))
      .children(tasks.map(([k, n], i) => option(i, k, k, n)))
      .child(option("none", NO_TASK, "No task", none));
    return Popup.new("ov-task-pop", trigger).flex_none().anchor("top_left").when(this.taskMenu, (el) => el.content(menu));
  }

  // agent-deck: a terminal's own labels (`hc label t7 role=reviewer`) as `key value` chips.
  chips(t, id, list) {
    // local: a chip narrows to fit a narrow card (its value truncates) instead of sticking out.
    return h_flex().id(`ov-chips-${id}`).flex_wrap().gap(4).min_w(0)
      .children(list.map(([k, v]) => h_flex().id(`ov-chip-${id}-${k}`).flex_shrink_1().min_w(0).max_w(200).gap(4).px(5).py(1).rounded(4).bg(t.chrome).border(1).border_color(t.border).text_size(10.5)
        .tooltip(`${k}=${v}`)
        .child(div().flex_none().text_color(t.dim).child(k))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(v))));
  }

  card(t, a, tab, now, labels) {
    const own = customLabels(labels);
    const since = a.status === "working" ? tab?.working_since : tab?.changed_at;
    const color = stateColor(t, a.status);
    return v_flex()
      .id(`ov-${a.address}`)
      // local: 240 to start, so a wide lane fits two to a line, yet never wider than its lane:
      // with min_w(240) a card in a narrow lane stuck out of it and lost its right edge.
      .flex_1()
      .flex_basis(240)
      .min_w(0)
      .px(10)
      .py(8)
      .gap(5)
      .rounded(8)
      .bg(a.focused ? t.selected : t.surface)
      .border(1)
      .border_color(a.status === "blocked" ? t.blocked : a.focused ? t.accent : t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        run("agent.focus", { terminal: a.address });
        this.dismiss();
      })
      .child(h_flex().gap(8).items_center().min_w(0)
        .when(Boolean(a.program?.icon), (el) => el.child(icon(a.program, 16, t.foreground)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(a.status === "idle" ? t.muted : t.foreground).child(chatName(a)))
        .when(a.program?.key === "claude", (el) => el.child(this.linkButton(t, a.address)))
        .child(this.tagButton(t, a.address))
        .child(div().flex_none().size(8).rounded(4).bg(color)))
      .child(h_flex().gap(6).items_center().min_w(0).text_size(11).text_color(t.dim)
        .child(div().flex_none().text_color(color).child(WORD[a.status]))
        .when(Boolean(since), (el) => el.child(div().flex_none().child(`· ${duration(now - since)}`)))
        .child(div().flex_1().min_w(0).truncate().text_right().child(`${a.space_name} · tab ${a.tab_name || a.tab_index}`)))
      .when(own.length > 0, (el) => el.child(this.chips(t, a.address, own)));
  }

  term(t, x, shown, title, status, now) {
    const g = x.program;
    const fg = x.foreground;
    // A command reads as typed: `make test`, not /usr/bin/make test.
    const running = g?.agent || g?.shell ? null : (fg?.argv?.length ? [fg.argv[0].split("/").pop(), ...fg.argv.slice(1)].join(" ") : g?.name);
    // An agent's state as the Agents tab has it ("done" turns "idle" once seen).
    const state = g?.agent ? status ?? x.status ?? "idle" : running ? "running" : "idle";
    const color = g?.agent ? t[state] ?? t.dim : running ? t.accent : t.dim;
    const name = g?.agent ? chatName({ title: title ?? x.title, program: g, address: x.address }) : running ?? `${g?.name ?? "shell"}`;
    const where = shown ? x.labels?.where ?? "" : "hidden";
    // An agent's screen is its own chrome; what it last reported says more.
    const lines = g?.agent ? (x.report?.msg ? [x.report.msg] : []) : this.preview[x.address] ?? [];
    const own = customLabels(x.labels);
    return v_flex()
      .id(`ov-t-${x.address}`)
      // local: as in card(), 260 to start but never wider than the lane (six machines leave ~217).
      .flex_1()
      .flex_basis(260)
      .min_w(0)
      .px(10)
      .py(8)
      .gap(5)
      .rounded(8)
      .bg(t.surface)
      .border(1)
      .border_color(state === "blocked" ? t.blocked : running ? t.accent + "80" : t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(shown ? "Go to it" : "Peek (it is in no space)")
      .on_click(() => {
        run(shown ? "pane.focus" : "terminal.peek", { terminal: x.address });
        this.dismiss();
      })
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(g?.icon ? icon(g, 15, t.foreground) : div().flex_none().text_size(11).text_color(t.dim).child(">_"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(state === "idle" ? t.muted : t.foreground).child(name))
        .when(g?.key === "claude", (el) => el.child(this.linkButton(t, x.address)))
        .when(Boolean(g?.agent), (el) => el.child(this.tagButton(t, x.address)))
        .child(div().flex_none().text_size(11).text_color(color).child(WORD[state] ?? state)))
      .child(h_flex().gap(6).items_center().min_w(0).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(short(fg?.cwd ?? x.cwd)))
        .child(div().flex_none().text_color(shown ? t.dim : t.done).child(where))
        .when(Boolean(x.created_ms), (el) => el.child(div().flex_none().child(`· ${duration(now - x.created_ms)}`))))
      .when(own.length > 0, (el) => el.child(this.chips(t, `t-${x.address}`, own)))
      .when(lines.length > 0, (el) => el.child(v_flex().px(6).py(4).rounded(4).bg(t.chrome).font_family(settings()?.font_family ?? "monospace").text_size(10.5).text_color(t.dim)
        .children(lines.map((l, i) => div().id(`ov-tl-${x.address}-${i}`).truncate().child(l)))));
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const live = terminals().filter((x) => x.state === "live");
    const byAddress = new Map(live.map((x) => [x.address, x]));
    const all = agents().map((a) => (waits(a.status, byAddress.get(a.address)) ? { ...a, status: "waiting" } : a));
    const sp = spaces();
    const tabs = new Map(sp.flatMap((s) => s.tabs).map((x) => [x.id, x]));
    const inPanes = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const names = this.machineNames();

    const spaceOf = new Map(sp.map((s) => [s.id, s]));
    const machineOfAgent = (a) => spaceOf.get(a.space)?.machine ?? null;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const shownAgents = all.filter((a) => taskMatches(byAddress.get(a.address)?.labels, this.taskFilter)
      && matches(words, chatName(a), a.program?.name, WORD[a.status], a.space_name, a.tab_name, machineOfAgent(a) ?? "this computer local"));
    // Filtering by words or by task: tabs read `shown/all`, empty lanes `No match`.
    const filtering = words.length > 0 || this.taskFilter !== null;

    // A strip of machines: state, hc version, terminals.
    const strip = h_flex().id("ov-machines").flex_none().flex_wrap().gap(8).px(16).py(8).border_b(1).border_color(t.border)
      .children(names.map((m) => {
        const machine = this.machines.find((k) => k.name === m);
        const connected = !m || machine?.state === "connected";
        const terms = live.filter((x) => machineOf(x.address) === m);
        const hidden = terms.filter((x) => !inPanes.has(x.address)).length;
        const n = all.filter((a) => machineOfAgent(a) === m).length;
        return h_flex().id(`ov-m-${m ?? "local"}`).gap(6).items_center().px(8).py(3).rounded(6).bg(t.surface).text_size(11).text_color(t.dim)
          .tooltip(`${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}${machine?.version ? ` · hc ${machine.version}` : ""} · ${terms.length} terminals${hidden ? `, ${hidden} hidden` : ""}`)
          .child(div().size(7).rounded(4).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(div().text_color(t.foreground).child(m ?? "This computer"))
          .child(div().child(`${n} agent${n === 1 ? "" : "s"} · ${terms.length} terms`));
      }));

    // A lane per state, in this order; inside, agents grouped by machine.
    const LANES = ["working", "blocked", "done", "idle"];
    const lane = (k) => {
      // agent-deck: the Working lane holds waiting agents too, busy ones first.
      const list = shownAgents.filter((a) => a.status === k || (k === "working" && a.status === "waiting"));
      const groups = names.map((m) => [m, list.filter((a) => machineOfAgent(a) === m).sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || y.seq - x.seq)]).filter(([, g]) => g.length);
      // An empty lane keeps a narrow column; the others share the rest.
      return v_flex().id(`ov-lane-${k}`).when(list.length > 0, (el) => el.flex_1().min_w(0)).when(list.length === 0, (el) => el.w(150).flex_none()).min_h(0).rounded(10).bg(t.chrome).border(1).border_color(t.border)
        .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(2).border_color(t[k] ?? t.border)
          .child(div().size(8).rounded(4).flex_none().bg(t[k] ?? t.dim))
          .child(div().font_semibold().text_color(t.foreground).child(k === "blocked" ? "Needs you" : WORD[k][0].toUpperCase() + WORD[k].slice(1)))
          .child(div().text_size(12).text_color(t.dim).child(String(list.length))))
        .child(v_flex().id(`ov-lane-body-${k}`).flex_1().min_h(0).p(8).gap(10).overflow_y_scrollbar()
          .when(list.length === 0, (el) => el.child(div().p(4).text_size(12).text_color(t.dim).child(filtering ? "No match" : "None")))
          .children(groups.map(([m, g]) => v_flex().id(`ov-${k}-${m ?? "local"}`).gap(6).flex_none()
            .child(h_flex().gap(6).items_center().px(2).text_size(11).text_color(t.dim)
              .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(12).flex_none())
              .child(div().flex_1().truncate().child(m ?? "This computer"))
              .child(div().child(String(g.length))))
            // Several cards to a line when the lane is wide enough.
            .child(h_flex().flex_wrap().items_start().gap(6).children(g.map((a) => this.card(t, a, tabs.get(a.tab), now, byAddress.get(a.address)?.labels)))))));
    };

    // Terminals: a lane per machine; shown ones first, busy before idle, hidden last.
    const statusOf = new Map(all.map((a) => [a.address, a.status]));
    const titles = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p.title]));
    const shownTerms = live.filter((x) => taskMatches(x.labels, this.taskFilter) && matches(words, x.address, x.program?.name, x.foreground?.argv?.join(" "), x.title, titles.get(x.address), x.cwd, x.foreground?.cwd, x.labels?.where, inPanes.has(x.address) ? "" : "hidden", x.report?.msg, this.preview[x.address], machineOf(x.address) ?? "this computer local"));
    const termLane = (m) => {
      const machine = this.machines.find((k) => k.name === m);
      const connected = !m || machine?.state === "connected";
      const rank = (x) => (inPanes.has(x.address) ? 0 : 4) + (x.program?.agent ? 1 : x.program?.shell ? 2 : 0);
      const list = shownTerms.filter((x) => machineOf(x.address) === m).sort((a, b) => rank(a) - rank(b) || (b.created_ms ?? 0) - (a.created_ms ?? 0));
      const busyN = list.filter((x) => !x.program?.agent && !x.program?.shell).length;
      const hidden = list.filter((x) => !inPanes.has(x.address)).length;
      return v_flex().id(`ov-tlane-${m ?? "local"}`).flex_1().min_w(0).min_h(0).rounded(10).bg(t.chrome).border(1).border_color(t.border)
        .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(2).border_color(connected ? t.ansi2 : t.border)
          .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none().text_color(t.muted))
          .child(div().flex_shrink_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(m ?? "This computer"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child([`${list.length}`, busyN && `${busyN} running`, hidden && `${hidden} hidden`].filter(Boolean).join(" · ")))
          .child(div().flex_1())
          .when(connected, (el) => el.child(div().id(`ov-tnew-${m ?? "local"}`).flex_none().p(3).rounded(4).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(`New space on ${m ?? "this computer"}`)
            .on_click(() => this.newTerminal(m))
            .child(svg("mods/workspace-chrome/plus.svg").size(13)))))
        .when(Boolean(this.usage[m ?? ""]), (el) => el.child(this.usageRow(t, m)))
        .child(v_flex().id(`ov-tlane-body-${m ?? "local"}`).flex_1().min_h(0).p(8).overflow_y_scrollbar()
          .when(list.length === 0, (el) => el.child(div().p(4).text_size(12).text_color(t.dim).child(connected ? "No terminals" : (machine?.state ?? "asleep").replace(/_/g, " "))))
          .child(h_flex().flex_wrap().items_start().gap(6).children(list.map((x) => this.term(t, x, inPanes.has(x.address), titles.get(x.address), statusOf.get(x.address), now)))));
    };
    const tabBtn = (id, text) => div().id(`ov-tab-${id}`).px(10).py(3).rounded(6).text_size(12).cursor_pointer()
      .when(this.tab === id, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(this.tab !== id, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => this.show(id, cx))
      .child(text);
    const onTerms = this.tab === "terminals";

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.background ?? t.chrome)
      // Esc closes the task menu first, then clears the filter, then closes.
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.taskMenu) { this.taskMenu = false; cx.notify(); }
        else if (this.query) this.clearFilter(cx);
        else this.dismiss();
        cx.stop_propagation();
      })
      .child(h_flex().h(44).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Overview"))
        .child(h_flex().gap(2).p(2).rounded(8).bg(t.chrome)
          .child(tabBtn("agents", filtering ? `Agents ${shownAgents.length}/${all.length}` : `Agents ${all.length}`))
          .child(tabBtn("terminals", filtering ? `Terminals ${shownTerms.length}/${live.length}` : `Terminals ${live.length}`)))
        .child(div().text_size(12).text_color(t.dim).child(`${names.length} machine${names.length === 1 ? "" : "s"}`))
        // agent-deck: type to hide the cards that don't match.
        .child(h_flex().id("ov-filter").flex_1().max_w(360).h(28).px(8).gap(6).items_center().rounded(7).border(1).border_color(words.length ? t.accent : t.border).bg(t.chrome)
          .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
          .when(words.length > 0, (el) => el.child(div().id("ov-filter-clear").flex_none().text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .tooltip("Clear (Esc)")
            .on_click((_e, cx) => this.clearFilter(cx))
            .child(svg("mods/workspace-chrome/x.svg").size(12)))))
        // agent-deck: the task filter; counts are of the tab it is on.
        .child(this.taskPicker(t, onTerms ? live : all.map((a) => ({ labels: byAddress.get(a.address)?.labels }))))
        .child(div().flex_1())
        .when(!onTerms, (el) => el.children(this.pills(t, shownAgents)))
        .when(onTerms, (el) => el.child(div().id("ov-usage").px(10).py(3).rounded(6).border(1).border_color(t.border).text_size(12).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("CPU, memory and disk use of every machine")
          .on_click((_e, cx) => this.measure(names, cx))
          .child(Object.values(this.usage).some((u) => u.loading) ? "Usage…" : "Usage")))
        .child(div().id("ov-close").p(4).rounded(4).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.dismiss())
          .tooltip("Close (Esc)")
          .child(svg("mods/workspace-chrome/x.svg").size(14))))
      .child(strip)
      .child(h_flex().id("ov-body").flex_1().min_h(0).p(12).gap(10).items_stretch().children(onTerms ? names.map(termLane) : LANES.map(lane)));
  }
}
