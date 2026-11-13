// my-tabs: ⌘G (keys.json: my-tabs.waiting) goes to the agent that rang last, i.e. the one
// that most recently started waiting for you: finished unseen ("done") or needs you
// ("blocked"), the two states Herdr rings for. Pressed again, it goes to the one before: the
// one it went to has focus now, so it's skipped.
// Herdr numbers each agent's state changes, from every machine, in one sequence
// (agents()[i].seq, the window's own count, kept while the window isn't drawing too): the
// highest seq among the waiting ones rang last, so nothing has to watch for it.

const WAITING = new Set(["done", "blocked"]);

// The agent to go to, or null. The focused one is skipped while you are looking at it.
// When pressed from another app (Raycast's "waiting away"), it may be the one that rang.
export function pickWaiting(list, skipFocused = true) {
  let best = null;
  for (const a of list ?? []) {
    if (WAITING.has(a.status) && !(skipFocused && a.focused) && (!best || a.seq > best.seq)) best = a;
  }
  return best;
}
