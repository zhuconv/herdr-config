// my-tabs: ⌘G's glow, a halo in the pane's focus color around the outside of the pane it lands
// on, so you can see which pane of the tab that is. Herdr draws a pane's border inside the pane
// and has no glow, so mods/my-glow draws one in window overlays laid along the pane's edges.
// Mods aren't told where panes are. This works it out as Herdr does for the panes it hasn't drawn
// (block_bounds and shares in its window/pane_size.rs): the shown layout (layout(), with the
// person's dragged sizes) in the window, down to the block that shows tabs, then the tab's own tree
// (its machine's layout document) in that block. Herdr's layout puts each edge on a screen pixel,
// and so does this. Pure: main.js gathers the inputs and opens the overlays.

const EPS = 1.1920929e-7; // f32::EPSILON, as Herdr's sums of weights use
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const shown = (n) => (Array.isArray(n?.children) ? n.children.filter((c) => c && typeof c === "object" && !c.hidden) : []);
const isPx = (n) => typeof n?.size?.px === "number";
const weight = (n) => (isPx(n) ? 0 : num(n?.size?.weight, 1));
// [vertical, horizontal]: one number, or [vertical, horizontal].
const padding = (n) => (Array.isArray(n?.padding) ? [num(n.padding[0], 0), num(n.padding[1], 0)] : [num(n?.padding, 0), num(n?.padding, 0)]);
const lineWidth = (line) => (line && typeof line === "object" ? num(line.width, 1) : 0);

// Each child's length along a row or column: fixed ones their px (within min and max), the rest
// shares of what's left by weight, again within min and max (a share past one is set there and
// the others share the rest).
export function shares(children, available, zoom) {
  const sizes = children.map(() => 0);
  let pending = [], left = available;
  children.forEach((n, i) => {
    if (isPx(n)) {
      sizes[i] = Math.min(Math.max(n.size.px * zoom, num(n.min, 0) * zoom), num(n.max, Infinity) * zoom);
      left -= sizes[i];
    } else pending.push(i);
  });
  const sum = (ids) => ids.reduce((a, i) => a + weight(children[i]), 0);
  const totalWeight = Math.max(sum(pending), EPS), initialFree = Math.max(left, 0);
  while (pending.length) {
    const total = Math.max(sum(pending), EPS);
    const free = Math.min(Math.max(left, 0), initialFree * (total / totalWeight));
    const violations = pending.map((i) => {
      const n = children[i], share = (free * weight(n)) / total;
      sizes[i] = Math.max(Math.min(share, num(n.max, Infinity) * zoom), num(n.min, 0) * zoom);
      return [i, sizes[i] - share];
    });
    const totalViolation = violations.reduce((a, [, v]) => a + v, 0);
    if (totalViolation === 0) break;
    for (const [i, v] of violations) {
      if ((totalViolation > 0 && v <= 0) || (totalViolation < 0 && v >= 0)) continue;
      left -= sizes[i];
      pending = pending.filter((j) => j !== i);
    }
  }
  return sizes;
}

// Where block `target` is when `n` is laid out in box `b`, inside the block's own border; null if
// it isn't shown there. `frame`: the pane frame inside a tab (its gap is the splits' gap), else
// null. `focused`: the ids on the way to the focused block (their focus look's border counts).
export function blockBounds(n, b, target, frame, focused, zoom) {
  if (!n || typeof n !== "object" || n.hidden) return null;
  const border = lineWidth((focused.has(n.id) && n.focus?.border) || n.border) * zoom;
  let x = b.x + border, y = b.y + border;
  if (n.type === "block" || n.content) {
    return n.id === target ? { x, y, w: Math.max(b.w - 2 * border, 0), h: Math.max(b.h - 2 * border, 0) } : null;
  }
  const [py, px] = padding(n);
  x += px * zoom;
  y += py * zoom;
  const w = Math.max(b.w - 2 * (px * zoom + border), 0), h = Math.max(b.h - 2 * (py * zoom + border), 0);
  if (n.type === "row" || n.type === "column") {
    const row = n.type === "row", kids = shown(n);
    const gap = num(n.gap, frame ? num(frame.gap, 0) : 0);
    const sep = (gap + (n.divider ? lineWidth(n.divider) : 0)) * zoom;
    const spans = shares(kids, (row ? w : h) - sep * Math.max(kids.length - 1, 0), zoom);
    for (let i = 0; i < kids.length; i++) {
      const got = blockBounds(kids[i], row ? { x, y, w: spans[i], h } : { x, y, w, h: spans[i] }, target, frame, focused, zoom);
      if (got) return got;
      if (row) x += spans[i] + sep;
      else y += spans[i] + sep;
    }
    return null;
  }
  if (n.type === "stack") {
    const header = n.header && typeof n.header === "object" ? n.header : null;
    const tall = header ? num(header.height, 30) * zoom : 0;
    if (header && header.position !== "bottom") y += tall;
    const kids = shown(n), child = kids.find((c) => c.id === n.active) ?? kids[0];
    return blockBounds(child, { x, y, w, h: Math.max(h - tall, 0) }, target, frame, focused, zoom);
  }
  return null;
}

