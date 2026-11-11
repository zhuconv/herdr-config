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
export function group(convs, state, { home, order = [] } = {}) {
  const maps = new Map(state.projects.map((p) => [p.name, new Map()]));
  const loose = new Map();
  const add = (map, key) => { if (!map.has(key)) map.set(key, []); return map.get(key); };
  for (const p of state.projects) for (const k of p.dirs ?? []) add(maps.get(p.name), k);
  for (const c of convs) {
    const key = dirKey(c.machine, c.cwd);
    const who = ownerOf(key, state.projects, state.loose ?? []);
    add(who !== null && maps.has(who) ? maps.get(who) : loose, key).push(c);
  }
  const pills = (map) => [...map.entries()].map(([key, list]) => {
    const { machine, path } = splitDir(key);
    return {
      key, machine, path, label: machine ?? "local",
      detail: isHome(path, machine ? null : home) ? "~" : baseName(path),
      convs: [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    };
  }).sort((a, b) => cmpMachine(a.machine, b.machine) || byName(a.path, b.path));
  const box = (map) => { const ps = pills(map); return { pills: ps, convs: ps.flatMap((p) => p.convs) }; };
  return {
    projects: ordered(state.projects.map((p) => p.name), order).map((name) => ({ name, ...box(maps.get(name)) })),
    unsorted: loose.size ? box(loose) : null,
  };
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
