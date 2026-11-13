// Switcher: the ⌃Tab popup. my-tabs opens it (keys.json: my-tabs.switch /
// my-tabs.switch-back) with shared "my-tabs.switcher" = { list, index, from }: terminal
// addresses (agents, background sessions, shells you've been in), the current one first,
// then by when you last focused them. More ⌃Tab presses reach my-tabs, which moves index;
// letting go of ⌃ goes to the picked pane. Enter goes too, Esc goes back, arrows and Tab
// move, a click picks a card.
// A quick ⌃Tab tap switches before anything shows: the popup is invisible for REVEAL ms.
// A card: the program's icon, name, project and machine (as in the Agents list), the start of
// your last prompt and the end of its last reply (a shell: its folder). Those two are the hc
// labels note.prompt / note.said, which a Claude Code hook (~/.local/bin/agent-note) sets as
// they happen, so nothing is read here.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, terminals, spaces, run, shared, setShared, props, closeOverlay, theme, home } from "herdr";
import { projectOf, noteStatus } from "./projects.js";

const SWITCH = "my-tabs.switcher";
// The left panel's projects (mods/my-projects); projects.js is a copy of its model.js.
const PROJECTS = "my-projects.state";
const REVEAL = 120;
const CARD_W = 280, COLS = 4, GAP = 10, PAD = 12;
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// Agent programs that may report no state (a `claude attach` background session), as in
// my-projects' model.js agentKeys.
const AGENT_KEYS = new Set(["claude", "codex", "gemini", "opencode", "pi"]);

// Every terminal shown in a pane, as its card shows it: the agent's own report, else the
// pane's, with a background session's state from its labels (projects.js noteStatus) and a
// shell's as none. Each with its project as the left panel files it (null: Unsorted).
function entries() {
  const reported = new Map(agents().map((a) => [a.address, a]));
  const terms = new Map(terminals().map((x) => [x.address, x]));
  const spaceOf = new Map(spaces().flatMap((sp) => (sp.tabs ?? []).map((tab) => [tab.id, sp])));
  const filed = shared(PROJECTS);
  const out = new Map();
  for (const p of panes()) {
    if (!p.terminal || out.has(p.terminal)) continue;
    const project = projectOf(p, terms.get(p.terminal), spaceOf.get(p.tab), filed);
    const a = reported.get(p.terminal);
    if (a) { out.set(p.terminal, { ...a, project }); continue; }
    const agent = Boolean(p.program?.agent || AGENT_KEYS.has(p.program?.key));
    out.set(p.terminal, {
      address: p.terminal, pane: p.pane, tab: p.tab, title: p.title ?? "", program: p.program, cwd: p.cwd, project,
      status: p.status ?? (agent ? noteStatus(terms.get(p.terminal)?.labels) ?? "idle" : null),
    });
  }
  return out;
}
const homeShort = (path) => (path && home() && (path === home() || path.startsWith(home() + "/")) ? "~" + path.slice(home().length) : path ?? "");

