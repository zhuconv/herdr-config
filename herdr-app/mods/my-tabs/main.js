import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings,
  terminals, focused, machines, hc, exec, notify, nextCommand, agents, setShared } from "herdr";
import { Reopener } from "./reopen.js";
import { Waiting } from "./waiting.js";
import { Recent } from "./recent.js";

// Shared with mods/agent-switcher: { list, index, from, at, alive } while the ⌃Tab popup is open.
const SWITCH = "my-tabs.switcher";

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
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
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
    this.visits = cx.timer.every(300, () => this.visit());
  }

  visit() {
    const a = agents().find((x) => x.focused);
    if (a && this.recent.visit(a.address)) localStorage.setItem("recent", JSON.stringify(this.recent.order));
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

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.reopen.close(cx, c.id); }).child(svg("mods/pane/close.svg").size(12))));
    };
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
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(overviewButton)
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/my-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/my-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
