// my-glow: one strip of the halo mods/my-tabs lays around the pane ⌘G lands on (my-tabs/glow.js
// works out where), in a window overlay along one side of the pane. The halo comes in, spreading
// out from the border, holds, fades out, and the strip closes itself. It starts once Herdr's window
// is in front: ⌘G from another app brings it there a moment after the jump.
// Props: { rings: [{ x, y, w, h, radius, width, alpha }] in window px from the strip's top left,
// color, start (when my-tabs opened the strips, ms since the epoch), in, hold, fade (ms), overlay }.
// Every strip times itself from `start`, so the four stay in step where they meet.

import { View, div } from "gpui-kit";
import { props, settings, closeOverlay } from "herdr";

// The halo comes in this long after the strips open: Herdr shows a window overlay a frame after it
// first draws it (it measures it first).
const LEAD = 40;
// Until the window is in front (at most WAIT), the strips look again every TICK, on the same ticks.
const TICK = 25, WAIT = 3000;

export default class Glow extends View {
  init(_props, cx) {
    // off: drawn, not yet shown; in: shown (it comes in); out: fading.
    this.phase = "off";
    const p = props() ?? {};
    const t0 = Number(p.start) || Date.now();
    const fadeIn = Number(p.in) || 150, hold = Number(p.hold) || 300, fadeOut = Number(p.fade) || 300;
    const front = () => {
      try { return globalThis.window.is_window_active(); } catch { return true; }
    };
    const at = (cx, time, fn) => cx.timer.after(Math.max(0, time - Date.now()), fn);
    const go = (cx, time) => {
      if (!front() && time - t0 < WAIT) {
        at(cx, time + TICK, (cx) => go(cx, time + TICK));
        return;
      }
      at(cx, time, (cx) => { this.phase = "in"; cx.notify(); });
      at(cx, time + fadeIn + hold, (cx) => { this.phase = "out"; cx.notify(); });
      at(cx, time + fadeIn + hold + fadeOut + 40, () => closeOverlay(p.overlay));
    };
    go(cx, t0 + LEAD);
  }

  render() {
    const p = props() ?? {};
    // A mod's px follow the zoom; the rings are in window px.
    const z = Number(settings()?.zoom) || 1, u = (v) => v / z;
    const rings = Array.isArray(p.rings) ? p.rings : [];
    // Coming in: each ring a little after the one inside it, so the halo spreads out from the border.
    const fadeIn = Number(p.in) || 150, spread = Math.min(60, fadeIn / 4);
    const shown = this.phase !== "off";
    return div().id("glow").size_full().relative()
      .opacity(this.phase === "out" ? 0 : 1)
      .transition("opacity", { duration: Number(p.fade) || 300, easing: "ease-out" })
      // A press here would drag the overlay.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .children(rings.map((r, k) => div().id(`ring-${k}`).absolute()
        .left(u(r.x)).top(u(r.y)).w(u(r.w)).h(u(r.h))
        .rounded(u(r.radius)).border(u(r.width)).border_color(p.color)
        .opacity(shown ? r.alpha : 0)
        .transition("opacity", { duration: fadeIn - spread, delay: rings.length > 1 ? (spread * k) / (rings.length - 1) : 0, easing: "ease-out" })));
  }
}
