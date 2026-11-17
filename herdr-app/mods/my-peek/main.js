// my-peek (a clone of Herdr's peek 0.1.16): the bar on top of a peeked terminal, in the overlay
// mods/my-tabs opens (peek.js) for a worker in the Agents list and a child in the close dialog:
// who it is and how it's doing, who started it, its keep, ✕ to close. Its keep is the Agents
// row's (my-tabs.keep): a tab on the worker's own machine, filed with its starter. Herdr's own
// peek kept it in the shown space, which Herdr refuses for another machine's terminal, and
// closed anyway. One already in a pane: "go to" it. Props: { terminal, overlay }, or
// { blank: true } for the blank tab my-tabs shows while keeping (an empty pane).

import { View, div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, panes, run, theme, props, closeOverlay } from "herdr";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// The icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
const WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : null);

export default class Peek extends View {
  term() {
    return terminals().find((t) => t.address === props()?.terminal);
  }

  status() {
    const addr = props()?.terminal;
    return agents().find((a) => a.address === addr)?.status ?? this.term()?.status ?? null;
  }

  // A terminal as the Agents list names it: its hc name, else its program's title.
  nameOf(k) {
    const title = clean(panes().find((p) => p.terminal === k?.address)?.title);
    return k?.name || title || k?.template || k?.program?.name || k?.address || "";
  }

  button(t, id, label, tip, onClick) {
    return h_flex()
      .id(id)
      .h(22)
      .pl(6)
      .pr(8)
      .gap(5)
      .items_center()
      .rounded(5)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click(onClick)
      .child(label);
  }

  render() {
    const t = theme();
    // The blank tab mods/my-tabs shows while it keeps a worker in a space that wasn't shown.
    if (props()?.blank) return div().size_full().bg(t.background);
    const { terminal, overlay } = props() ?? {};
    const k = this.term();
    const st = this.status();
    const pic = icon(k?.program, 14, t.foreground);
    const parent = k?.parent ? terminals().find((p) => p.address === k.parent) : null;
    const home = panes().some((p) => p.terminal === terminal);
    const glyph = st === "working" ? SPIN[0] : st === "idle" ? "○" : st ? "●" : "·";
    const out = svg("mods/my-menu/pop-out.svg").size(14).flex_none();
    return h_flex()
      .size_full()
      .pl(12)
      .pr(6)
      .gap(8)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .child(div().w(12).flex_none().text_color(t[st] ?? t.dim).when(st === "working", (el) => el.frames(SPIN, 90)).child(glyph))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().truncate().font_semibold().text_color(t.foreground).child(k ? this.nameOf(k) : terminal || ""))
      .when(Boolean(st), (el) => el.child(div().flex_none().text_color(t[st] ?? t.dim).child(WORDS[st] ?? st)))
      .when(Boolean(parent), (el) => el.child(div().truncate().text_color(t.dim).child(`from ${this.nameOf(parent)}`)))
      .child(div().flex_1())
      .child(
        home
          ? this.button(t, "keep", h_flex().gap(5).items_center().child(out).child("go to"), "Go to its tab", () => {
              closeOverlay(overlay);
              run("pane.focus", { terminal });
            })
          : this.button(t, "keep", h_flex().gap(5).items_center().child(out).child("keep"), `Keep as a tab on ${machineOf(terminal) ?? "local"}`, () => {
              closeOverlay(overlay);
              run(`my-tabs.keep ${terminal}`);
            }),
      )
      .child(this.button(t, "close", "✕", null, () => closeOverlay(overlay)));
  }
}