export default class AgentSwitcher extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // props.preview ("my-tabs.switch-preview"): shows for 2.5 s without taking the
    // keyboard, to check the look while someone is typing.
    this.preview = Boolean(props()?.preview);
    if (!this.preview) this.handle.focus();
    this.openedAt = Date.now();
    this.shownAt = this.openedAt + (this.preview ? 0 : REVEAL);
    this.reveal = cx.timer.after(REVEAL, (cx) => cx.notify());
    this.done = false;
    const s = shared(SWITCH);
    if (s) setShared(SWITCH, { ...s, alive: true });
    // A window overlay stays until closed, so it closes itself once the switch is
    // over elsewhere (my-tabs cleared it) or you click away from it.
    this.watch = cx.timer.every(200, () => {
      if (this.done) return;
      if (!shared(SWITCH)) return this.end();
      if (this.preview) return Date.now() - this.openedAt > 2500 && this.end();
      if (this.handle.is_focused()) this.hadFocus = true;
      else if (this.hadFocus) this.end();
    });
  }

  // Closed some other way (e.g. a layout switch): let the next ⌃Tab open a new one.
  async close() {
    if (!this.done && shared(SWITCH)) setShared(SWITCH, null);
  }

  end() {
    if (this.done) return;
    this.done = true;
    if (shared(SWITCH)) setShared(SWITCH, null);
    closeOverlay(props().overlay);
  }

  // Goes to the picked pane (or `address`); with none left, back where it started.
  go(address) {
    if (this.done) return;
    const s = shared(SWITCH);
    const target = address ?? s?.list?.[s.index];
    const a = target ? entries().get(target) : null;
    if (a) run("pane.focus", { pane: a.pane });
    else if (s?.from) run("pane.focus", { pane: s.from });
    this.end();
  }

  cancel() {
    if (this.done) return;
    const s = shared(SWITCH);
    if (s?.from) run("pane.focus", { pane: s.from });
    this.end();
  }

  step(n) {
    const s = shared(SWITCH);
    if (s?.list?.length) setShared(SWITCH, { ...s, index: (s.index + n + s.list.length) % s.list.length });
  }

  // A shell has no state: no mark.
  status(t, a) {
    if (a.status == null) return null;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked") return div().flex_none().px(5).h(16).rounded(4).bg(t.blocked + "26").text_size(10).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (a.status === "done") return div().size(7).flex_none().rounded(4).bg(t.done);
    return div().size(7).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  render() {
    const t = theme();
    const s = shared(SWITCH);
    const live = entries();
    const notes = new Map(terminals().map((x) => [x.address, x.labels ?? {}]));
    const tabs = new Map(spaces().flatMap((sp) => sp.tabs).map((tab) => [tab.id, tab]));
    const picked = s?.list?.[s.index];
    const card = (address) => {
      const a = live.get(address);
      if (!a) return null;
      const on = address === picked;
      const tab = tabs.get(a.tab);
      const title = clean(a.title);
      const telling = title && title !== a.program?.name && !/^[~/]/.test(title) && !title.includes("@") && title.toLowerCase() !== a.program?.key;
      const name = telling ? title : tab?.named && !/^\d+$/.test(tab.name) ? tab.name : a.program?.name ?? "Agent";
      const note = notes.get(address) ?? {};
      const icon = a.program?.icon, mark = this.status(t, a);
      // Another machine's terminal says which (`vps/t7`).
      const machine = address.includes("/") ? address.split("/")[0] : null;
      // A shell's first line is its folder; an agent's, your last prompt.
      const first = note["note.prompt"] ? `❯ ${note["note.prompt"]}` : a.status == null ? homeShort(a.cwd) : "";
      return v_flex()
        .id(`card-${address}`)
        .w(CARD_W)
        .flex_none()
        .p(12)
        .gap(8)
        .rounded(12)
        .border(1)
        .border_color(on ? t.dim : t.popover)
        .bg(on ? t.selected : t.popover)
        .cursor_pointer()
        .hover((st) => (on ? st : st.bg(t.hover)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.go(address))
        // As in the Agents list: the program's icon (Claude, Codex…), then name · project (none
        // when Unsorted) and a small machine tag.
        .child(h_flex().gap(8).items_center()
          .when(Boolean(icon), (el) => el.child(a.program.tint ? svg(icon).size(16).flex_none().text_color(t.muted) : image(icon).size(16).flex_none()))
          .child(div().flex_none().max_w(150).truncate().text_size(15).font_semibold().text_color(t.foreground).child(name))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.muted).child(a.project ? `· ${a.project}` : ""))
          .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(machine)))
          .when(Boolean(mark), (el) => el.child(mark)))
        .child(div().h(17).truncate().text_size(12).text_color(t.dim).child(first))
        // The reply as "first sentence … last sentence" (agent-note keeps it to ~3 lines).
        .child(div().w_full().h(51).overflow_hidden()
          .text_size(12).line_height(1.4).text_color(on ? t.foreground : t.muted)
          .child(note["note.said"] ?? ""));
    };
    return h_flex()
      .id("agent-switcher")
      .track_focus(this.handle)
      // Letting go of ⌃ switches. ⌃ is usually already down when the popup gets the
      // keyboard, so the first sign of it may be Tab's key-up; failing that, a release
      // soon after opening counts. A later change without ⌃ ever seen (say ⌘ in a
      // popup left open) switches nothing.
      .on_modifiers_changed((e) => {
        if (e.modifiers.control) this.ctrlSeen = true;
        else if (this.ctrlSeen || Date.now() - this.openedAt < 1500) this.go();
      })
      .on_key_up((e) => {
        if (e.modifiers.control) this.ctrlSeen = true;
      })
      .on_key_down((e, cx) => {
        if (e.modifiers.control) this.ctrlSeen = true;
        if (e.key === "escape") this.cancel();
        else if (e.key === "enter") this.go();
        else if (e.key === "left" || e.key === "up" || e.keystroke === "shift-tab") this.step(-1);
        else if (e.key === "right" || e.key === "down" || e.keystroke === "tab") this.step(1);
        else return;
        cx.stop_propagation();
      })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .opacity(Date.now() >= this.shownAt ? 1 : 0)
      .flex_wrap()
      .max_w(COLS * CARD_W + (COLS - 1) * GAP + 2 * PAD + 2)
      .gap(GAP)
      .p(PAD)
      .rounded(16)
      .bg(t.popover)
      .border(1)
      .border_color(t.border)
      .shadow_lg()
      .children((s?.list ?? []).map(card).filter(Boolean));
  }
}
