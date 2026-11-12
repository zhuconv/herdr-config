// A copy of mods/my-projects/model.js, made by build.sh: a mod can't import outside its folder. Edit that file, not this one.
// my-projects: the part that needs nothing from Herdr, so node can test it.
//
// A project is a list of directories, each a machine and a path. A conversation (an
// agent's terminal) belongs to the project holding the directory it runs in, or the
// nearest parent of it on the same machine; else it is Unsorted. Inside a group,
// conversations sit in pills, one per directory they run in.
//
// The state: { projects: [{ name, dirs: [key] }], loose: [key] }. `loose`: directories
// kept in Unsorted although a parent of theirs is in a project.

// Herdr's own avatar hues, as the shipped Spaces list draws them.
export const COLORS = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];
export const COLOR_NAMES = ["Teal", "Orange", "Blue", "Purple", "Green", "Pink"];
// The files in icons/ (Lucide, ISC).
export const GLYPHS = ["box", "flask", "leaf", "anchor", "zap", "compass", "flag", "gem", "mountain", "feather", "moon", "layers", "shield", "sun", "flame", "star", "cloud", "globe", "droplet", "crown"];

export function fnv(s, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// A generated icon: the glyph and color the name's hash picks, moved on to the next
// ones the other projects (`used`) don't have, while some are free.
export function assignIcon(name, used = []) {
  const glyphs = new Set(used.map((u) => u.glyph)), colors = new Set(used.map((u) => u.color));
  let g = fnv(name, 0x68bc21eb) % GLYPHS.length;
  for (let k = 0; k < GLYPHS.length && glyphs.has(GLYPHS[g]); k++) g = (g + 1) % GLYPHS.length;
  let c = fnv(name) % COLORS.length;
  for (let k = 0; k < COLORS.length && colors.has(COLORS[c]); k++) c = (c + 1) % COLORS.length;
  return { glyph: GLYPHS[g], color: COLORS[c] };
}

// The icon store with every shown project in it: kept icons stay, a new name gets one
// once (so it never changes by itself). Null when nothing was added.
export function withIcons(store, names) {
  const out = { ...(store ?? {}) };
  let added = false;
  for (const n of names) {
    const s = out[n];
    if (s && GLYPHS.includes(s.glyph) && COLORS.includes(s.color)) continue;
    out[n] = assignIcon(n, names.filter((x) => x !== n && out[x]).map((x) => out[x]));
    added = true;
  }
  return added ? out : null;
}

const trim = (p) => {
  const s = String(p ?? "");
  return s.replace(/\/+$/, "") || (s.startsWith("/") ? "/" : "");
};

// A home folder: this computer's, /home/<user> or /Users/<user> on another, or a
// cluster's per-user roots (TACC: /home1/<group>/<user>, /work/…, /scratch/…).
const CLUSTER_HOME = /^\/(?:home|work|scratch)\d*\/\d+\/[^/]+$/;
export function isHome(path, home) {
  const p = trim(path);
  return !p || p === "/" || p === "~" || p === "/root" || (Boolean(home) && p === trim(home))
    || /^\/(?:home|Users)\/[^/]+$/.test(p) || CLUSTER_HOME.test(p);
}

export const baseName = (path) => trim(path).split("/").pop() || trim(path);

// A folder for people: home as ~, a long one as …/its last two parts.
export function shortPath(path, home) {
  let p = trim(path);
  if (!p) return "~";
  const h = trim(home);
  if (h && h !== "/" && (p === h || p.startsWith(h + "/"))) p = "~" + p.slice(h.length);
  else p = p.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~").replace(/^\/home\d+\/\d+\/[^/]+(?=\/|$)/, "~");
  const parts = p.split("/");
  if (p.length > 30 && parts.length > 3) p = "…/" + parts.slice(-2).join("/");
  return p;
}

// Case-blind, by hand: Herdr's JavaScript has no locale-aware localeCompare.
export const byName = (a, b) => {
  const x = String(a).toLowerCase(), y = String(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};
// This computer (null) first, then the others by name.
export const cmpMachine = (a, b) => (a == b ? 0 : a == null ? -1 : b == null ? 1 : byName(a, b));

// A directory's key: its machine ("" for this computer) and its path.
export const dirKey = (machine, path) => `${machine ?? ""}|${trim(path)}`;
export function splitDir(key) {
  const i = String(key).indexOf("|");
  return { machine: key.slice(0, i) || null, path: key.slice(i + 1) };
}
const within = (path, root) => path === root || path.startsWith(root === "/" ? "/" : root + "/");

// Who a directory belongs to: whoever has it or its nearest parent on the same machine.
// A project's name, or null (Unsorted: a `loose` entry, or nobody).
export function ownerOf(key, projects, loose = []) {
  const { machine, path } = splitDir(key);
  let depth = -1, who = null;
  const consider = (k, name) => {
    const d = splitDir(k);
    if (d.machine === machine && within(path, d.path) && d.path.length > depth) { depth = d.path.length; who = name; }
  };
  for (const p of projects) for (const k of p.dirs ?? []) consider(k, p.name);
  for (const k of loose) consider(k, null);
  return who;
}

// An explicit Unsorted entry stays only while some project would take its directory.
export const tidy = (loose, projects) => loose.filter((k) => ownerOf(k, projects, []) !== null);

const without = (projects, key) => projects.map((p) => ({ ...p, dirs: (p.dirs ?? []).filter((d) => d !== key) }));

// A directory moved into a project, or back to Unsorted (to: null).
export function moveDir(state, key, to) {
  const projects = without(state.projects, key);
  const loose = (state.loose ?? []).filter((d) => d !== key);
  const target = to ? projects.find((p) => p.name === to) : null;
  if (target) target.dirs.push(key);
  else if (ownerOf(key, projects, loose) !== null) loose.push(key); // a parent would still take it
  return { projects, loose: tidy(loose, projects) };
}

// A new project, empty or with this directory. An existing name gets the directory instead.
export function addProject(state, name, key = null) {
  if (state.projects.some((p) => p.name === name)) return key ? moveDir(state, key, name) : state;
  const projects = [...(key ? without(state.projects, key) : state.projects), { name, dirs: key ? [key] : [] }];
  return { projects, loose: tidy((state.loose ?? []).filter((d) => d !== key), projects) };
}

// A project deleted: all its directories go back to Unsorted.
export function deleteProject(state, name) {
  const projects = state.projects.filter((p) => p.name !== name);
  return { projects, loose: tidy(state.loose ?? [], projects) };
}

// A project renamed; its directories stay. An empty or taken name changes nothing.
export function renameProject(state, from, to) {
  const has = (n) => state.projects.some((p) => p.name === n);
  if (!to || to === from || !has(from) || has(to)) return state;
  return { ...state, projects: state.projects.map((p) => (p.name === from ? { ...p, name: to } : p)) };
}

// A name renamed in what's kept by name: a list (the dragged order) or a {name: value}
// store (the icons). A stale entry under the new name, left by a deleted project, gives way.
export function renameIn(kept, from, to) {
  if (Array.isArray(kept)) return kept.filter((n) => n !== to).map((n) => (n === from ? to : n));
  if (!kept || !(from in kept)) return kept;
  const { [from]: value, [to]: _stale, ...rest } = kept;
  return { ...rest, [to]: value };
}

// The projects in the order the person dragged them into; the rest after them, by name.
export function ordered(names, order) {
  const at = new Map((order ?? []).map((n, i) => [n, i]));
  const pos = (n) => (at.has(n) ? at.get(n) : Infinity);
  return [...names].sort((a, b) => pos(a) - pos(b) || byName(a, b)); // Infinity - Infinity is NaN: by name
}

// The order after dropping `from` on `to`: after it when it came from above, before it from below.
export function moveTo(names, from, to) {
  const i = names.indexOf(from), j = names.indexOf(to);
  if (i < 0 || j < 0 || i === j) return names;
  const list = names.filter((n) => n !== from);
  const k = list.indexOf(to);
  list.splice(i < j ? k + 1 : k, 0, from);
  return list;
}

// conversations: [{ machine, cwd, order, ... }]. A pill per directory a conversation runs
// in, plus each project's own directories that have none. Projects in the dragged order;
// Unsorted apart (null when empty).
// A group's pills in the order they were dragged into; the rest after them, by machine,
// then folder (a parent before its subfolders).
export function orderPills(pills, order = []) {
  const at = new Map(order.map((k, i) => [k, i]));
  const pos = (p) => (at.has(p.key) ? at.get(p.key) : Infinity);
  return [...pills].sort((a, b) => pos(a) - pos(b) || cmpMachine(a.machine, b.machine) || byName(a.path, b.path));
}

// A group's pill keys after `key` is put before or after the pill `at`.
export function place(keys, key, at, after) {
  const list = keys.filter((k) => k !== key);
  const i = list.indexOf(at);
  if (i < 0) return keys;
  list.splice(after ? i + 1 : i, 0, key);
  return list;
}

// The dragged pill order is one list for every group (a directory is in one group at a
// time); this gives one group's pills the order `keys`.
export function withGroup(order, keys) {
  const mine = new Set(keys);
  return [...order.filter((k) => !mine.has(k)), ...keys];
}

export function group(convs, state, { home, order = [], pills: pillOrder = [] } = {}) {
  const maps = new Map(state.projects.map((p) => [p.name, new Map()]));
  const loose = new Map();
  const add = (map, key) => { if (!map.has(key)) map.set(key, []); return map.get(key); };
  for (const p of state.projects) for (const k of p.dirs ?? []) add(maps.get(p.name), k);
  for (const c of convs) {
    const key = dirKey(c.machine, c.cwd);
    const who = ownerOf(key, state.projects, state.loose ?? []);
    add(who !== null && maps.has(who) ? maps.get(who) : loose, key).push(c);
  }
  const pills = (map) => orderPills([...map.entries()].map(([key, list]) => {
    const { machine, path } = splitDir(key);
    return {
      key, machine, path, label: machine ?? "local",
      detail: isHome(path, machine ? null : home) ? "~" : baseName(path),
      convs: [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    };
  }), pillOrder);
  const box = (map) => { const ps = pills(map); return { pills: ps, convs: ps.flatMap((p) => p.convs) }; };
  return {
    projects: ordered(state.projects.map((p) => p.name), order).map((name) => ({ name, ...box(maps.get(name)) })),
    unsorted: loose.size ? box(loose) : null,
  };
}

// The tab bar (mods/my-tabs, which keeps a copy of this file) shows one project's tabs,
// grouped by directory as the pills group conversations.

// Every tab, with its machine, its directory (its first terminal's folder, else its space's)
// and its panes, each named as the left panel names a conversation.
export function tabsOf(spaces, panes, agents) {
  const reported = new Map((agents ?? []).map((a) => [a.pane, a]));
  return (spaces ?? []).flatMap((s) => (s.tabs ?? []).map((tab) => {
    const mine = (panes ?? []).filter((p) => p.tab === tab.id);
    const first = mine.find((p) => p.terminal && p.cwd);
    const machine = s.machine ?? null;
    return {
      id: tab.id, space: s.id, spaceIndex: s.index ?? 0, index: tab.index ?? 0, machine, tab,
      key: dirKey(machine, first?.cwd || s.folder || ""),
      panes: mine.map((p) => {
        const a = reported.get(p.pane), program = a?.program ?? p.program;
        return {
          pane: p.pane, terminal: p.terminal, status: a?.status ?? p.status ?? null, program,
          // A tab of its own goes by the tab's name when it has one; a pane of a split, by itself.
          name: nameOf({ address: p.terminal ?? "", title: a?.title ?? p.title, program }, mine.length === 1 ? tab : null),
        };
      }),
    };
  }));
}

export const tabProject = (t, state) => ownerOf(t.key, state.projects, state.loose ?? []);

// One project's tabs (null: Unsorted), by directory: the groups in the left panel's pill
// order, each group's tabs in their dragged order, the rest by space, then position.
export function tabGroups(tabs, state, project, { home, pills = [], order = [] } = {}) {
  const at = new Map(order.map((id, i) => [id, i]));
  const pos = (t) => (at.has(t.id) ? at.get(t.id) : Infinity);
  const byKey = new Map();
  for (const t of tabs) {
    if (tabProject(t, state) !== project) continue;
    if (!byKey.has(t.key)) byKey.set(t.key, []);
    byKey.get(t.key).push(t);
  }
  return orderPills([...byKey.entries()].map(([key, list]) => {
    const { machine, path } = splitDir(key);
    return {
      key, machine, path, label: machine ?? "local", detail: isHome(path, machine ? null : home) ? "~" : baseName(path),
      tabs: list.sort((a, b) => pos(a) - pos(b) || a.spaceIndex - b.spaceIndex || a.index - b.index),
    };
  }), pills);
}

// Where picking a project goes: its last-used pane if it's still one of its tabs', else the
// first pane of its first tab. null: it has no tabs.
export function landing(groups, last) {
  const tabs = groups.flatMap((g) => g.tabs);
  if (last && tabs.some((t) => t.panes.some((p) => p.pane === last))) return last;
  return tabs[0]?.panes[0]?.pane ?? null;
}

// What a tab (or one pane of a split) dropped on another tab does: "merge" (its terminals join
// that tab as a split), "before" / "after" it (reordering, within a group), "deny" (another
// machine: a tab holds one machine's terminals). x: where the pointer is across the target, 0–1.
export function dropZone(src, dst, x, sameGroup) {
  if (!src || !dst || src.id === dst.id) return null;
  if ((src.machine ?? null) !== (dst.machine ?? null)) return "deny";
  if (sameGroup && x < 0.25) return "before";
  if (sameGroup && x > 0.75) return "after";
  return "merge";
}

// The order directories take the six colors in: blue, orange, green, pink, purple, teal. The
// first four are the easiest to tell apart; blue/purple and teal/green only meet in a project
// with five or more directories.
export const DIR_COLORS = ["#5b8def", "#e3814f", "#3fae6a", "#d9649a", "#8b7cf6", "#22a99a"];

// A color for each directory, given when it first joins a project and kept after (reordering
// never recolors): the first of DIR_COLORS that the project's icon and its other directories
// don't use. A kept color that clashes (a directory moved in from another project) gives way,
// for the later directory in `keys`. projects: [{ keys, icon }] (icon: the project's color, or
// null). Null when nothing changed.
export function withDirColors(store, projects) {
  const next = { ...(store ?? {}) };
  let changed = false;
  for (const { keys, icon } of projects) {
    const used = new Set(icon ? [icon] : []), fresh = [];
    for (const k of keys) {
      if (next[k] && !used.has(next[k])) used.add(next[k]);
      else fresh.push(k);
    }
    for (const k of fresh) {
      const c = DIR_COLORS.find((x) => !used.has(x)) ?? DIR_COLORS[fnv(k) % DIR_COLORS.length];
      if (next[k] !== c) { next[k] = c; changed = true; }
      used.add(c);
    }
  }
  return changed ? next : null;
}

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// The most urgent status, as Herdr ranks them.
export function urgent(statuses) {
  let best = null;
  for (const s of statuses) if ((RANK[s] ?? 0) > (RANK[best] ?? 0)) best = s;
  return best;
}

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A conversation's name, as the Agents list gives it: a tab someone named, else the
// title the agent set (Claude Code's session name), else the program.
const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
export function nameOf(a, tab) {
  const prog = a.program?.name;
  const raw = String(a.title ?? "").trim();
  const live = clean(raw);
  // A folder for a title (a shell's) says nothing: test it before clean() eats its "~/".
  const path = /^[~/]|^[A-Za-z]:\\/.test(raw);
  // A terminal that never set a title shows its address ("t1y"): no name either.
  const bare = live === String(a.address ?? "").split("/").pop();
  const telling = Boolean(live) && !path && !bare && live !== prog && !live.includes("@") && live.toLowerCase() !== a.program?.key;
  let n;
  if (tab?.named && tab.name !== prog) n = tab.name;
  else if (telling) n = live;
  else n = tab?.name ?? prog ?? a.address;
  return /^\d+$/.test(n) ? prog || n : n;
}
