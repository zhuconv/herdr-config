// Merging tabs by rewriting a machine's layout document, in one step.
//
// Herdr keeps each machine's spaces, tabs and splits in that machine's core, as the document
// "herdr-app": { spaces: [{ id, name, folder, tabs: [{ id, name, root }] }] }. A tab's root is
// { type: "row", id: <the tab's id>, children }; a node is a pane, { type: "block", id: "p…",
// content: { terminal } or { mod, props }, size?: { weight } }, or a split, { type: "row" |
// "column", id: "s…", children, size? }. Ids are the machine's own (no "machine/" prefix).
//
// Herdr's commands can only give a terminal a pane beside the focused one, so joining a tab
// that isn't shown meant showing it first, alone, and the split came a moment later. Written
// here, the panes move in one write and the screen goes straight to the result. The document
// isn't a documented interface: anything unexpected returns null, and main.js falls back to
// the commands. Pure; main.js reads and writes the document (doc.get / doc.set).

export const localId = (id) => String(id ?? "").split("/").pop();

const isNode = (n) => Boolean(n) && typeof n === "object" && typeof n.id === "string" && (n.type === "block"
  ? Boolean(n.content) && typeof n.content === "object"
  : (n.type === "row" || n.type === "column") && Array.isArray(n.children) && n.children.length > 0 && n.children.every(isNode));
const isTab = (t) => Boolean(t) && typeof t.id === "string" && t.root?.type === "row" && t.root.id === t.id
  && Array.isArray(t.root.children) && t.root.children.length > 0 && t.root.children.every(isNode);

function findTab(doc, id) {
  for (const space of Array.isArray(doc?.spaces) ? doc.spaces : []) {
    for (const tab of Array.isArray(space?.tabs) ? space.tabs : []) if (tab?.id === id) return { space, tab };
  }
  return null;
}

// Each terminal shown in a tree.
function terminalsIn(node, out = []) {
  if (node.type === "block") { if (typeof node.content.terminal === "string") out.push(node.content.terminal); }
  else for (const c of node.children) terminalsIn(c, out);
  return out;
}

// The children's shares, summing to 1 (a missing weight counts as an even share).
function shares(kids) {
  const given = kids.map((k) => Number(k.size?.weight)).map((w) => (w > 0 ? w : null));
  const known = given.filter((w) => w !== null);
  const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const ws = given.map((w) => w ?? fill), sum = ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => w / sum);
}
function setShares(kids, ws) {
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  kids.forEach((k, i) => { k.size = { ...(k.size ?? {}), weight: ws[i] / sum }; });
}

// Takes the block showing `terminal` out of a tree and closes up: the rest of its split keep
// their proportions, and a split left with one child gives way to it (in the split's place and
// size). Returns the block, or null.
function takeBlock(node, terminal) {
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i];
    if (c.type === "block") {
      if (c.content.terminal !== terminal) continue;
      const ws = shares(node.children);
      node.children.splice(i, 1);
      ws.splice(i, 1);
      if (node.children.length) setShares(node.children, ws);
      delete c.size;
      return c;
    }
    const got = takeBlock(c, terminal);
    if (!got) continue;
    if (c.children.length === 1) {
      const only = c.children[0];
      if (c.size) only.size = c.size; else delete only.size;
      node.children[i] = only;
    }
    return got;
  }
  return null;
}

// The first pane, left to right and top to bottom, with the split holding it.
function firstBlock(node) {
  const c = node.children[0];
  return c.type === "block" ? { block: c, parent: node } : firstBlock(c);
}

// A new split's id, shaped like Herdr's own ("s" and 32 hex digits).
const randomId = () => "s" + Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// `moving` (nodes, as they came out of their tab) joins `root`'s children: "right" adds them at
// the right end, each an even share (the others keep their proportions); "down" puts them,
// side by side, under the tab's first pane.
function join(root, moving, mode, newId) {
  if (mode === "down") {
    const { block, parent } = firstBlock(root);
    const unit = moving.length === 1 ? moving[0] : { type: "row", id: newId(), children: moving };
    if (moving.length > 1) setShares(moving, shares(moving));
    if (parent.type === "column") {
      const ws = shares(parent.children), i = parent.children.indexOf(block);
      parent.children.splice(i + 1, 0, unit);
      ws.splice(i + 1, 0, ws[i] / 2);
      ws[i] /= 2;
      setShares(parent.children, ws);
    } else {
      const col = { type: "column", id: newId(), children: [block, unit] };
      if (block.size) col.size = block.size;
      delete block.size;
      setShares(col.children, [1, 1]);
      parent.children[parent.children.indexOf(block)] = col;
    }
    return;
  }
  const n = root.children.length, k = moving.length;
  const ws = [...shares(root.children).map((w) => (w * n) / (n + k)), ...moving.map(() => 1 / (n + k))];
  root.children.push(...moving);
  setShares(root.children, ws);
}