// The ids from `n` down to `id` (both in), or null.
function pathTo(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return [id];
  for (const c of Array.isArray(n.children) ? n.children : []) {
    const p = pathTo(c, id);
    if (p) return [n.id, ...p];
  }
  return null;
}

// The shown block that shows tabs (content { tab }), as Herdr finds it: hidden nodes and a stack's
// other children don't count.
function contextOf(n) {
  if (!n || typeof n !== "object" || n.hidden) return null;
  if (n.content) return n.content.tab ? n : null;
  if (n.type === "stack") {
    const kids = shown(n);
    return contextOf(kids.find((c) => c.id === n.active) ?? kids[0]);
  }
  for (const c of shown(n)) {
    const got = contextOf(c);
    if (got) return got;
  }
  return null;
}

// Where a pane of the shown tab is on screen, in window px, and its frame (null: unframed).
// `layout`: layout(); `root`: the tree the tab shows, from its machine's layout document (ids
// without the machine); `pane`: the pane's id there; `panes`: how many panes the tab has (its frame
// needs two, or `lone`); `scale`: screen pixels per px. Null when it can't be placed.
export function paneBox({ layout, root, pane, panes, viewport, zoom, scale = 2 }) {
  if (!(zoom > 0) || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
  const context = contextOf(layout);
  if (!context) return null;
  const area = blockBounds(layout, { x: 0, y: 0, w: viewport.width, h: viewport.height }, context.id, null,
    new Set(pathTo(layout, context.id) ?? []), zoom);
  if (!area) return null;
  const [py, px] = padding(context);
  const tab = { x: area.x + px * zoom, y: area.y + py * zoom, w: Math.max(area.w - 2 * px * zoom, 0), h: Math.max(area.h - 2 * py * zoom, 0) };
  const spec = context.content.pane && typeof context.content.pane === "object" ? context.content.pane : null;
  const frame = spec && (spec.lone || panes > 1) ? spec : null;
  const path = pathTo(root, pane);
  const box = path && blockBounds(root, tab, pane, frame, new Set(path), zoom);
  if (!box || box.w < 1 || box.h < 1) return null;
  // Edges land on screen pixels, each on its own (Taffy rounds positions, not sizes).
  const r = (v) => Math.round(v * scale) / scale;
  const x = r(box.x), y = r(box.y);
  return { x, y, w: r(box.x + box.w) - x, h: r(box.y + box.h) - y, frame };
}

// The halo: `size` px wide outside the box, starting `bias` px inside it, over the pane's own
// border (the same color), so an edge off by a screen pixel leaves no dark seam. Rings, each from
// that inner edge out to its own reach, every one a share of the color: where several overlap the
// color builds up, so the halo is strongest at the border and fades out, `peak` at its strongest.
// Each ring: its box (window px), corner radius, border width and alpha.
export function rings(box, { size, radius, bias = 0.5, step = 0.5, peak = 0.9, falloff = 1.6 }) {
  const n = Math.max(1, Math.round(size / step));
  const reach = (k) => (size * k) / n;
  // The halo's alpha at the middle of each band between two reaches, and 0 past the last.
  const want = (j) => (j >= n ? 0 : peak * Math.pow(1 - (j + 0.5) / n, falloff));
  const out = [];
  for (let k = 1; k <= n; k++) {
    // A band is covered by every ring that reaches past it: ring k makes up what band k-1
    // needs on top of the bands beyond.
    const alpha = 1 - (1 - want(k - 1)) / (1 - want(k));
    const e = reach(k);
    out.push({ x: box.x - e, y: box.y - e, w: box.w + 2 * e, h: box.h + 2 * e, radius: radius + e, width: e + bias, alpha });
  }
  return out;
}

// Herdr keeps a window overlay's top left at least this far from the window's right and bottom.
const KEEP = 48;

// The overlays the halo is drawn in: a strip along each side, the top and bottom ones across the
// corners (`corner` px into the box, where the rounded halo turns), the sides between them. A
// window overlay takes the pointer where it lies, so they stay off the pane's middle. Near the
// window's right or bottom edge one starts further in, as Herdr would move it there, and the sides
// stop where the bottom one starts: where two overlap, the halo would be drawn twice, brighter.
export function strips(box, { size, corner, bias = 0.5, viewport }) {
  const g = size, c = Math.min(corner, box.h / 2);
  const place = (s) => {
    const x = Math.min(s.x, viewport.width - KEEP), y = Math.max(0, Math.min(s.y, viewport.height - KEEP));
    return { x, y, w: s.w + (s.x - x), h: s.h + (s.y - y) };
  };
  const top = place({ x: box.x - g, y: box.y - g, w: box.w + 2 * g, h: g + c });
  const bottom = place({ x: box.x - g, y: box.y + box.h - c, w: box.w + 2 * g, h: g + c });
  const y0 = top.y + top.h, y1 = bottom.y;
  const sides = [
    place({ x: box.x - g, y: y0, w: g + bias, h: y1 - y0 }),
    place({ x: box.x + box.w - bias, y: y0, w: g + bias, h: y1 - y0 }),
  ];
  return [top, bottom, ...sides].filter((s) => s.w >= 1 && s.h >= 1);
}
