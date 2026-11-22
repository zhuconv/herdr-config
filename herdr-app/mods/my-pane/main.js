// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" } } } }
// Shows the program's icon (the app's program table), the session's name (an
// agent's: the name it gave itself, as the Agents list shows it) or the
// terminal's title, the folder, and the agent's status. Props from the app:
// { pane, terminal }. Click: focus the pane.
// my-pane (a clone of Herdr's pane 0.1.15): instead of split, zoom and close, two buttons, on
// hover. Fork, for a pane running Claude (or showing one on a compute node, through ssh): a
// copy of its conversation, started beside it (fork.js). Move to new tab, for a pane of a
// split: it gets a tab of its own (mods/my-tabs "split-out", which the tab bar's drags and
// right-click menus use too). Keys and the right-click menu still split, zoom and close.
// And a flash: the header of the pane ⌘G goes to lights up and fades (flashState).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, hc, exec, notify, shared, window } from "herdr";
import { claudeIn, FIND, pick, forkArgv, elsewhere, remoteArgv } from "./fork.js";

// ⌘G (mods/my-tabs "waiting") marks the pane it goes to: shared("my-tabs.flash") is { pane, at }.
// That pane's header lights up, holds a moment and fades, so you can tell which pane of the tab
// it is. The header, not the border: Herdr draws the border, and a mod can't change it while it
// runs. Dracula's purple, brighter than the layout's focus border (#6272a4).
const FLASH = "my-tabs.flash";
const FLASH_COLOR = "#bd93f9";
const HOLD = 600, FADE = 900; // ms: lit, then fading

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

// An agent's name, as the Agents list gives it: the title it set, when that says something
// (Claude Code's session name, else its own short title for the conversation; a Codex thread's
// name, the folder after " | " left out), else the program's name. Claude puts a spinner or a
// mark before its title; the name is what follows.
function agentName(p) {
  const prog = p.program?.name ?? "";
  let raw = String(p.title ?? "").trim();
  if (p.program?.key === "codex") raw = raw.replace(/\s+\|\s+[^|]+$/, "");
  const live = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const telling = Boolean(live) && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !live.includes("@") && live !== prog
    && live.toLowerCase() !== p.program?.key && live !== String(p.terminal ?? "").split("/").pop();
  return telling ? live : prog;
}

const machineOf = (address) => {
  const a = String(address ?? "");
  return a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : null;
};

// Where a pane's terminal runs: its folder (home as ~), after its machine when that's another
// one ("gpu1 · ~"): a worker kept as a tab sits with its starter, whose folder its tab shows. Another
// machine's home is guessed as the left panel does (/home/<user>, /Users/<user>, TACC's
// /home1/<group>/<user>).
function where(p) {
  const machine = machineOf(p.terminal);
  if (!machine) return folder(p.cwd);
  const cwd = String(p.cwd ?? "").replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~").replace(/^\/home\d+\/\d+\/[^/]+(?=\/|$)/, "~");
  return `${machine} · ${cwd || "~"}`;
}

// Starts a copy of the conversation the pane shows, to its right, in the session's folder on
// its machine, or on the host its Claude runs on. null when it started, else why not.
async function startFork(p) {
  const got = JSON.parse((await hc(["get", p.terminal, "--json"])).stdout || "{}");
  const fg = got.foreground ?? {};
  const on = machineOf(p.terminal);
  const want = claudeIn(fg.argv);
  if (want && fg.pid) {
    const r = await exec("/bin/sh", ["-c", FIND, "sh", String(fg.pid), want.attach ?? ""], { on, timeout: 15000 });
    const found = pick(r.stdout, want.attach);
    if (!found) return "Claude Code has no record of the conversation in this pane.";
    return openBeside(p, forkArgv(found), found.cwd ?? p.cwd);
  }
  // The pane's program isn't Claude: its Claude may run on another host, a compute node the
  // pane reaches through ssh or idev, as the hook says. Never here: on a cluster this machine is
  // the login node. Its name and folder from Claude's record of it, which the cluster's shared
  // home shows here too (else the hook's folder, and no name).
  const away = elsewhere(got.labels);
  if (!away) return "Claude isn't running in this pane.";
  const r = await exec("/bin/sh", ["-c", FIND, "sh", "", "", away.session], { on, timeout: 15000 });
  const found = pick(r.stdout, away.session) ?? { session: away.session, cwd: null, name: null };
  return openBeside(p, remoteArgv(away.host, { ...found, cwd: found.cwd ?? away.cwd }), p.cwd);
}

function openBeside(p, argv, dir) {
  run("pane.focus", { pane: p.pane });
  run("terminal.open", { argv, place: "right", ...(dir ? { folder: dir } : {}) });
  return null;
}

export default class Pane extends View {
  init() { this.hovered = false; this.forking = false; this.flash = null; this.flashAt = null; this.flashTimers = []; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // This pane's flash: "on", then "fade" (the transition draws it out), then null. A new mark
  // starts one; a mark over 3 s old is from before (a restart). When ⌘G came from another app
  // (Raycast), it starts once the window is in front. A mark for another pane ends this one's.
  flashState(pane, cx) {
    const f = shared(FLASH);
    if (f?.pane !== pane) {
      if (this.flash) this.stopFlash();
      return null;
    }
    if (f.at !== this.flashAt && Date.now() - f.at < 3000 && window()?.active) {
      this.stopFlash();
      this.flashAt = f.at;
      this.flash = "on";
      this.flashTimers = [
        cx.timer.after(HOLD, (cx) => { this.flash = "fade"; cx.notify(); }),
        cx.timer.after(HOLD + FADE + 100, (cx) => { this.flash = null; cx.notify(); }),
      ];
    }
    return this.flash;
  }

  stopFlash() {
    for (const t of this.flashTimers) t.cancel();
    this.flashTimers = [];
    this.flash = null;
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
    const name = (p.program?.agent && agentName(p)) || (p.program?.shell && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const frame = paneFrame(layout());
    const bottom = frame?.header?.position === "bottom";
    const split = Boolean(p.terminal) && panes().filter((x) => x.tab === p.tab).length > 1;
    const claude = Boolean(p.terminal) && (p.program?.key === "claude" || p.app === "claude-code");
    const flash = this.flashState(pane, cx);
    // Its corners follow the frame's, inside the frame's border. A new id for each flash, so it
    // starts lit rather than fading in from the last one's end.
    const r = Math.max(0, (frame?.radius ?? 0) - (frame?.focus?.width ?? 1));
    const glow = () => div().id(`ph-flash-${pane}-${this.flashAt}`).absolute().inset_0()
      .when(bottom, d => d.rounded_b(r))
      .when(!bottom, d => d.rounded_t(r))
      .border(2).border_color(FLASH_COLOR).bg(FLASH_COLOR + "38")
      .opacity(flash === "on" ? 1 : 0)
      .transition("opacity", { duration: FADE, easing: "ease-in-out" });
    return h_flex()
      .id(`pane-head-${pane}`)
      .relative()
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
      .when(Boolean(flash), (el) => el.child(glow()))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(where(p)))
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
