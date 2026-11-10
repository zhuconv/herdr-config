// agent-deck: a dialog that edits one terminal's labels (`hc label`): Role and Task always,
// then one row per other label; `+` adds a row. Save sends only what changed; a cleared
// value removes its label. Suggestions come from every live terminal and, for tasks and
// roles, from the values saved here before (localStorage, most recent first).
//
// Opened with openOverlay({ mod: "agent-deck-labels", kind: "dialog", width: 560,
// props: { terminal } }) (the Overview's tag buttons, the tab bar's tag button), or with
// `mod.open:agent-deck-labels`: then it edits the focused terminal.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { terminals, agents, panes, focused, hc, theme, props, closeOverlay } from "herdr";
import { customLabels, knownValues, remember, suggest, labelArgs } from "./edit.js";

function cached(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function store(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export default class Labels extends View {
  init(_props, cx) {
    this.address = props()?.terminal ?? focused()?.terminal ?? null;
    const x = terminals().find((t) => t.address === this.address);
    const a = agents().find((t) => t.address === this.address);
    const title = clean(a?.title) || clean(panes().find((p) => p.terminal === this.address)?.title);
    this.name = title || a?.program?.name || x?.program?.name || this.address;
    this.labels = x?.labels ?? {};
    this.error = x ? null : this.address ? `${this.address} is not a live terminal` : "No terminal is focused";
    this.saving = false;
    this.rows = x ? [this.row("role", this.labels.role ?? "", true), this.row("task", this.labels.task ?? "", true),
      ...customLabels(this.labels).filter(([k]) => k !== "role" && k !== "task").map(([k, v]) => this.row(k, v, false))] : [];
    this.focus = this.rows[0] ?? null;
    this.focus?.v.focus();
  }

  // One row; `fixed` rows (role, task) have no key field.
  row(key, value, fixed) {
    const r = { key, fixed };
    r.k = fixed ? null : InputState.new({ placeholder: "key", value: key });
    r.v = InputState.new({ placeholder: key === "task" ? "e.g. PROJ-1234" : key === "role" ? "e.g. reviewer" : "value", value });
    for (const s of [r.k, r.v].filter(Boolean)) {
      s.on("change", (_e, cx) => cx.notify());
      s.on("submit", (_e, cx) => this.save(cx));
    }
    r.v.on("focus", (_e, cx) => { this.focus = r; cx.notify(); });
    r.k?.on("focus", (_e, cx) => { this.focus = null; cx.notify(); });
    return r;
  }

  addRow(cx) {
    const r = this.row("", "", false);
    this.rows.push(r);
    r.k.focus();
    cx.notify();
  }

  removeRow(r, cx) {
    this.rows = this.rows.filter((x) => x !== r);
    if (this.focus === r) this.focus = null;
    r.k?.release();
    r.v.release();
    cx.notify();
  }

  // Not `close`: Herdr calls a View's close(cx) itself when the overlay goes.
  dismiss() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  save(cx) {
    if (this.saving || !this.rows.length) return;
    const rows = this.rows.map((r) => [r.fixed ? r.key : r.k.value(), r.v.value()]);
    let args;
    try {
      args = labelArgs(this.labels, rows);
    } catch (err) {
      this.error = err.message;
      cx.notify();
      return;
    }
    if (args.length === 0) return this.dismiss();
    this.saving = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["label", this.address, ...args]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n").pop());
        const value = (k) => rows.find(([key]) => key === k)?.[1];
        store("roles", remember(cached("roles"), value("role")));
        store("tasks", remember(cached("tasks"), value("task")));
        this.dismiss();
      } catch (err) {
        this.saving = false;
        this.error = String(err?.message ?? err);
        cx.notify();
      }
    });
  }

  // Tasks and roles from every live terminal and from what was saved here; other keys
  // from live terminals only.
  suggestionsFor(r) {
    const key = r.fixed ? r.key : r.k.value().trim();
    if (!key) return [];
    const cache = key === "task" ? cached("tasks") : key === "role" ? cached("roles") : [];
    return suggest(knownValues(terminals(), key, cache), r.v.value());
  }

  field(t, id, state, focus) {
    return h_flex().id(id).h(28).px(8).items_center().rounded(6).border(1).border_color(focus ? t.accent : t.border).bg(t.chrome)
      .child(Input.new(state).flex_1().h_full().text_size(12).text_color(t.foreground));
  }

  render(_cx) {
    const t = theme();
    const rowEl = (r, i) => {
      const sugg = this.focus === r ? this.suggestionsFor(r) : [];
      return v_flex().id(`lb-row-${i}`).gap(4)
        .child(h_flex().gap(8).items_center()
          .child(r.fixed
            ? div().w(64).flex_none().text_size(12).text_color(t.dim).child(r.key === "role" ? "Role" : "Task")
            : this.field(t, `lb-k-${i}`, r.k, false).w(120).flex_none())
          .child(this.field(t, `lb-v-${i}`, r.v, this.focus === r).flex_1().min_w(0))
          .child(r.fixed
            ? div().w(20).flex_none()
            : div().id(`lb-rm-${i}`).w(20).flex_none().p(3).rounded(4).text_color(t.dim).cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip("Remove this label")
              .on_click((_e, cx) => this.removeRow(r, cx))
              .child(svg("mods/workspace-chrome/x.svg").size(12))))
        .when(sugg.length > 0, (el) => el.child(h_flex().flex_wrap().gap(4).pl(r.fixed ? 72 : 128)
          .children(sugg.map((s, j) => div().id(`lb-s-${i}-${j}`).max_w(260).truncate().px(6).py(1).rounded(4).bg(t.chrome).border(1).border_color(t.border)
            .text_size(11).text_color(t.foreground).cursor_pointer()
            .hover((x) => x.bg(t.hover).border_color(t.accent))
            .on_click((_e, cx) => { r.v.set_value(s); r.v.focus(); cx.notify(); })
            .child(s)))));
    };
    return v_flex().id("lb").size_full().p(16).gap(12).bg(t.popover ?? t.surface)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        this.dismiss();
        cx.stop_propagation();
      })
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(svg("mods/agent-deck-labels/tag.svg").size(14).flex_none().text_color(t.dim))
        .child(div().flex_none().font_semibold().text_color(t.foreground).child("Labels"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.address ? `${this.name} · ${this.address}` : "")))
      .child(v_flex().gap(8).children(this.rows.map(rowEl)))
      .when(this.rows.length > 0, (el) => el.child(h_flex().child(div().id("lb-add").flex_none().px(8).py(3).rounded(6).text_size(12).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Add another label")
        .on_click((_e, cx) => this.addRow(cx))
        .child(h_flex().gap(4).items_center().child(svg("mods/workspace-chrome/plus.svg").size(12)).child("Add label")))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.rows.length ? "Enter saves · Esc cancels · an empty value removes the label" : ""))
        .child(div().id("lb-cancel").flex_none().px(10).py(4).rounded(6).border(1).border_color(t.border).text_size(12).text_color(t.foreground).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.dismiss())
          .child(this.rows.length ? "Cancel" : "Close"))
        .when(this.rows.length > 0, (el) => el.child(div().id("lb-save").flex_none().px(10).py(4).rounded(6).bg(t.accent).text_size(12).text_color(t.background ?? t.chrome).font_semibold().cursor_pointer()
          .on_click((_e, cx) => this.save(cx))
          .child(this.saving ? "Saving…" : "Save"))));
  }
}
