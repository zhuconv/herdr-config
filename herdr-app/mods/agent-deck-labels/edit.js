// agent-deck: editing a terminal's labels (`hc label t7 role=reviewer`): the starting rows,
// what to suggest while typing, and what to send to `hc label`.
// No imports, so node can test it (edit.test.mjs).

// Herdr's own labels: never edited here. Same rule as agent-deck-overview/labels.js
// (a mod can't import another mod's files).
const reserved = (k) => k === "where" || k.startsWith("herdr.");

// The labels a person or an agent set, as [key, value] pairs sorted by key.
export function customLabels(labels) {
  return Object.entries(labels ?? {})
    .filter(([k, v]) => v !== "" && !reserved(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const strings = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim() !== "") : []);

// Every value of `key` worth offering: the cache first (most recent first), then the
// values live terminals carry that the cache lacks, sorted.
export function knownValues(terminals, key, cache) {
  const cached = [...new Set(strings(cache))];
  const seen = new Set(cached);
  const live = [...new Set(terminals.map((x) => x?.labels?.[key]).filter((v) => typeof v === "string" && v !== "" && !seen.has(v)))].sort();
  return [...cached, ...live];
}

// The cache with `value` moved to the front, at most `max` long.
export function remember(cache, value, max = 50) {
  const v = (value ?? "").trim();
  const list = strings(cache);
  return v ? [v, ...list.filter((x) => x !== v)].slice(0, max) : list;
}

// Values containing what was typed (any case), those starting with it first, never the
// value already typed. Nothing typed: the first `limit`.
export function suggest(values, typed, limit = 8) {
  const q = (typed ?? "").trim().toLowerCase();
  if (!q) return values.slice(0, limit);
  const hits = values.filter((v) => v.toLowerCase().includes(q) && v.toLowerCase() !== q);
  return [...hits.filter((v) => v.toLowerCase().startsWith(q)), ...hits.filter((v) => !v.toLowerCase().startsWith(q))].slice(0, limit);
}

// The `hc label <t>` arguments that turn `before` into the edited rows ([key, value]):
// `k=v` to set, `k=` to remove a label that was there and is now cleared or gone.
// Herdr's own labels are never touched. Throws on a key hc would read differently.
export function labelArgs(before, rows) {
  const had = new Map(customLabels(before));
  const want = new Map();
  for (const [rawK, rawV] of rows) {
    const k = (rawK ?? "").trim();
    if (!k || reserved(k)) continue;
    if (/[=\s]/.test(k) || k.startsWith("-")) throw new Error(`bad key "${k}": no spaces or =, and no - at the start`);
    want.set(k, (rawV ?? "").trim());
  }
  const out = new Map();
  for (const [k, v] of want) {
    if (v === "") { if (had.has(k)) out.set(k, ""); }
    else if (had.get(k) !== v) out.set(k, v);
  }
  for (const k of had.keys()) if (!want.has(k)) out.set(k, "");
  return [...out.keys()].sort().map((k) => `${k}=${out.get(k)}`);
}
