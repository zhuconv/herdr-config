// my-tabs: ⌘G (keys.json: my-tabs.waiting) goes to the agent that rang last, i.e. the one
// that most recently started waiting for you: finished unseen ("done") or needs you
// ("blocked"), the two states Herdr rings for. Pressed again, it goes to the one before.
// The times come from watching agents(): Herdr keeps no "rang at", and an agent's seq
// may not compare across machines.

const WAITING = new Set(["done", "blocked"]);

export class Waiting {
  constructor() {
    this.seen = new Map(); // address → { status, at }; at 0: already so when first seen
  }

  // my-tabs calls this every second, and before each pick.
  track(list, now) {
    const live = new Set();
    for (const a of list) {
      live.add(a.address);
      const prev = this.seen.get(a.address);
      if (prev?.status !== a.status) this.seen.set(a.address, { status: a.status, at: prev ? now : 0 });
    }
    for (const k of this.seen.keys()) if (!live.has(k)) this.seen.delete(k);
  }

  // The agent to go to, or null. The focused one is skipped while you are looking at it.
  // When pressed from another app (Raycast's "waiting away"), it may be the one that rang.
  pick(list, skipFocused = true) {
    const at = (a) => this.seen.get(a.address)?.at ?? 0;
    return list.filter((a) => WAITING.has(a.status) && !(skipFocused && a.focused))
      .sort((x, y) => at(y) - at(x) || y.seq - x.seq)[0] ?? null;
  }
}
