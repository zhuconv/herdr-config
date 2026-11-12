// Projects: the top-left list, by project. A project is a list of directories, on any
// machine; a conversation (an agent) belongs to the project holding the directory it runs
// in or its nearest parent, else it waits in Unsorted. A group shows a pill per directory,
// folded until clicked; an open pill's path has a + that starts Claude in that directory.
// Click a project's row to show its tabs in the tab bar (mods/my-tabs, grouped by these
// directories, each with its pill's color dot); its chevron folds it. Drag a pill among its
// group's pills to reorder them, or onto another group to move its directory there;
// right-click it to move it (into a project, a new one, or back to Unsorted). Right-click a
// project to rename it, change its icon or delete it (its directories go back to Unsorted);
// drag a project's row to reorder the projects. Shells aren't listed here; the tab bar has them.
//
// Kept in shared state: "my-projects.state" ({ projects: [{ name, dirs }], loose }; see
// model.js), "my-projects.icons" (each project's icon), "my-projects.order" (the projects'
// dragged order) and "my-projects.pills" (the pills' dragged order: directory keys, one
// list for all groups). This copy's localStorage: folds, open pills, when each agent last
// changed state. The same mod draws its popups (props.role).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, panes, terminals, spaces, run, theme, settings, shared, setShared, openOverlay, closeOverlay, props, layout, home, appHome, readTextFile, nextCommand } from "herdr";
import { COLORS, COLOR_NAMES, GLYPHS, assignIcon, withIcons, group, ownerOf, moveDir, addProject, deleteProject, renameProject, renameIn, moveTo, place, withGroup, urgent, duration, nameOf, shortPath, splitDir, dirKey, baseName, isHome, tabsOf, tabGroups, landing, withDirColors } from "./model.js";

const MOD = "my-projects";
const STATE = `${MOD}.state`;
const ICONS = `${MOD}.icons`;
const ORDER = `${MOD}.order`;
const PILLS = `${MOD}.pills`;
// With the tab bar (mods/my-tabs), which shows one project's tabs: the project picked here
// ({ project, at }; null: Unsorted), each project's last-used pane (the bar keeps it), each
// directory's color (pill dots, tab groups), the project the bar shows ({ project }), the
// bar's dragged tab order.
const PICK = `${MOD}.pick`;
const LAST = `${MOD}.last`;
const DIRCOLORS = `${MOD}.groupcolors`;
const OLD_DIRCOLORS = `${MOD}.dircolors`; // colors by an earlier rule (2026-11-11), dropped
const SHOWN = "my-tabs.project";
const TAB_ORDER = "my-tabs.order";
// Until 2026-11-11 projects were folder names and this listed the ones made with +.
// Read only to start STATE: those come along, empty; everything else starts Unsorted.
const KEPT = `${MOD}.list`;
const UNSORTED = "\u0000unsorted";
const icon = (g) => `mods/${MOD}/icons/${g}.svg`;
const chrome = (n) => `mods/workspace-chrome/${n}.svg`;
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(36);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, as in the shipped lists.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// The color the layout gives a focused pane's frame (#6272a4 in my-main).
function ringColor(t) {
  const c = find(layout(), "main")?.content?.pane?.focus?.color;
  return (c && (t[c] ?? c)) || t.ring || t.accent;
}

// A color at some opacity ("1f" = 12%), when it's a plain #rrggbb; else the fallback.
const faint = (c, alpha, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + alpha : fallback);

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// A folded row speaks up for these; idle says nothing.
const loud = (s) => (s === "blocked" || s === "done" || s === "working" ? s : null);

