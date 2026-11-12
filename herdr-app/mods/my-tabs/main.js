import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings,
  terminals, focused, machines, hc, exec, notify, nextCommand, agents, setShared, home } from "herdr";
import { Reopener } from "./reopen.js";
import { Waiting } from "./waiting.js";
import { Recent } from "./recent.js";
import { tabsOf, agentKeys, tabProject, tabGroups, nthTab, dropZone, withDirColors, place, withGroup, shortPath, ownerOf } from "./projects.js";

// Shared with mods/agent-switcher: { list, index, from, at, alive } while the ⌃Tab popup is open.
const SWITCH = "my-tabs.switcher";

// The bar shows one project's tabs (from every space), grouped by directory like the left
// panel's pills (mods/my-projects; projects.js is a copy of its model). Shared with it: its
// projects, its pill order, the project picked there ({ project, at }), each project's
// last-used pane, each directory's color; and from here, the project shown ({ project }) and
// the tabs' dragged order (tab ids, one list).
const STATE = "my-projects.state";
const PILLS = "my-projects.pills";
const PICK = "my-projects.pick";
const LAST = "my-projects.last";
const DIRCOLORS = "my-projects.groupcolors";
const ICONS = "my-projects.icons";
const SHOWN = "my-tabs.project";
const ORDER = "my-tabs.order";
const UNSORTED = "\u0000unsorted";

