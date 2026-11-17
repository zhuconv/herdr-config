// my-tabs: before a pane, tab or space closes, a dialog when its terminals have running
// children (terminals started from them with `hc run`, e.g. a manager agent's workers). It
// lists each child under what happens to it. A click on one peeks at it over the dialog, and
// closing the peek comes back to the dialog. main.js opens it as this mod's overlay; that copy
// of the view draws only askView.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, closeOverlay, openOverlay, focused } from "herdr";

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
// Close button run; when: a line on when its terminals end.
export function askClose({ what, name, command, args, kids, when }) {
  const groups = GROUPS.filter(([, f]) => kids.some(f)).length;
  const height = Math.min(480, 112 + (when ? 22 : 0) + groups * 34 + kids.length * 38);
  // modal: a click beside it, e.g. one on the peek above it, leaves it open.
  openOverlay({ mod: "my-tabs", kind: "dialog", modal: true, width: 480, height, props: {
    closeAsk: { what, name, command, args: args ?? {}, kids: kids.map((k) => k.address), when },
  } });
}

// The peek (terminal.peek, the Agents list's) opens over the dialog and has the keyboard while
// it's open: focused() then reports its terminal with no pane (herdr.d.ts). Once that ends (its
// ✕, ↗ go to or keep, or the child ending), the dialog takes the keyboard back, so Enter and Esc
// answer it again. view: the overlay's copy of the view, which keeps the peek and focus handle.
function peek(view, addr) {
  view.peek = { addr, seen: false };
  run("terminal.peek", { terminal: addr });
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

function row(t, k, view) {
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
    .border_color(t.input)
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
// Enter closes, Esc keeps everything, as Herdr's confirm dialog.
export function askView(t, p, all, view, cx) {
  refocus(view, cx);
  const a = p.closeAsk;
  const live = new Map(all.map((k) => [k.address, k]));
  const kids = a.kids.map((x) => live.get(x)).filter((k) => k?.state === "live");
  const close = () => closeOverlay(p.overlay);
  const yes = () => {
    close();
    run(a.command, a.args);
  };
  const button = (id, label, bg, fg, border, onClick) =>
    h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(border).bg(bg).text_color(fg).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
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
          .children(list.map((k) => row(t, k, view))))))
    .child(h_flex().justify_end().gap(8).text_size(12)
      .child(button("no", "Cancel", t.raised, t.foreground, t.input, close))
      .child(button("yes", `Close ${a.what}`, t.solid, t.solid_foreground, t.solid, yes)));
}
