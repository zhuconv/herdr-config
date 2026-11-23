// my-tabs: the update check's last report (updatecheck.js), in a dialog over Herdr: what a click
// on its notification opens, so nothing is left behind in the tab bar. Esc or a click beside it
// closes it; Copy puts the report on the clipboard, to hand on.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openOverlay, closeOverlay } from "herdr";
import { lift } from "./ask.js";
import { reportRows } from "./updatecheck.js";

// text: the report as herdr-update-check saved it. As tall as its rows, up to 640 px: then it scrolls.
export function openReport(mode, text) {
  const n = reportRows(text).length;
  openOverlay({ mod: "my-tabs", kind: "dialog", width: 760, height: Math.min(640, 110 + n * 24), props: { updateReport: { mode, text } } });
}

// Each finding's mark: quiet when fine, the theme's working and blocked colors when not.
const COLOR = { ok: "dim", note: "muted", WARN: "working", CHECK: "working", STOP: "blocked" };

// The dialog. p: props() of the overlay; view: that copy (its focus handle); cx: render's.
export function reportView(t, p, view, cx) {
  const text = String(p.updateReport?.text ?? "");
  const rows = reportRows(text);
  const when = rows.find((r) => r.kind === "when")?.text;
  const title = rows.find((r) => r.kind === "title")?.text;
  const worst = rows.some((r) => r.mark === "STOP") ? "blocked" : rows.some((r) => r.mark === "CHECK") ? "working" : "foreground";
  const close = () => closeOverlay(p.overlay);
  const copied = view.reportCopied === p.overlay;
  const body = rows.filter((r) => r.kind !== "when" && r.kind !== "title").map((r, i) => {
    if (r.kind === "heading") return div().pt(i ? 10 : 0).font_semibold().text_color(t.foreground).child(r.text);
    if (r.kind === "fact") {
      return h_flex().gap(8).items_start()
        .child(div().w(84).flex_none().text_color(t.dim).child(r.label))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(r.text));
    }
    if (r.kind === "mark") {
      const quiet = r.mark === "ok" || r.mark === "note";
      return h_flex().gap(8).items_start()
        .child(div().w(52).flex_none().pt(1).text_size(11).font_semibold().text_color(t[COLOR[r.mark]] ?? t.muted).child(r.mark))
        .child(div().flex_1().min_w(0).text_color(quiet ? t.muted : t.foreground).child(r.text));
    }
    if (r.kind === "detail") return div().pl(60).text_size(12).text_color(t.dim).child(r.text);
    return div().pt(10).font_semibold().text_color(t[worst] ?? t.foreground).child(r.text); // the verdict
  });
  return v_flex()
    .id("update-report")
    .track_focus(view.handle)
    .on_mouse_down("left", () => view.handle.focus())
    .on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      close();
      cx.stop_propagation();
    })
    .size_full()
    .min_h(0)
    .p(18)
    .gap(10)
    .rounded(8)
    .bg(t.popover)
    .text_size(13)
    .child(h_flex().items_center().gap(12)
      .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground)
        .child(title ? `Update check: ${title}` : "Update check"))
      .child(h_flex().id("update-report-copy").flex_none().h(26).px(10).items_center().rounded(6)
        .bg(t.raised).text_size(12).text_color(t.foreground).cursor_pointer()
        .hover((s) => s.bg(lift(t, t.raised, 0.1)))
        .on_click((_e, cx) => {
          cx.write_to_clipboard(text);
          view.reportCopied = p.overlay;
          cx.notify();
        })
        .child(copied ? "Copied" : "Copy"))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
    .when(Boolean(when), (el) => el.child(div().text_size(11).text_color(t.dim).child(`Checked ${when}`)))
    .child(v_flex().id("update-report-body").flex_1().min_h(0).overflow_y_scroll().gap(5).children(body));
}
