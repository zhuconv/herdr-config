// my-glow: one strip of the halo mods/my-tabs lays around the pane ⌘G lands on (my-tabs/glow.js
// works out where), in a window overlay along one side of the pane. It shows the halo, holds it,
// fades it out and closes itself. The hold starts once Herdr's window is in front: ⌘G from another
// app brings it there a moment after the jump.
// Props: { rings: [{ x, y, w, h, radius, width, alpha }] in window px from the strip's top left,
// color, hold and fade in ms, overlay }.

import { View, div } from "gpui-kit";
import { props, settings, closeOverlay } from "herdr";

// How long it waits for the window to come to the front.
const WAIT = 3000;

export default class Glow extends View {
  init(_props, cx) {
    this.fading = false;
    const p = props() ?? {};
    const hold = Number(p.hold) || 400, fade = Number(p.fade) || 450;
    const from = Date.now();
    const front = () => {
      try { return globalThis.window.is_window_active(); } catch { return true; }
    };
    const start = (cx) => {
      if (!front() && Date.now() - from < WAIT) {
        cx.timer.after(30, start);
        return;
      }
      cx.timer.after(hold, (cx) => {
        this.fading = true;
        cx.notify();
        cx.timer.after(fade + 40, () => closeOverlay(p.overlay));
      });
    };
    start(cx);
  }

  render() {
    const p = props() ?? {};
    // A mod's px follow the zoom; the rings are in window px.
    const z = Number(settings()?.zoom) || 1, u = (v) => v / z;
    return div().id("glow").size_full().relative()
      .opacity(this.fading ? 0 : 1)
      .transition("opacity", { duration: Number(p.fade) || 450, easing: "ease-in" })
      // A press here would drag the overlay.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .children((Array.isArray(p.rings) ? p.rings : []).map((r) => div().absolute()
        .left(u(r.x)).top(u(r.y)).w(u(r.w)).h(u(r.h))
        .rounded(u(r.radius)).border(u(r.width)).border_color(p.color).opacity(r.alpha)));
  }
}
