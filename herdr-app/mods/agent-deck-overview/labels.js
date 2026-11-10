// agent-deck: terminal labels (`hc label t7 role=reviewer`) on the Overview: which to show
// as chips, and the task filter. Editing lives in the agent-deck-labels mod (edit.js there).
// No imports, so node can test it (labels.test.mjs).

// Herdr's own labels: never shown as chips. Same rule as agent-deck-labels/edit.js
// (a mod can't import another mod's files).
const reserved = (k) => k === "where" || k.startsWith("herdr.");

// The labels a person or an agent set, as [key, value] pairs sorted by key.
export function customLabels(labels) {
  return Object.entries(labels ?? {})
    .filter(([k, v]) => v !== "" && !reserved(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// --- the task filter -----------------------------------------------------------------

// Filter value meaning "terminals without a task"; null means no filter.
export const NO_TASK = "\u0000none";

export const taskOf = (labels) => (labels?.task ? labels.task : null);

export function taskMatches(labels, filter) {
  if (filter === null || filter === undefined) return true;
  return filter === NO_TASK ? taskOf(labels) === null : taskOf(labels) === filter;
}

// Each task with how many terminals carry it (most first, then by name), and how many have none.
export function taskCounts(terminals) {
  const n = new Map();
  let none = 0;
  for (const x of terminals) {
    const t = taskOf(x?.labels);
    if (t === null) none++;
    else n.set(t, (n.get(t) ?? 0) + 1);
  }
  return { tasks: [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), none };
}

// The task filter as stored in localStorage (JSON: null, NO_TASK or the task), and back.
// Anything unreadable comes back as null: all tasks.
export const saveTaskFilter = (filter) => JSON.stringify(filter ?? null);
export function loadTaskFilter(stored) {
  try {
    const v = JSON.parse(stored);
    return typeof v === "string" && v !== "" ? v : null;
  } catch {
    return null;
  }
}