const projectState = () => {
  const s = shared(STATE);
  return s && Array.isArray(s.projects) ? { projects: s.projects, loose: s.loose ?? [] } : { projects: [], loose: [] };
};
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(36);
// A color at some opacity ("80" = 50%), when it's a plain #rrggbb; else the fallback.
const faint = (c, alpha, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + alpha : fallback);
// Every tab, with the agents it lists (projects.js tabsOf), told apart as the left panel does.
const allTabs = () => tabsOf(spaces(), panes(), agents(), agentKeys(shared("new-menu.agents")));
const select = (tab) => { run("space.select", { id: tab.space }); run("tab.select", { id: tab.id }); };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    let folded = [];
    try { folded = JSON.parse(localStorage.getItem("folded") ?? "[]"); } catch {}
    this.folded = new Set(Array.isArray(folded) ? folded : []); // folded directory groups
    // Focus: a project picked in the left panel shows until it moves (track()).
    this.focusPane = focused()?.pane ?? null;
    this.focusAt = Date.now();
    this.published = undefined; // the project last said to be shown
    this.view = []; // the groups as drawn: data, for the wheel and drags
    // A drag: a tab ({ kind: "tab", id }) or one pane of a split ({ kind: "pane", id, pane,
    // terminal }), pressed at x, y; it counts once the pointer has gone 5 px.
    this.drag = null;
    this.over = null; // the tab under the pointer while dragging: { id, x (0–1 across it) }
    this.hit = null; // the tab the pointer event now going up the tree passed through
    this.pressPane = null; // the pane of a split pressed (its segment hears the press first)
    this.hoverTab = null; // the tab under the pointer: its close button shows
    // my-tabs: ⌘W parks the focused pane, or the tab with its last pane, so that ⌘⇧W can
    // bring it back (reopen.js). keys.json binds them as my-tabs.close / my-tabs.reopen;
    // "close <tab or pane id>" closes that one instead of the focused one.
    this.reopen = new Reopener({ spaces, panes, terminals, focused, machines, run, hc, exec, notify },
      { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) });
    this.commands = cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand());
        try {
          if (c === "close" || c.startsWith("close ")) this.reopen.close(cx, c.slice(6).trim() || null);
          else if (c === "reopen") await this.reopen.reopen(cx);
          else if (c === "waiting" || c === "waiting away") this.goWaiting(c === "waiting away");
          else if (c === "switch" || c === "switch-back") this.switchAgent(c === "switch" ? 1 : -1);
          else if (c === "switch-preview") this.switchAgent(1, true);
          else if (/^tab-[1-9]$/.test(c)) this.goTab(Number(c.slice(4)), cx);
        } catch (err) {
          console.log("my-tabs", c, String(err?.stack ?? err));
        }
      }
    });
    this.sweeper = cx.timer.every(15000, () => this.reopen.sweep());
    // my-tabs: "waiting" (⌘G) goes to the agent that rang last (waiting.js). "waiting away"
    // comes from the Raycast hotkey (~/Documents/Raycast/bear/herdr-waiting.sh) when Herdr wasn't
    // in front, so the focused agent isn't one you were looking at.
    this.waiting = new Waiting();
    this.tracker = cx.timer.every(1000, () => this.waiting.track(agents(), Date.now()));
    // my-tabs: ⌃Tab / ⌃⇧Tab ("switch" / "switch-back") open the agent switcher
    // (mods/agent-switcher) over the agents in the order you last visited them (recent.js).
    this.recent = new Recent(JSON.parse(localStorage.getItem("recent") ?? "[]"));
    if (shared(SWITCH)) setShared(SWITCH, null); // no popup survives a restart
    this.visits = cx.timer.every(300, (cx) => { this.visit(); if (this.track()) cx.notify(); });
  }

  visit() {
    const a = agents().find((x) => x.focused);
    if (a && this.recent.visit(a.address)) localStorage.setItem("recent", JSON.stringify(this.recent.order));
  }

  // Focus moved: note when (a project picked in the left panel shows until then), and keep the
  // pane as its project's last-used one. True when it moved.
  track() {
    const f = focused(), pane = f?.pane ?? null;
    if (pane === this.focusPane) return false;
    this.focusPane = pane;
    this.focusAt = Date.now();
    const tab = pane ? allTabs().find((t) => t.id === f.tab) : null;
    if (tab) {
      const key = tabProject(tab, projectState()) ?? UNSORTED, last = shared(LAST) ?? {};
      if (last[key] !== pane) setShared(LAST, { ...last, [key]: pane });
    }
    return true;
  }

  // The project shown (null: Unsorted): the one picked in the left panel while focus hasn't
  // moved since, else the focused tab's.
  shownProject(tabs, st) {
    const pick = shared(PICK), tab = tabs.find((t) => t.id === focused()?.tab);
    if (pick && pick.at > this.focusAt) return pick.project ?? null;
    return tab ? tabProject(tab, st) : pick?.project ?? null;
  }

  // The shown project's tabs, by directory.
  bar() {
    const st = projectState(), tabs = allTabs();
    const project = this.shownProject(tabs, st);
    const groups = tabGroups(tabs, st, project, { home: home(), pills: shared(PILLS) ?? [], order: shared(ORDER) ?? [] });
    return { st, project, groups };
  }

  // ⌘1–⌘9 ("tab-1"…"tab-9" in keys.json): the bar's tabs (nthTab). Herdr's own tab.select
  // counts the space's tabs, and a space holds other projects' tabs too. A folded group opens
  // to show the tab picked in it.
  goTab(n, cx) {
    this.track();
    const groups = this.bar().groups, tab = nthTab(groups, n);
    if (!tab) return;
    const g = groups.find((x) => x.tabs.includes(tab));
    if (g && this.folded.delete(g.key)) { this.saveFolds(); cx.notify(); }
    select(tab);
  }

  saveFolds() {
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
  }

  // While the popup is open, ⌃Tab only moves its selection; letting go of ⌃ switches.
  // preview: the popup shows for a moment without the keyboard (for checking its look).
  switchAgent(step, preview = false) {
    const open = shared(SWITCH);
    // A popup that never came up (alive is set by the popup itself) doesn't count.
    if (!preview && open?.list?.length && (open.alive || Date.now() - open.at < 1000)) {
      setShared(SWITCH, { ...open, index: (open.index + step + open.list.length) % open.list.length });
      return;
    }
    this.visit();
    const all = agents(), current = all.find((a) => a.focused)?.address ?? null;
    const list = this.recent.list(all, current).slice(0, 15);
    if (list.length - (current ? 1 : 0) < 1) {
      notify({ title: "No other agent to switch to", timeout: 2500 });
      return;
    }
    // Like ⌘Tab: the current agent shows first and the one before it is picked.
    const index = step > 0 ? (current ? 1 : 0) : list.length - 1;
    setShared(SWITCH, { list, index, from: focused()?.pane ?? null, at: Date.now(), alive: false });
    openOverlay({ mod: "agent-switcher", kind: "window", frame: "none", props: { preview } });
  }

  goWaiting(away) {
    const list = agents();
    this.waiting.track(list, Date.now());
    const a = this.waiting.pick(list, !away);
    if (a) run("pane.focus", { pane: a.pane });
    else notify({ title: "No agent is waiting for you", timeout: 2500 });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // ---- dragging tabs

  press(d, e) {
    this.drag = { ...d, x: e.position.x, y: e.position.y, moved: false, at: null, grab: e.local_position ?? { x: 14, y: 14 } };
    this.over = null;
  }

  // The pointer moved over the bar. The tab it passed through on the way said which.
  dragMove(e, cx) {
    const hit = this.hit, d = this.drag;
    this.hit = null;
    if (!d) return;
    if (!d.moved && Math.abs(e.position.x - d.x) + Math.abs(e.position.y - d.y) < 5) return;
    d.moved = true;
    d.at = e.local_position;
    d.alt = Boolean(e.modifiers?.alt);
    this.over = hit;
    cx.notify();
  }

  tabOf(id) {
    for (const g of this.view) {
      const tab = g.tabs.find((t) => t.id === id);
      if (tab) return { tab, group: g };
    }
    return null;
  }

  // Where the drag would land: { tab, group, zone } over a tab (zone: see dropZone), { blank }
  // over the bar's free space with one pane of a split (it becomes a tab of its own).
  target() {
    const d = this.drag;
    if (!d?.moved) return null;
    const src = this.tabOf(d.id);
    if (!this.over) return d.kind === "pane" && src ? { blank: true } : null;
    const dst = this.tabOf(this.over.id);
    if (!src || !dst) return null;
    const zone = dropZone(src.tab, dst.tab, this.over.x, d.kind === "tab" && src.group.key === dst.group.key);
    return zone ? { tab: dst.tab, group: dst.group, zone } : null;
  }

  drop(cx) {
    const d = this.drag, to = this.target();
    this.drag = null;
    this.over = null;
    if (!d) return;
    if (to?.blank) cx.spawn(async (cx) => this.unsplit(cx, d));
    else if (to?.zone === "merge") cx.spawn(async (cx) => this.merge(cx, d, to.tab));
    else if (to?.zone === "before" || to?.zone === "after") {
      const ids = to.group.tabs.map((t) => t.id);
      setShared(ORDER, withGroup(shared(ORDER) ?? [], place(ids, d.id, to.tab.id, to.zone === "after")));
    }
    cx.notify();
  }

  cancel(cx) {
    if (!this.drag) return;
    this.drag = null;
    this.over = null;
    cx.notify();
  }

  // Waits (up to 10 s: parking and keeping wait for the terminal's machine) until the terminal
  // is or isn't shown in a pane.
  async shown(cx, terminal, want) {
    for (let i = 0; i < 100 && panes().some((p) => p.terminal === terminal) !== want; i++) await cx.sleep(100);
    return panes().some((p) => p.terminal === terminal) === want;
  }

  // A tab's terminals (or one pane's) join another tab as splits beside its first pane (⌥: below
  // it): that tab gets shown and focused, then each terminal is parked (its pane goes, it keeps
  // running) and given a pane there. The tab they left goes with its last pane.
  async merge(cx, d, dst) {
    const src = allTabs().find((t) => t.id === d.id);
    const moving = d.kind === "pane" ? [d.terminal] : (src?.panes ?? []).map((p) => p.terminal).filter(Boolean);
    const anchor = [...dst.listed, ...dst.panes].find((p) => p.terminal)?.pane;
    if (!moving.length || !anchor) return;
    select(dst);
    run("pane.focus", { pane: anchor });
    await cx.sleep(150);
    for (const terminal of moving) {
      run("terminal.park", { terminal });
      if (!(await this.shown(cx, terminal, false))) continue;
      run("terminal.keep", { terminal, place: d.alt ? "down" : "right" });
      await this.shown(cx, terminal, true);
    }
    cx.notify();
  }

  // One pane of a split becomes a tab of its own, in the same space.
  async unsplit(cx, d) {
    const src = allTabs().find((t) => t.id === d.id);
    if (d.kind !== "pane" || !d.terminal || !src) return;
    run("space.select", { id: src.space });
    run("terminal.park", { terminal: d.terminal });
    if (!(await this.shown(cx, d.terminal, false))) return;
    run("terminal.keep", { terminal: d.terminal, place: "tab" });
    if (await this.shown(cx, d.terminal, true)) {
      // A tab made for a kept terminal is named after it ("t2v"): give it Herdr's own name.
      const tab = panes().find((p) => p.terminal === d.terminal)?.tab;
      if (tab) run("tab.rename", { id: tab, name: "" });
    }
    cx.notify();
  }

  // ---- drawing

  programIcon(t, program) {
    if (!program?.icon) return null;
    return program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none();
  }

  // An agent's state. Done is a check, never a dot: dots mean groups here.
  mark(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (status === "done") return svg("mods/workspace-chrome/check.svg").size(12).flex_none().text_color(t.ansi4 ?? t.done);
    if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(faint(t.blocked, "2e", t.hover)).text_size(10.5).font_bold()
      .text_color(t.blocked).flex().items_center().justify_center().child("!");
    return null;
  }

  // One pane a tab lists (its agents: terminals beside them aren't): its program, name and
  // state. When it lists more than one, pressing one drags that pane.
  segment(t, tab, p, i) {
    const icon = this.programIcon(t, p.program), m = this.mark(t, p.status);
    const many = tab.listed.length > 1;
    return h_flex().id(`seg-${hash(p.pane)}`).gap(7).items_center().min_w(0)
      .when(many && Boolean(p.terminal), (el) => el.on_mouse_down("left", () => { this.pressPane = { pane: p.pane, terminal: p.terminal, name: p.name, program: p.program }; }))
      .when(i > 0, (el) => el.child(div().w(1).h(14).mr(2).flex_none().bg(t.border)))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().max_w(170).truncate().child(p.name))
      .when(Boolean(m), (el) => el.child(m));
  }

  // A tab: only its own background says it's the shown one. It always keeps room for its close
  // button (shown on the shown tab and under the pointer), so picking a tab changes no width.
  // While a tab is dragged, everything stays gray: the tab it would join turns the hover gray
  // and shows a split icon, a gray line marks where it would move to instead, and another
  // machine's tab doesn't light up (the pointer says no).
  tab(t, g, tab, color, active) {
    const on = tab.id === active, d = this.drag, to = d?.moved ? this.target() : null;
    const aimed = to && !to.blank && to.tab.id === tab.id ? to.zone : null;
    const lifted = d?.moved && d.id === tab.id && d.kind === "tab";
    return h_flex().id(`tab-${tab.id}`).relative().h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
      .when(!on && !d?.moved, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((inside, cx) => {
        if (inside && this.hoverTab !== tab.id) { this.hoverTab = tab.id; cx.notify(); }
        else if (!inside && this.hoverTab === tab.id) { this.hoverTab = null; cx.notify(); }
      })
      .when(lifted, (el) => el.opacity(0.4))
      .when(aimed === "merge", (el) => el.bg(t.hover))
      .when(aimed === "deny", (el) => el.cursor_not_allowed())
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation(); // a press on a tab doesn't drag the window
        const p = this.pressPane;
        this.pressPane = null;
        if (e.click_count === 2) { run("tab.rename", { id: tab.id }); return; }
        this.press(p ? { kind: "pane", id: tab.id, ...p } : { kind: "tab", id: tab.id, name: tab.listed[0]?.name, program: tab.listed[0]?.program, count: tab.listed.length }, e);
      })
      .on_mouse_move((e) => { if (this.drag) this.hit = { id: tab.id, x: e.local_position.x / (e.bounds?.width || 1) }; })
      // A release that ends a drag isn't a click.
      .on_click(() => { if (!this.drag?.moved) select(tab); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: tab.space } } }); })
      .children(tab.listed.map((p, i) => this.segment(t, tab, p, i)))
      .child(div().id(`close-${tab.id}`).size(14).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim)
        .opacity(on || this.hoverTab === tab.id ? 1 : 0).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.reopen.close(cx, tab.id); }).child(svg("mods/pane/close.svg").size(12)))
      .when(aimed === "merge", (el) => el.child(svg("mods/workspace-chrome/panel-right.svg").size(13).flex_none().text_color(t.muted)))
      .when(aimed === "before" || aimed === "after", (el) => el.child(div().absolute().top(4).bottom(4).w(2).rounded(1).bg(t.muted)
        .when(aimed === "before", (line) => line.left(-5)).when(aimed === "after", (line) => line.right(-5))));
  }

  // A group, with no name: a dot in its directory's color (its pill's dot on the left; on hover
  // it names the directory, a click folds the group and leaves the dot and its tab count), its
  // tabs, and a thin line in that color, equally strong all along, under all of it.
  group(t, g, color, active) {
    const folded = this.folded.has(g.key);
    const dot = h_flex().id(`grp-${hash(g.key)}`).h(29).px(7).gap(5).flex_none().items_center().rounded(7)
      .text_size(11.5).font_semibold().text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`${g.machine ?? "local"} · ${shortPath(g.path, g.machine ? null : home())}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { folded ? this.folded.delete(g.key) : this.folded.add(g.key); this.saveFolds(); cx.notify(); })
      .child(div().size(7).flex_none().rounded(4).bg(color))
      .when(folded, (el) => el.child(String(g.tabs.length)));
    return h_flex().id(`group-${hash(g.key)}`).relative().h_full().flex_none().gap(2).items_center()
      .child(dot)
      .when(!folded, (el) => el.children(g.tabs.map((tab) => this.tab(t, g, tab, color, active))))
      .child(div().absolute().left(2).right(2).bottom(3).h(1).rounded(1).bg(faint(color, "b3", color)));
  }

  // The dragged tab or pane, where the pointer holds it: it looks like the shown tab, lifted.
  // Pointer positions are screen pixels; sizes are scaled by the zoom setting, so the offset is
  // divided by it.
  ghost(t) {
    const d = this.drag;
    if (!d?.moved || !d.at) return null;
    const z = Number(settings()?.zoom) || 1, icon = this.programIcon(t, d.program);
    return h_flex().absolute().left((d.at.x - d.grab.x) / z).top((d.at.y - d.grab.y) / z).h(29).px(10).gap(7).rounded(7).items_center()
      .text_size(12.8).text_color(t.foreground).border(1).border_color(t.border).bg(t.raised).shadow_md()
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().max_w(170).truncate().child(d.name ?? ""))
      .when(d.kind === "tab" && d.count > 1, (el) => el.child(div().text_color(t.muted).child(`+${d.count - 1}`)));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    this.track();
    const { st, project, groups } = this.bar();
    if (this.published !== project) { this.published = project; setShared(SHOWN, { project }); }
    // Each directory's color (the left panel gives most; this one, to directories with no pill):
    // colors already given to the project's directories, and its icon's, count as used.
    const stored = shared(DIRCOLORS) ?? {};
    const owned = Object.keys(stored).filter((k) => ownerOf(k, st.projects, st.loose) === project);
    const icon = project === null ? null : (shared(ICONS) ?? {})[project]?.color ?? null;
    const given = withDirColors(stored, [{ keys: [...new Set([...groups.map((g) => g.key), ...owned])], icon }]);
    if (given) setShared(DIRCOLORS, given);
    const colors = given ?? stored;
    this.view = groups;
    const active = focused()?.tab ?? null;
    const flat = groups.filter((g) => !this.folded.has(g.key)).flatMap((g) => g.tabs);
    const to = this.drag?.moved ? this.target() : null;
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    // my-tabs: opens the agent-deck Overview dialog (every agent and terminal on every
    // machine), the same as cmd-shift-o; mod.open toggles it.
    const overviewButton = h_flex().id("overview-open").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(t.chrome).text_color(t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .tooltip("Every agent and terminal on every machine (⌘⇧O)")
      .on_click(() => run("mod.open", { name: "agent-deck-overview" }))
      .child(svg("mods/workspace-chrome/layers.svg").size(14)).child("Overview");
    const ghost = this.ghost(t);
    return h_flex().id("tabs-bar").relative().overflow_hidden().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      // Drags. Each tab notes that the pointer is over it (this.hit) before this hears the move.
      .on_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(cx))
      .on_hover((inside, cx) => { if (!inside) this.cancel(cx); })
      // The wheel goes through the shown tabs.
      .on_scroll_wheel(e => {
        if (Math.abs(e.delta.y) < 1 || !flat.length) return;
        const i = flat.findIndex((x) => x.id === active), step = e.delta.y > 0 ? -1 : 1;
        select(flat[((i < 0 ? 0 : i + step) + flat.length) % flat.length]);
      })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(13).overflow_x_scrollbar()
        .when(!groups.length, (el) => el.child(div().px(6).text_size(12).text_color(t.dim).child(`No tabs in ${project ?? "Unsorted"} yet`)))
        .children(groups.map((g) => this.group(t, g, colors[g.key] ?? t.accent, active)))
        // One pane of a split let go here becomes a tab of its own.
        .when(Boolean(to?.blank), (el) => el.child(h_flex().h(29).px(12).ml(6).flex_none().items_center().rounded(7)
          .bg(t.hover).text_size(12).text_color(t.muted).child("New tab"))))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(overviewButton)
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/my-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/my-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))))
      .when(Boolean(ghost), el => el.child(ghost));
  }
}
