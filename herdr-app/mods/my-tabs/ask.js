// my-tabs: before a pane, tab or space closes, a dialog when its terminals have running
// children (terminals started from them with `hc run`, e.g. a manager agent's workers). It
// lists each child under what happens to it. A click on one peeks at it over the dialog, and
// closing the peek comes back to the dialog. When some would keep running (a manager's
// workers), "End all" ends them with it instead. The pointer on End all or Close lights up
// the children that button ends. main.js opens it as this mod's overlay; that copy of the
// view draws only askView.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, closeOverlay, openOverlay, focused } from "herdr";
import { openPeek } from "./peek.js";

// Live terminals whose parent is one of `addrs`, leaving out those closing with them.
// `parent` uses the same names as `address` (herdr.d.ts terminals()), as my-agents' tree() does.
export function childrenOf(all, addrs) {
  const closing = new Set(addrs);
  return all.filter((t) => t.state === "live" && closing.has(t.parent) && !closing.has(t.address));
}

// Children started with --outlive-parent (a manager's workers) keep running with nobody to
// report to; the others end with their parent.
const GROUPS = [
  ["Keep running, can't report back", (k) => k.die_with_parent !== true],
  ["End with it", (k) => k.die_with_parent === true],
];

// what: "tab", "pane" or "space"; name: its name; command and args: what Enter and the
// Close button run; endCommand: what "End all" runs (main.js "close-end");
// when: a line on when its terminals end.
export function askClose({ what, name, command, endCommand, args, kids, when }) {
  const groups = GROUPS.filter(([, f]) => kids.some(f)).length;
  const height = Math.min(480, 112 + (when ? 22 : 0) + groups * 34 + kids.length * 38);
  // modal: a click beside it, e.g. one on the peek above it, leaves it open.
  openOverlay({ mod: "my-tabs", kind: "dialog", modal: true, width: 480, height, props: {
    closeAsk: { what, name, command, end: endCommand ?? null, args: args ?? {}, kids: kids.map((k) => k.address), when },
  } });
}

// The peek (peek.js, the Agents list's) opens over the dialog and has the keyboard while it's
// open: focused() then reports its terminal with no pane (herdr.d.ts). Once that ends (its ✕,
// keep or go to, or the child ending), the dialog takes the keyboard back, so Enter and Esc
// answer it again. view: the overlay's copy of the view, which keeps the peek and focus handle.
function peek(view, addr) {
  view.peek = { addr, seen: false };
  openPeek(addr);
}

function refocus(view, cx) {
  const pk = view.peek;
  if (!pk) return;
  const f = focused();
  if (f?.terminal === pk.addr && !f.pane) pk.seen = true;
  else if (pk.seen) {
    view.peek = null;
    // Moving the keyboard is illegal while drawing (a frame changing its own window throws,
    // and the dialog flashes red): right after this frame.
    cx.timer.after(0, () => view.handle.focus());
  }
}

function icon(t, p) {
  if (!p?.icon) return svg("mods/workspace-chrome/terminal.svg").size(14).flex_none().text_color(t.dim);
  return p.tint ? svg(p.icon).size(14).flex_none().text_color(t.foreground) : image(p.icon).w(14).h(14).flex_none();
}

// An agent child's state, drawn as in the Agents list (an error counts as blocked, done as
// idle); null for a plain program.
function status(t, k) {
  const s = k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status;
  if (s === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  if (s === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return null;
}

// A button's hover color: c moved toward white on a dark popover (toward black on a light one)
// by w, 0 to 1. Herdr's own dialogs fade the button to 88% instead, which greys it out as if
// it were disabled. c as it is when it isn't a plain #rrggbb.
function lift(t, c, w) {
  const rgb = (s) => (/^#[0-9a-f]{6}$/i.test(s ?? "") ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : null);
  const bg = rgb(t.popover), from = rgb(c);
  if (!bg || !from) return c;
  const to = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] < 128 ? 255 : 0;
  return "#" + from.map((v) => Math.round(v + (to - v) * w).toString(16).padStart(2, "0")).join("");
}

// lit: the button under the pointer ends this child.
function row(t, k, view, lit) {
  const st = status(t, k);
  return h_flex()
    .id(`kid-${k.address}`)
    .h(34)
    .px(10)
    .gap(10)
    .flex_none()
    .items_center()
    .rounded(8)
    .border_1()
    .border_color(lit ? t.blocked + "80" : t.input)
    .when(lit, (el) => el.bg(t.blocked + "26"))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => peek(view, k.address))
    .child(icon(t, k.program))
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(k.name || k.program?.name || k.address))
    .child(div().flex_none().text_size(12).text_color(t.dim).child(k.address))
    .when(Boolean(st), (el) => el.child(st))
    .child(svg("mods/workspace-chrome/chevron-right.svg").size(14).flex_none().text_color(t.dim));
}