function mark(t, s) {
  if (s === "working") return svg(chrome("spinner")).size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (s === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
  if (s === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return null;
}

function tile(ic, size = 18) {
  return h_flex().size(size).flex_none().rounded(5).bg(ic.color + "33").items_center().justify_center()
    .child(svg(icon(ic.glyph)).size(Math.round(size * 0.67)).text_color(ic.color));
}

function plainTile(t, path, size = 18) {
  return h_flex().size(size).flex_none().rounded(5).bg(t.selected).items_center().justify_center()
    .child(svg(path).size(Math.round(size * 0.61)).text_color(t.muted));
}

// The projects and their directories. Before the first write, the projects made with +
// under the old rule, empty.
function state() {
  const s = shared(STATE);
  if (s && Array.isArray(s.projects)) return { projects: s.projects, loose: s.loose ?? [] };
  const kept = (shared(KEPT) ?? []).filter((n) => typeof n === "string" && n.trim());
  return { projects: kept.map((n) => ({ name: n.trim(), dirs: [] })), loose: [] };
}
const save = (s) => setShared(STATE, s);

// The agent programs: Herdr's own list (the + menu keeps the last one it got), and these.
const agentKeys = () => new Set(["claude", "codex", "gemini", "opencode", "pi",
  ...Object.values(shared("new-menu.agents") ?? {}).flat().filter((p) => p?.agent && p.key).map((p) => p.key)]);

// Every conversation, with its machine, space and folder: each pane running an agent,
// including one that reports no status, such as `claude attach` to a background session
// (Herdr's agents() leaves those out). Not by p.app: it outlives the agent.
function conversations() {
  const reported = new Map(agents().map((a) => [a.pane, a]));
  const terms = new Map(terminals().map((x) => [x.address, x]));
  const tabs = new Map(spaces().flatMap((s) => (s.tabs ?? []).map((tab) => [tab.id, { tab, space: s }])));
  const keys = agentKeys();
  return panes().filter((p) => p.terminal && (reported.has(p.pane) || p.program?.agent || keys.has(p.program?.key))).map((p, i) => {
    const a = reported.get(p.pane), address = a?.address ?? p.terminal;
    const at = tabs.get(p.tab), term = terms.get(address);
    const program = a?.program ?? p.program;
    return {
      address, pane: p.pane, status: a?.status ?? p.status ?? null, focused: p.focused, program, order: i,
      machine: at?.space.machine ?? (address.includes("/") ? address.split("/")[0] : null),
      space: at?.space.id ?? null,
      cwd: p.cwd || term?.cwd || at?.space.folder || "",
      name: nameOf({ address, title: a?.title ?? p.title, program }, at?.tab),
    };
  });
}

const projectsNow = (convs = conversations()) => group(convs, state(), { home: home(), order: shared(ORDER) ?? [], pills: shared(PILLS) ?? [] });

// One group's pills as shown: a project's name, or UNSORTED.
function pillKeys(name) {
  const g = projectsNow(), box = name === UNSORTED ? g.unsorted : g.projects.find((p) => p.name === name);
  return (box?.pills ?? []).map((pl) => pl.key);
}

// Moves a directory to a project (null: Unsorted), or within its own: before or after one of
// that group's pills (slot: { at, after }), else to the end of them.
function moveDirTo(key, to, slot = null) {
  const keys = pillKeys(to ?? UNSORTED);
  setShared(PILLS, withGroup(shared(PILLS) ?? [], slot ? place(keys, key, slot.at, slot.after) : [...keys.filter((k) => k !== key), key]));
  const s = state();
  if (ownerOf(key, s.projects, s.loose) !== to) save(moveDir(s, key, to));
}
const iconOf = (name) => (shared(ICONS) ?? {})[name] ?? assignIcon(name);
const homeOf = (machine) => (machine ? null : home());
const where = (key) => { const d = splitDir(key); return `${d.machine ?? "local"} · ${shortPath(d.path, homeOf(d.machine))}`; };

// Starts Claude in a directory: a new tab in the space its conversations are in, else the
// machine's first space, else a new space there.
function newSession(pill) {
  const { machine, path } = pill;
  const space = pill.convs.find((c) => c.space)?.space ?? spaces().find((s) => (s.machine ?? null) === machine)?.id;
  const known = (shared("new-menu.agents") ?? {})[machine ?? ""] ?? [];
  const argv = known.find((a) => a.key === "claude")?.run ?? ["claude"];
  if (space) run("tab.new", { space, folder: path, argv });
  else run("space.new", { machine: machine ?? "", folder: path, argv });
}

// Picking a project (null: Unsorted) shows its tabs in the tab bar: its last-used pane gets
// focus, else its first tab's; with no tabs, the bar shows it empty until focus moves.
function pickProject(name) {
  const tabs = tabsOf(spaces(), panes(), agents());
  const groups = tabGroups(tabs, state(), name, { home: home(), pills: shared(PILLS) ?? [], order: shared(TAB_ORDER) ?? [] });
  const pane = landing(groups, (shared(LAST) ?? {})[name ?? UNSORTED]);
  setShared(PICK, { project: name, at: Date.now() });
  if (pane) run("pane.focus", { pane });
}

const popup = (p, width, height) => openOverlay({ mod: MOD, kind: "popup", width, height, props: p });
const ICON_H = 10 + 22 + 8 + 1 + 8 + (4 * 30 + 3 * 2) + 8 + 26 + 10;
const openIcon = (project) => popup({ role: "icon", project }, 196, ICON_H);
// What a directory's menu offers: the projects it isn't in, and whether it's in one.
function dirTargets(key) {
  const s = state(), from = ownerOf(key, s.projects, s.loose);
  return { from, names: projectsNow().projects.map((p) => p.name).filter((n) => n !== from) };
}
function openDirMenu(key) {
  const i = dirTargets(key);
  popup({ role: "dir", dir: key }, 236, 10 + 26 + Math.min(i.names.length, 8) * 30 + (i.names.length ? 9 : 0) + 30 + (i.from !== null ? 30 : 0));
}
const openProject = (project) => popup({ role: "project", project }, 212, 10 + 30 + 30 + 9 + 30);
// Right-click on the list where there's no row (or on Unsorted's row).
const openBlank = () => popup({ role: "blank" }, 200, 10 + 30 + 9 + 30 + 30);
const openNew = (dir = null) => openOverlay({ mod: MOD, kind: "dialog", width: 380, height: 214, props: { role: "new", dir } });
const openRename = (project) => openOverlay({ mod: MOD, kind: "dialog", width: 380, height: 214, props: { role: "rename", project } });
// Deleting goes through Herdr's own confirm dialog, which runs "my-projects.delete <name>".
function askDelete(name) {
  const n = projectsNow().projects.find((p) => p.name === name)?.pills.length ?? 0;
  openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 170, props: {
    title: `Delete ${name}?`,
    detail: n ? `${n === 1 ? "Its directory goes" : `Its ${n} directories go`} back to Unsorted. The conversations keep running.` : "It has no directories.",
    command: { name: `${MOD}.delete ${name}` },
  } });
}

