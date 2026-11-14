// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status. Props from the app:
// { pane, terminal }. Click: focus the pane.
// my-pane (a clone of Herdr's pane 0.1.15): instead of split, zoom and close, two buttons, on
// hover. Fork, for a pane running Claude: a copy of its conversation, started beside it
// (fork.js). Move to new tab, for a pane of a split: it gets a tab of its own (mods/my-tabs
// "split-out", which the tab bar's drags and right-click menus use too). Keys and the
// right-click menu still split, zoom and close.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, hc, exec, notify } from "herdr";
import { claudeIn, FIND, pick, forkArgv } from "./fork.js";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

const machineOf = (address) => {
  const a = String(address ?? "");
  return a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : null;
};

// Starts a copy of the conversation the pane shows, to its right, in the session's folder on
// its machine. null when it started, else why not.
async function startFork(p) {
  const got = JSON.parse((await hc(["get", p.terminal, "--json"])).stdout || "{}");
  const fg = got.foreground ?? {};
  const want = claudeIn(fg.argv);
  if (!want || !fg.pid) return "Claude isn't running in this pane.";
  const r = await exec("/bin/sh", ["-c", FIND, "sh", String(fg.pid), want.attach ?? ""], { on: machineOf(p.terminal), timeout: 15000 });
  const found = pick(r.stdout, want.attach);
  if (!found) return "Claude Code has no record of the conversation in this pane.";
  const dir = found.cwd ?? p.cwd;
  run("pane.focus", { pane: p.pane });
  run("terminal.open", { argv: forkArgv(found), place: "right", ...(dir ? { folder: dir } : {}) });
  return null;
}

export default class Pane extends View {
  init() { this.hovered = false; this.forking = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, tip, act) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        act(cx);
      })
      .child(svg(`mods/my-pane/${icon}.svg`).size(14));
  }

  fork(p, cx) {
    if (this.forking) return;
    this.forking = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let why;
      try { why = await startFork(p); } catch (e) { why = String(e?.message ?? e); }
      this.forking = false;
      cx.notify();
      if (why) notify({ title: "Couldn't fork", body: why, level: "warning" });
    });
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    const split = Boolean(p.terminal) && panes().filter((x) => x.tab === p.tab).length > 1;
    const claude = Boolean(p.terminal) && (p.program?.key === "claude" || p.app === "claude-code");
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered && claude, el => el
        .child(this.button(t, `ph-fork-${pane}`, "fork", "Fork: a copy of this conversation, beside it", (cx) => this.fork(p, cx))
          .when(this.forking, b => b.opacity(0.4))))
      .when(this.hovered && split, el => el
        .child(this.button(t, `ph-out-${pane}`, "pop-out", "Move to new tab", () => run(`my-tabs.split-out ${p.terminal}`))));
  }
}