// The dialog. p: props() of the overlay; all: terminals(); view: see peek(); cx: render's.
// Enter closes, Esc keeps everything, as Herdr's confirm dialog; ending the workers too takes
// a click.
export function askView(t, p, all, view, cx) {
  refocus(view, cx);
  const a = p.closeAsk;
  const live = new Map(all.map((k) => [k.address, k]));
  const kids = a.kids.map((x) => live.get(x)).filter((k) => k?.state === "live");
  const stay = kids.filter(GROUPS[0][1]);
  // The button under the pointer ("no", "end" or "yes") and the children it ends: End all,
  // every one; Close, those that end with their parent.
  const hov = view.askHover?.overlay === p.overlay ? view.askHover.on : null;
  const ends = (k) => hov === "end" || (hov === "yes" && GROUPS[1][1](k));
  const hover = (on) => (hovered, cx) => {
    if (hovered) view.askHover = { overlay: p.overlay, on };
    else if (view.askHover?.on === on) view.askHover = null;
    cx.notify();
  };
  const close = () => {
    view.askHover = null;
    closeOverlay(p.overlay);
  };
  const yes = () => {
    close();
    run(a.command, a.args);
  };
  const end = () => {
    close();
    run(a.end, a.args);
  };
  // Each button's [background, text, border], then the same under the pointer: Cancel and
  // Close lift, End all turns red.
  const button = (id, label, [bg, fg, border], [hbg, hfg, hborder], onClick) => {
    const on = hov === id;
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(on ? hborder : border).bg(on ? hbg : bg).text_color(on ? hfg : fg)
      .cursor_pointer().on_hover(hover(id)).on_click(onClick).child(label);
  };
  const raisedUp = lift(t, t.raised, 0.1), solidUp = lift(t, t.solid, 1);
  return v_flex()
    .id("close-ask")
    .track_focus(view.handle)
    .on_mouse_down("left", () => view.handle.focus())
    .on_key_down((e, cx) => {
      if (e.key === "enter") yes();
      else if (e.key === "escape") close();
      else return;
      cx.stop_propagation();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .gap(14)
    .rounded(8)
    .bg(t.popover)
    .text_size(13)
    .child(v_flex().gap(4)
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Close ${a.what} “${a.name}”?`))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(a.when), (el) => el.child(div().text_color(t.muted).child(a.when))))
    .child(v_flex().id("close-ask-kids").flex_1().min_h(0).overflow_y_scrollbar().gap(12)
      .children(GROUPS.map(([label, f]) => [label, kids.filter(f)]).filter(([, list]) => list.length)
        .map(([label, list]) => v_flex().gap(6).flex_none()
          .child(div().text_size(11).font_medium().text_color(t.dim).child(label))
          .children(list.map((k) => row(t, k, view, ends(k)))))))
    .child(h_flex().justify_end().gap(8).text_size(12)
      .child(button("no", "Cancel", [t.raised, t.foreground, t.input], [raisedUp, t.foreground, t.input], close))
      .when(Boolean(a.end) && stay.length > 0, (el) => el.child(button("end", "End all",
        [t.raised, t.blocked, t.input], [t.blocked, "#ffffff", t.blocked], end)))
      .child(button("yes", `Close ${a.what}`, [t.solid, t.solid_foreground, t.solid], [solidUp, t.solid_foreground, solidUp], yes)));
}
