// my-tabs: what closing does to a terminal's hc children. A worker is a terminal whose hc
// parent still runs (terminals()[].parent, named as `address` is): an agent's worker, shown
// in a tab after a keep. Closing its tab or pane doesn't end it: it goes back under its
// parent, still running, as Send back does (main.js closeTab, reopen.js). Closing a manager
// asks first (ask.js), and its "End all" ends everything running under it too.
// No imports: reopen.js and the node tests use it as well.

// Of `addrs`, the workers.
export function workersOf(all, addrs) {
  const by = new Map((all ?? []).map((t) => [t.address, t]));
  return new Set((addrs ?? []).filter((a) => by.get(by.get(a)?.parent)?.state === "live"));
}

// Every live terminal under `addrs`: their children, those children's, and so on, deepest
// first, so that each ends before its parent.
export function descendants(all, addrs) {
  const seen = new Set(addrs), levels = [];
  for (let level = [...seen]; level.length; ) {
    const at = new Set(level);
    const next = (all ?? []).filter((t) => t.state === "live" && at.has(t.parent) && !seen.has(t.address));
    for (const t of next) seen.add(t.address);
    if (next.length) levels.push(next);
    level = next.map((t) => t.address);
  }
  return levels.reverse().flat();
}

// Ends each of `list` (descendants()) through hc, one after another, and names the ones that
// couldn't be ended (their machine not connected) in a warning. hc, notify: herdr's; verb: the
// warning's word for it, as the button that asked said it ("end", or "kill" for Kill).
export async function endEach(list, hc, notify, verb = "end") {
  const failed = [];
  for (const t of list) {
    const r = await hc(["kill", t.address]).catch(() => null);
    if (r?.code !== 0) failed.push(t);
  }
  if (failed.length) notify({
    title: `Couldn't ${verb} ${failed.length === 1 ? "a worker" : `${failed.length} workers`}`,
    body: failed.map((t) => (t.name ? `${t.name} (${t.address})` : t.address)).join("\n"),
    level: "warning", timeout: 12000,
  });
  return failed;
}