export default class Projects extends View {
  init(_props, cx) {
    if (props()?.role) { this.part = new Popup(); this.part.init(cx); return; }
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
    this.closed = new Set(read("closed", []));
    this.open = read("open", {});
    this.changed = read("changed", {});
    // A drag: a project's row (to reorder) or a directory's pill (into another group). It
    // starts on the press and counts once the pointer has gone 4 px, so a click stays a click.
    this.drag = null; // { kind: "project", name } or { kind: "dir", key, from, grab, look }; x, y, moved, at
    this.over = null; // the group under the pointer while dragging: a project's name, or UNSORTED
    this.overPill = null; // the pill under it, and which half: { key, after }
    this.hit = null; // the group and pill the pointer event now going up the tree passed through
    this.hitPill = null;
    this.names = []; // the projects as shown, in order
    this.shown = {}; // each group's pills as shown (keys), by group
    // The list's scroll position, kept across redraws: a fold must not send it to the top.
    this.scroll = ScrollHandle.new();
    cx.timer.every(30000, (cx) => cx.notify());
    // The Agents list knows when each agent last changed state: start from that.
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${appHome()}/data/my-agents/store.json`).catch(() => null);
      let theirs = {};
      try { const raw = JSON.parse(text ?? "{}")?.changed; theirs = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? {}; } catch {}
      for (const [k, c] of Object.entries(theirs)) {
        const mine = this.changed[k];
        if (c?.at && (!mine || (mine.s === c.s && c.at < mine.at))) this.changed[k] = { s: c.s, at: c.at };
      }
      localStorage.setItem("changed", JSON.stringify(this.changed));
      cx.notify();
    });
    // Commands (keys.json, the confirm dialog, or `herdr-app do "my-projects.icon herdr"`).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const i = c.indexOf(" "), verb = i < 0 ? c : c.slice(0, i), arg = i < 0 ? "" : c.slice(i + 1).trim();
        if (verb === "new") openNew();
        else if (verb === "icon" && arg) openIcon(arg);
        else if (verb === "menu" && arg) openProject(arg);
        else if (verb === "delete" && arg) { save(deleteProject(state(), arg)); this.forget(arg); }
        // From the rename dialog: ["old name", "new name"].
        else if (verb === "rename" && arg) { try { const [from, to] = JSON.parse(arg); this.rename(String(from), String(to)); } catch {} }
        // From the blank-area menu (a popup is another copy of this mod: it asks this one).
        else if (verb === "fold-all") { this.closed = new Set([...this.names, UNSORTED]); this.save(); }
        else if (verb === "unfold-all") { this.closed = new Set(); this.save(); }
        cx.notify();
      }
    });
  }

  save() {
    localStorage.setItem("closed", JSON.stringify([...this.closed]));
    localStorage.setItem("open", JSON.stringify(this.open));
  }

  // A project's new name, everywhere the old one is kept. Icons and order first, so the
  // redraw the state write causes already finds them under the new name.
  rename(from, to) {
    const s = state(), next = renameProject(s, from, to);
    if (next === s) return;
    const icons = shared(ICONS) ?? {};
    setShared(ICONS, renameIn({ ...icons, [from]: icons[from] ?? iconOf(from) }, from, to));
    setShared(ORDER, renameIn(shared(ORDER) ?? [], from, to));
    save(next);
    const folded = this.closed.delete(from), shown = this.open[from];
    this.forget(to); // a deleted project's fold, under the name this one takes
    if (folded) this.closed.add(to);
    if (shown) this.open[to] = shown;
    delete this.open[from];
    this.save();
  }

  forget(name) {
    this.closed.delete(name);
    delete this.open[name];
    this.save();
  }

  // Where a dragged pill would go among the pills it's over: before or after one of them
  // ({ at, after }), when that changes their order. Off a pill, it goes to the end.
  slot() {
    const d = this.drag, h = this.overPill;
    if (d?.kind !== "dir" || !d.moved || !h || this.over === null) return null;
    const keys = this.shown[this.over] ?? [];
    if (!keys.includes(h.key)) return null;
    if (this.over === d.from && place(keys, d.key, h.key, h.after).join("\n") === keys.join("\n")) return null;
    return { at: h.key, after: h.after };
  }

  // The group the drag would land in: another project, for a project's row; for a pill,
  // another group, or its own at a new place.
  target() {
    const d = this.drag, o = this.over;
    if (!d?.moved || o === null) return null;
    if (d.kind === "project") return o !== d.name && o !== UNSORTED ? o : null;
    return o !== d.from || this.slot() ? o : null;
  }

  press(drag, e) {
    this.drag = { ...drag, x: e.position.x, y: e.position.y, moved: false, at: null };
    this.over = null;
    this.overPill = null;
  }

  // The pointer moved over the panel. The group and pill it passed through on the way said which.
  dragMove(e, cx) {
    const hit = this.hit, hitPill = this.hitPill, d = this.drag;
    this.hit = null;
    this.hitPill = null;
    if (!d) return;
    if (!d.moved && Math.abs(e.position.x - d.x) + Math.abs(e.position.y - d.y) < 4) return;
    const was = d.moved ? this.target() : undefined;
    d.moved = true;
    this.over = hit;
    // The pill's box, from window pixels to the panel's own (both screen pixels).
    const ox = e.position.x - e.local_position.x, oy = e.position.y - e.local_position.y, b = hitPill?.box;
    this.overPill = hitPill && { key: hitPill.key, after: hitPill.after, rect: b ? { x: b.x - ox, y: b.y - oy, w: b.width, h: b.height } : null };
    if (d.kind === "dir") { d.at = e.local_position; cx.notify(); } // the pill goes with the pointer
    else if (this.target() !== was) cx.notify();
  }

  // The release: the drag lands where target() and slot() say, or nowhere.
  drop(cx) {
    const d = this.drag, to = this.target(), slot = this.slot();
    this.drag = null;
    this.over = null;
    this.overPill = null;
    if (!d) return;
    if (to !== null && d.kind === "project") setShared(ORDER, moveTo(this.names, d.name, to));
    else if (to !== null) {
      moveDirTo(d.key, to === UNSORTED ? null : to, slot);
      // An open pill stays open where it lands.
      if (to !== d.from && this.open[d.from] === d.key) { this.open[d.from] = null; this.open[to] = d.key; this.save(); }
    }
    cx.notify();
  }

  cancel(cx) {
    if (!this.drag) return;
    this.drag = null;
    this.over = null;
    this.overPill = null;
    cx.notify();
  }

  // Stamps conversations whose state changed (done and idle count as one).
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  plus(t) {
    return div().id("project-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("New project")
      .on_click(() => openNew()).child(svg(chrome("plus")).size(14));
  }

  // A group's row: icon, name, (folded: its loudest state), count, chevron. A press on a
  // project's row starts a drag (see project()); a click folds it.
  head(t, h) {
    const logo = div().id(`icon-${h.id}`).size(24).flex_none().rounded(6).flex().items_center().justify_center().child(h.tile)
      .when(Boolean(h.iconClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Change icon")
        // Pressing the icon starts no drag.
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); h.iconClick(); }));
    // Only the chevron folds.
    const fold = div().id(`fold-${h.id}`).size(20).flex_none().rounded(5).flex().items_center().justify_center()
      .cursor_pointer().hover((s) => s.bg(t.selected)).tooltip(h.closed ? "Unfold" : "Fold")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); h.toggle(); this.save(); cx.notify(); })
      .child(svg(chrome(h.closed ? "chevron-right" : "chevron-down")).size(11).text_color(t.dim));
    return h_flex().id(`head-${h.id}`).h(30).flex_none().pl(5).pr(4).gap(6).items_center().rounded(8)
      .when(h.current, (el) => el.bg(t.hover))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(Boolean(h.drag), (el) => el.on_mouse_down("left", (e) => this.press({ kind: "project", name: h.drag }, e)))
      // A click shows the project's tabs in the tab bar. A release that ends a drag isn't a click.
      .on_click((_e, cx) => { if (this.drag?.moved) return; h.pick(); cx.notify(); })
      // A row with its own menu keeps the right-click from the list's blank-area menu.
      .when(Boolean(h.menu), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); h.menu(); }))
      .child(logo)
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(h.dim ? t.muted : t.foreground).child(h.name))
      .when(h.closed && Boolean(h.status), (el) => el.child(mark(t, h.status)))
      .child(div().w(16).flex_none().text_center().text_size(11).text_color(t.dim).child(String(h.count)))
      .child(fold);
  }

  // A directory's pill. Pressed and dragged, a copy goes with the pointer (ghost()); let go
  // on a pill, it goes before or after it (slotLine(), by which half), else to the end of the
  // group it's over. Another group's pill or group moves the directory there.
  pill(t, id, ring, o) {
    return h_flex().id(id).h(22).flex_none().pl(7).pr(8).gap(5).items_center().rounded(11)
      .border_1().border_color(o.here ? ring : t.input).when(o.open, (el) => el.bg(t.selected))
      .when(o.lifted, (el) => el.opacity(0.35))
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(o.tooltip)
      .on_mouse_down("left", (e) => this.press({ kind: "dir", key: o.key, from: o.group, grab: e.local_position ?? { x: 12, y: 11 },
        look: { machine: o.machine, label: o.label, detail: o.detail, count: o.count, color: o.color } }, e))
      .on_mouse_move((e) => {
        if (this.drag?.kind === "dir") this.hitPill = { key: o.key, after: e.local_position.x > (e.bounds?.width ?? 0) / 2, box: e.bounds };
      })
      .on_click((_e, cx) => { if (this.drag?.moved) return; o.click(cx); this.save(); cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); o.menu(); })
      .children(this.pillParts(t, o));
  }

  // What a pill shows: machine, directory name, (folded: its loudest state), count.
  pillParts(t, o) {
    return [
      // The directory's color, the one its group of tabs has in the tab bar.
      ...(o.color ? [div().size(7).flex_none().rounded(4).bg(o.color)] : []),
      svg(chrome(o.machine ? "server" : "monitor")).size(11).flex_none().text_color(t.muted),
      div().flex_none().text_size(11.5).text_color(o.dim ? t.muted : t.foreground).child(o.label),
      div().min_w(0).max_w(104).truncate().text_size(11.5).text_color(t.muted).child(o.detail),
      ...(o.status ? [mark(t, o.status)] : []),
      div().flex_none().text_size(11).text_color(t.muted).child(o.count),
    ];
  }

  // The dragged pill, where the pointer holds it. Pointer positions are screen pixels; sizes
  // here are scaled by the zoom setting, so the offset is divided by it.
  ghost(t, ring) {
    const d = this.drag;
    if (d?.kind !== "dir" || !d.moved || !d.at) return null;
    const z = Number(settings()?.zoom) || 1;
    return h_flex().absolute().left((d.at.x - d.grab.x) / z).top((d.at.y - d.grab.y) / z).h(22).pl(7).pr(8).gap(5).items_center().rounded(11)
      .border_1().border_color(ring).bg(t.popover).shadow_md()
      .children(this.pillParts(t, d.look));
  }

  // Where the dragged pill would go: a line in the 5 px gap before or after the pill it's
  // over. Drawn above the dragged copy, which would otherwise hide it.
  slotLine(ring) {
    const r = this.overPill?.rect;
    if (!this.slot() || !r) return null;
    const z = Number(settings()?.zoom) || 1;
    const mid = this.overPill.after ? r.x + r.w + 2.5 * z : r.x - 2.5 * z;
    return div().absolute().left(mid / z - 1).top(r.y / z + 2).w(2).h(r.h / z - 4).rounded(1).bg(ring);
  }

  // An open pill's full path, with a + that starts Claude there. Right-click: its directory's menu.
  pathRow(t, pl) {
    return h_flex().id(`path-${hash(pl.key)}`).h(20).flex_none().pl(35).pr(2).gap(6).items_center()
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDirMenu(pl.key); })
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(shortPath(pl.path, homeOf(pl.machine))))
      .child(div().id(`new-${hash(pl.key)}`).size(20).flex_none().rounded(5).flex().items_center().justify_center()
        .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("New Claude session here")
        .on_click(() => newSession(pl)).child(svg(chrome("plus")).size(12)));
  }

  conv(t, c, now) {
    const since = this.changed[c.address]?.at;
    // Idle, or an agent that reports no status: dimmed.
    const quiet = (c.status === "idle" || c.status == null) && !c.focused;
    const pic = programIcon(c.program, 14, t.foreground);
    return h_flex().id(`conv-${c.address}`).h(26).flex_none().ml(27).px(8).gap(7).items_center().rounded(7)
      .when(c.focused, (el) => el.bg(t.selected)).when(!c.focused, (el) => el.hover((s) => s.bg(t.hover)))
      .cursor_pointer()
      .on_click(() => run("pane.focus", { pane: c.pane }))
      // Right-click: the menu of the directory it runs in (projects hold directories).
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openDirMenu(dirKey(c.machine, c.cwd)); })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(quiet ? t.muted : t.foreground).child(c.name))
      .when(Boolean(since), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - since))))
      .child(h_flex().w(14).flex_none().justify_center().child(mark(t, c.status) ?? div()));
  }

  // A project (or Unsorted): its row, its pills, and the open pill's path and conversations.
  // The whole group is where a drag lands. A dragged project goes next to it (the line:
  // above it when coming from below, under it from above); a pill goes into it (the box).
  project(t, p, ring, now) {
    const closed = this.closed.has(p.key);
    const head = this.head(t, {
      id: hash(p.key), name: p.label ?? p.name, count: p.convs.length, closed, dim: !p.convs.length,
      tile: p.icon ? tile(p.icon) : plainTile(t, icon("inbox")),
      status: loud(urgent(p.convs.map((c) => c.status))),
      toggle: () => (closed ? this.closed.delete(p.key) : this.closed.add(p.key)),
      pick: () => pickProject(p.icon ? p.name : null),
      current: this.shownProject !== undefined && this.shownProject === (p.icon ? p.name : null),
      iconClick: p.icon ? () => openIcon(p.name) : null,
      menu: p.icon ? () => openProject(p.name) : null,
      drag: p.icon ? p.name : null, // Unsorted: always last, not dragged
    });
    const d = this.drag, to = this.target();
    const from = d?.kind === "project" ? this.names.indexOf(d.name) : -1, at = this.names.indexOf(p.name);
    const line = d?.kind === "project" && to === p.key, box = d?.kind === "dir" && to === p.key && to !== d.from;
    return v_flex().id(`group-${hash(p.key)}`).relative().flex_none().rounded(8)
      .on_mouse_move(() => { this.hit = p.key; })
      .when(d?.kind === "project" && d.name === p.name && to !== null, (el) => el.opacity(0.5))
      .when(box, (el) => el.bg(faint(ring, "1f", t.selected)))
      .children(this.rows(t, p, head, closed, ring, now))
      .when(box, (el) => el.child(div().absolute().left(0).right(0).top(0).bottom(0).rounded(8).border_1().border_color(ring)))
      .when(line, (el) => el.child(div().absolute().left(0).right(0).h(2).rounded(1).bg(ring)
        .when(from < at, (l) => l.bottom(0)).when(from > at, (l) => l.top(0))));
  }

  rows(t, p, head, closed, ring, now) {
    if (closed || !p.pills.length) return [head];
    const shown = p.pills.find((pl) => pl.key === this.open[p.key]);
    const d = this.drag;
    return [
      head,
      h_flex().flex_none().flex_wrap().gap(5).pl(35).pb(6).children(p.pills.map((pl) => this.pill(t, `pill-${hash(p.key + "\u0000" + pl.key)}`, ring, {
        key: pl.key, group: p.key, lifted: d?.kind === "dir" && d.moved && d.key === pl.key && d.from === p.key,
        machine: pl.machine, label: pl.label, detail: pl.detail, count: String(pl.convs.length), dim: !pl.convs.length,
        color: (shared(DIRCOLORS) ?? {})[pl.key] ?? null,
        open: pl === shown, here: pl.convs.some((c) => c.focused),
        status: pl === shown ? null : loud(urgent(pl.convs.map((c) => c.status))),
        tooltip: `${pl.machine ?? "This computer"}: ${shortPath(pl.path, homeOf(pl.machine))}. Drag to reorder, or onto another project; right-click to move it.`,
        click: () => { this.open[p.key] = pl === shown ? null : pl.key; },
        menu: () => openDirMenu(pl.key),
      }))),
      ...(shown ? [this.pathRow(t, shown), ...shown.convs.map((c) => this.conv(t, c, now)), div().h(6).flex_none()] : []),
    ];
  }

  // The narrow sidebar: a tile per project; a click goes to the conversation that needs you most.
  rail(t, projects, unsorted) {
    const cell = (id, name, pic, convs) => {
      const status = loud(urgent(convs.map((c) => c.status)));
      const target = convs.find((c) => c.status === "blocked") ?? convs.find((c) => c.status === "done") ?? convs.find((c) => c.focused) ?? convs[0];
      return div().id(`rail-${id}`).relative().size(32).flex_none().rounded(7).flex().items_center().justify_center()
        .when(convs.some((c) => c.focused), (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).tooltip(name)
        .when(Boolean(target), (el) => el.cursor_pointer().on_click(() => run("pane.focus", { pane: target.pane })))
        .child(pic)
        .when(Boolean(status), (el) => el.child(div().absolute().right(3).bottom(3).size(7).rounded(4).border_1().border_color(t.chrome).bg(t[status])));
    };
    return v_flex().size_full().min_h(0).bg(t.chrome).items_center()
      .child(h_flex().h(31).flex_none().items_center().justify_center().child(this.plus(t)))
      .child(v_flex().id("projects-rail").flex_1().min_h(0).w_full().items_center().gap(2).pb(14).overflow_y_scrollbar().children([
        ...projects.map((p) => cell(hash(p.name), p.name, tile(iconOf(p.name)), p.convs)),
        ...(unsorted ? [cell("unsorted", "Unsorted", plainTile(t, icon("inbox")), unsorted.convs)] : []),
      ]));
  }

  render(cx) {
    if (this.part) return this.part.render(cx);
    const t = theme(), now = Date.now();
    const convs = conversations();
    this.track(convs, now);
    const { projects, unsorted } = projectsNow(convs);
    // A project seen for the first time gets its icon once; a write re-renders every mod.
    const icons = withIcons(shared(ICONS), projects.map((p) => p.name));
    if (icons) setShared(ICONS, icons);
    // Each directory's color (its pill's dot, its group in the tab bar), given once. The tab bar
    // gives one to directories with no pill; colors already given in a project count as used.
    const stored = shared(DIRCOLORS) ?? {}, st = state();
    const owned = (name) => Object.keys(stored).filter((k) => ownerOf(k, st.projects, st.loose) === name);
    const plan = (p, name, icon) => ({ keys: [...new Set([...p.pills.map((pl) => pl.key), ...owned(name)])], icon });
    const colors = withDirColors(stored, [...projects.map((p) => plan(p, p.name, iconOf(p.name).color)), ...(unsorted ? [plan(unsorted, null, null)] : [])]);
    if (colors) setShared(DIRCOLORS, colors);
    if (shared(OLD_DIRCOLORS) != null) setShared(OLD_DIRCOLORS, null);
    // The project the tab bar shows (undefined until it says).
    const sp = shared(SHOWN);
    this.shownProject = sp && typeof sp === "object" && "project" in sp ? sp.project : undefined;
    this.names = projects.map((p) => p.name);
    this.shown = Object.fromEntries([...projects.map((p) => [p.name, p.pills.map((pl) => pl.key)]),
      ...(unsorted ? [[UNSORTED, unsorted.pills.map((pl) => pl.key)]] : [])]);
    if (narrow()) return this.rail(t, projects, unsorted);
    const ring = ringColor(t);
    const rows = [
      ...projects.map((p) => this.project(t, { ...p, key: p.name, icon: iconOf(p.name) }, ring, now)),
      ...(unsorted ? [this.project(t, { ...unsorted, key: UNSORTED, name: UNSORTED, label: "Unsorted" }, ring, now)] : []),
      ...(!projects.length && !unsorted ? [div().px(8).py(6).text_size(12).text_color(t.dim).child("No conversations yet.")] : []),
    ];
    const ghost = this.ghost(t, ring), slotLine = this.slotLine(ring);
    return v_flex().id("projects-panel").relative().overflow_hidden().size_full().min_h(0).bg(t.chrome).text_size(13)
      // Drags. Each group notes that the pointer is over it (this.hit) before this hears the
      // move; a release anywhere but on a group it can land in changes nothing.
      .on_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(cx))
      // Let go outside the panel: forgotten as the pointer leaves, or at the next press.
      .on_hover((inside, cx) => { if (!inside) this.cancel(cx); })
      .on_mouse_down("left", (_e, cx) => { if (this.drag?.moved) this.cancel(cx); })
      .child(h_flex().id("projects-header").h(31).flex_none().pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .on_mouse_down("right", () => openBlank())
        .child("Projects").child(this.plus(t)))
      // Named, with its own handle: an element without a name is identified by its place in
      // the tree, which moves when a fold changes the rows, and its scroll position goes with it.
      .child(v_flex().id("projects-list").flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().track_scroll(this.scroll).mode("always")
        // Rows with menus of their own stop their right-clicks; what reaches here is blank space.
        .on_mouse_down("right", () => openBlank())
        .children(rows))
      .when(Boolean(ghost), (el) => el.child(ghost))
      .when(Boolean(slotLine), (el) => el.child(slotLine));
  }
}

const esc = (e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } };

// The popups: a project's icon, a directory's menu, a project's menu, the blank-area menu,
// and the name dialog (a new project, or renaming one).
class Popup {
  init(cx) {
    this.handle = cx.focus_handle();
    this.error = null;
    const p = props();
    if (p.role === "new" || p.role === "rename") {
      // Renaming: the name it has. Moving a directory: the directory's. Selected, so typing replaces it.
      const d = p.dir ? splitDir(p.dir) : null;
      const value = p.role === "rename" ? p.project : d && !isHome(d.path, homeOf(d.machine)) ? baseName(d.path) : "";
      this.input = InputState.new({ value, placeholder: "Project name" });
      if (value) this.input.set_selected_range({ start: 0, end: value.length });
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.submit(cx));
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  submit(cx) {
    const p = props();
    const name = this.input.value().trim().slice(0, 40);
    if (!name) { this.error = "Type a name."; cx.notify(); return; }
    const s = state(), taken = s.projects.some((x) => x.name === name);
    if (p.role === "rename") {
      if (name !== p.project && taken) { this.error = "There's a project with this name."; cx.notify(); return; }
      // The list keeps its folds by name, so it does the renaming (a command).
      if (name !== p.project) run(`${MOD}.rename ${JSON.stringify([p.project, name])}`);
    } else {
      if (!p.dir && taken) { this.error = "There's a project with this name."; cx.notify(); return; }
      save(addProject(s, name, p.dir ?? null));
    }
    closeOverlay(p.overlay);
  }

  // A menu row. Pictures (14 px glyphs, 16 px project tiles) get one width, so the words line up.
  item(t, id, pic, text, action, color) {
    return h_flex().id(id).h(30).flex_none().px(8).gap(9).items_center().rounded(7).text_color(color ?? t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action)
      .child(h_flex().size(16).flex_none().items_center().justify_center().child(pic))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  iconView(t, p) {
    const name = p.project, cur = iconOf(name);
    const set = (patch) => setShared(ICONS, { ...(shared(ICONS) ?? {}), [name]: { glyph: cur.glyph, color: cur.color, ...patch, custom: true } });
    const swatch = (c, i) => h_flex().id(`color-${i}`).size(22).flex_none().rounded(11).items_center().justify_center()
      .border(2).border_color(c === cur.color ? t.foreground : t.popover).cursor_pointer().tooltip(COLOR_NAMES[i])
      .on_click(() => set({ color: c })).child(div().size(14).rounded(7).bg(c));
    const cell = (g) => h_flex().id(`glyph-${g}`).flex_1().h(30).rounded(6).items_center().justify_center().cursor_pointer()
      .when(g === cur.glyph, (el) => el.bg(cur.color + "33")).when(g !== cur.glyph, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => set({ glyph: g }))
      .child(svg(icon(g)).size(16).text_color(g === cur.glyph ? cur.color : t.muted));
    return v_flex().id("icon-picker").track_focus(this.handle).on_key_down(esc).size_full().p(10).gap(8).bg(t.popover)
      .child(h_flex().h(22).flex_none().px(2).items_center().justify_between().children(COLORS.map(swatch)))
      .child(div().h(1).flex_none().bg(t.border))
      .child(v_flex().flex_none().gap(2).children([0, 5, 10, 15].map((i) => h_flex().gap(2).children(GLYPHS.slice(i, i + 5).map(cell)))))
      .child(h_flex().id("icon-reset").h(26).flex_none().rounded(6).items_center().justify_center().text_size(12).text_color(t.muted)
        .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => { const s = { ...(shared(ICONS) ?? {}) }; delete s[name]; setShared(ICONS, s); })
        .child("Reset to generated"));
  }

  // A directory's menu: the projects it can go to, a new one, back to Unsorted.
  dirView(t, p) {
    const key = p.dir, { from, names } = dirTargets(key);
    const go = (to) => () => { moveDirTo(key, to); closeOverlay(p.overlay); };
    return v_flex().id("dir-menu").track_focus(this.handle).on_key_down(esc).size_full().p(5).bg(t.popover).text_size(12.8)
      .child(h_flex().h(26).flex_none().px(8).items_center()
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(`Move ${where(key)} to`)))
      // A popup is as tall as its content, so the list says its height (eight rows, then it scrolls).
      .child(v_flex().id("move-list").flex_none().h(Math.min(names.length, 8) * 30).overflow_y_scrollbar().children(names.map((n) =>
        this.item(t, `to-${hash(n)}`, tile(iconOf(n), 16), n, go(n)))))
      .when(names.length > 0, (el) => el.child(div().mx(7).my(4).h(1).flex_none().bg(t.border)))
      .child(this.item(t, "to-new", svg(chrome("folder-plus")).size(14).flex_none().text_color(t.muted), "New project…",
        () => { closeOverlay(p.overlay); openNew(key); }))
      .when(from !== null, (el) => el.child(this.item(t, "to-unsorted", svg(icon("inbox")).size(14).flex_none().text_color(t.muted),
        "Back to Unsorted", go(null))));
  }

  projectView(t, p) {
    const name = p.project;
    return v_flex().id("project-menu").track_focus(this.handle).on_key_down(esc).size_full().p(5).bg(t.popover).text_size(12.8)
      .child(this.item(t, "pm-rename", svg(chrome("square-pen")).size(14).flex_none().text_color(t.muted), "Rename…",
        () => { closeOverlay(p.overlay); openRename(name); }))
      .child(this.item(t, "pm-icon", tile(iconOf(name), 16), "Change icon…",
        () => { closeOverlay(p.overlay); openIcon(name); }))
      .child(div().mx(7).my(4).h(1).flex_none().bg(t.border))
      .child(this.item(t, "pm-delete", svg(icon("trash")).size(14).flex_none().text_color(t.blocked), "Delete project…",
        () => { closeOverlay(p.overlay); askDelete(name); }, t.blocked));
  }

  // The blank-area menu. Folding is the list's own state, so the list does it (a command).
  blankView(t, p) {
    const then = (fn) => () => { closeOverlay(p.overlay); fn(); };
    return v_flex().id("blank-menu").track_focus(this.handle).on_key_down(esc).size_full().p(5).bg(t.popover).text_size(12.8)
      .child(this.item(t, "bm-new", svg(chrome("folder-plus")).size(14).flex_none().text_color(t.muted), "New project…", then(() => openNew())))
      .child(div().mx(7).my(4).h(1).flex_none().bg(t.border))
      .child(this.item(t, "bm-fold", svg(chrome("chevron-right")).size(14).flex_none().text_color(t.muted), "Fold all", then(() => run(`${MOD}.fold-all`))))
      .child(this.item(t, "bm-unfold", svg(chrome("chevron-down")).size(14).flex_none().text_color(t.muted), "Unfold all", then(() => run(`${MOD}.unfold-all`))));
  }

  // The name dialog: a new project, or a new name for one.
  nameView(t, p) {
    const renaming = p.role === "rename";
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    const hint = renaming ? "Its directories and icon stay." : p.dir ? `Moves ${where(p.dir)} into it.` : "Then drag pills onto it, or right-click one.";
    return v_flex().id("new-project").track_focus(this.handle).on_key_down(esc).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(renaming ? "Rename project" : "New project"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(ringColor(t)).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().pt(6).text_size(11.5).text_color(this.error ? t.blocked : t.dim).child(this.error ?? hint))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("np-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("np-create", renaming ? "Rename" : "Create", true, (_e, cx) => this.submit(cx))));
  }

  render() {
    const t = theme(), p = props() ?? {};
    if (p.role === "icon") return this.iconView(t, p);
    if (p.role === "dir") return this.dirView(t, p);
    if (p.role === "project") return this.projectView(t, p);
    if (p.role === "blank") return this.blankView(t, p);
    return this.nameView(t, p);
  }
}