// Moves one tab's panes (all of them, or the one showing `terminal`) into another tab.
//   src, dst: the two tabs' ids; mode: "right" or "down" (see join).
//   keep: which tab id holds the result. "dst" is the usual one. "src" is for when the tab
//     being moved is the one on screen: it keeps showing and turns into the result, taking
//     dst's name and place among the space's tabs, while whatever stays behind (the rest of a
//     split) goes to dst's id, with src's name and place. The two must share a space.
// Returns { doc, container, gone, moved: [{ terminal, space, tab }] } (container: the tab
// holding the result; gone: the tab id that went, or null; moved: each terminal now in another
// tab, for its herdr.space / herdr.tab labels), or null when this can't be done here: an
// unexpected document, a tab missing, or a space that would be left empty (Herdr's commands
// close it properly).
export function mergeLayout(value, { src, dst, terminal = null, mode = "right", keep = "dst" }, newId = randomId) {
  if (src === dst) return null;
  const doc = JSON.parse(JSON.stringify(value ?? null));
  const a = findTab(doc, src), b = findTab(doc, dst);
  if (!a || !b || !isTab(a.tab) || !isTab(b.tab)) return null;
  if (keep === "src" && a.space !== b.space) return null;
  const before = new Map();
  for (const { space, tab } of [a, b]) for (const t of terminalsIn(tab.root)) before.set(t, { space: space.id, tab: tab.id });
  // What moves, and what stays behind in src.
  let moving;
  if (terminal) {
    const blk = takeBlock(a.tab.root, terminal);
    if (!blk) return null;
    moving = [blk];
  } else {
    moving = a.tab.root.children;
    a.tab.root.children = [];
  }
  const rest = a.tab.root.children;
  const result = { ...b.tab.root, children: b.tab.root.children };
  join(result, moving, mode, newId);
  const holder = keep === "src" ? a : b, other = keep === "src" ? b : a;
  holder.tab.root.children = result.children;
  if (keep === "src") {
    const names = [a.tab.name, b.tab.name];
    a.tab.name = names[1];
    b.tab.name = names[0];
  }
  const tabs = holder.space.tabs;
  if (rest.length) {
    other.tab.root.children = rest;
    if (keep === "src") {
      const i = tabs.indexOf(a.tab), j = tabs.indexOf(b.tab);
      [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
    }
  } else if (keep === "src") {
    // src takes dst's place, and dst goes.
    const i = tabs.indexOf(a.tab);
    tabs[tabs.indexOf(b.tab)] = a.tab;
    tabs.splice(i, 1);
  } else {
    const gone = a.space.tabs;
    if (gone.length === 1) return null;
    gone.splice(gone.indexOf(a.tab), 1);
  }
  const moved = [];
  for (const { space, tab } of [a, b]) {
    if (!space.tabs.includes(tab)) continue;
    for (const t of terminalsIn(tab.root)) {
      const was = before.get(t);
      if (!was || was.tab !== tab.id || was.space !== space.id) moved.push({ terminal: t, space: space.id, tab: tab.id });
    }
  }
  return { doc, container: holder.tab.id, gone: rest.length ? null : other.tab.id, moved };
}

// The bar's dragged order (tab ids) after a merge kept in src: src takes dst's place, and dst
// (holding what stayed behind, if anything) takes src's.
export function swapOrder(order, src, dst, both) {
  const out = [];
  for (const id of order ?? []) {
    if (id === dst) out.push(src);
    else if (id === src) { if (both) out.push(dst); }
    else out.push(id);
  }
  return out;
}
