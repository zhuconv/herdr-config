// my-tabs: Herdr's update pill and herdr-update-check (herdr-config update-check.py) together.
// When Herdr has an update ready (updates(): app.ready, core.ready), the check runs by itself in
// the background and a notification says what it found, beside Herdr's own pill: fine to
// restart, something to look at first, or don't restart yet. After the restart into the new
// version, or onto a new herdr-core, it runs again (--after): does every mod load, are the
// machines fine. A click on the notification opens the whole report in a dialog (updateview.js;
// reportRows here reads it). Pure: main.js looks at updates() every CHECK_EVERY ms (each call
// reads Herdr's update notes from disk, so not in render) and runs the check.

export const CHECK_EVERY = 60000;
// A notification about something to look at stays until it's clicked, or this long.
const LONG = 600000;

/** What's waiting for Herdr's Restart, as a key ("app 0.1.18 core 0.1.23"), or null. */
export function readyKey(u) {
  const app = u?.app?.ready, core = u?.core?.ready;
  return app || core ? `app ${app ?? "-"} core ${core ?? "-"}` : null;
}

/** What's installed ("0.1.18 0.1.23": app, core), or null while the core is unknown or updating. */
export function installedKey(u) {
  const app = u?.app?.version, core = u?.core?.version;
  return app && core && !u.core.updating ? `${app} ${core}` : null;
}

/** What a run is about, for its title: "Herdr 0.1.18", or "herdr-core 0.1.23" when only the core
 *  changes. `before`: the installed key before the restart. */
export function about(mode, u, before = null) {
  if (mode === "before") return u?.app?.ready || !u?.core?.ready ? `Herdr ${u?.app?.ready ?? u?.app?.version}` : `herdr-core ${u.core.ready}`;
  const [app, core] = String(before ?? "").split(" ");
  return app && app === u?.app?.version && core !== u?.core?.version ? `herdr-core ${u.core.version}` : `Herdr ${u?.app?.version}`;
}

const LINE = /^\s+(CHECK|STOP|WARN)\s+(.*)$/;
const MARK = /^ {2}(ok|note|WARN|CHECK|STOP)\s+(.*)$/;
const FACT = /^ {2}(\S+)\s{2,}(.*)$/;

/** A saved report (herdr-update-check's output, report-*.txt) as rows to draw: when it ran
 *  ("when"), its title, the versions ("fact": label, text), each section's heading, each finding
 *  ("mark": ok, note, WARN, CHECK or STOP) and its detail lines, and the verdict. */
export function reportRows(text) {
  const rows = [];
  String(text ?? "").split("\n").forEach((line, i) => {
    let m;
    if (!line.trim()) return;
    if (i === 0 && line.startsWith("herdr-update-check")) rows.push({ kind: "when", text: line.replace(/^herdr-update-check( --after)?, /, "") });
    else if (line.startsWith("Herdr update check: ")) rows.push({ kind: "title", text: line.slice(20) });
    else if (line.startsWith("→ ")) rows.push({ kind: "verdict", text: line.slice(2) });
    else if ((m = MARK.exec(line))) rows.push({ kind: "mark", mark: m[1], text: m[2] });
    else if (/^ {5,}\S/.test(line)) rows.push({ kind: "detail", text: line.trim() });
    else if ((m = FACT.exec(line))) rows.push({ kind: "fact", label: m[1], text: m[2] });
    else if (!/^\s/.test(line)) rows.push({ kind: "heading", text: line });
    else rows.push({ kind: "detail", text: line.trim() });
  });
  return rows;
}

/** The notification for a run of the check ({ code, stdout, stderr } from exec): what notify()
 *  takes. `mode`: "before" or "after" the restart; `what`: about(). */
export function notice(mode, result, what) {
  const { code, stdout = "", stderr = "" } = result ?? {};
  if (/Nothing is waiting/.test(stdout)) return { title: "No Herdr update is waiting", level: "info", timeout: 5000 };
  const found = { CHECK: [], STOP: [], WARN: [] };
  for (const line of String(stdout).split("\n")) {
    const m = LINE.exec(line);
    if (m) found[m[1]].push(m[2].trim());
  }
  const action = { name: `my-tabs.update-report ${mode}` };
  if (code === 0) {
    return {
      title: mode === "before" ? `${what}: fine to restart` : `Now on ${what}: all good`,
      body: found.WARN[0] ?? (mode === "before" ? "Nothing in this setup is in the way. Click for the report." : "Every mod loads. Click for the report."),
      level: "success",
      timeout: found.WARN.length ? LONG : 20000,
      action,
    };
  }
  if (code === 1 || code === 2) {
    const n = found.CHECK.length + found.STOP.length;
    const things = `${n || "some"} thing${n === 1 ? "" : "s"}`;
    return {
      title: mode !== "before" ? `Now on ${what}: ${things} to look at`
        : code === 2 ? `${what}: don't restart yet` : `${what}: ${things} to look at before restarting`,
      body: found.STOP[0] ?? found.CHECK[0] ?? "Click for the report.",
      level: code === 2 ? "error" : "warning",
      timeout: LONG,
      action,
    };
  }
  const why = String(stderr).split("\n").map((l) => l.trim()).find(Boolean);
  return { title: "The update check didn't run", body: why ?? `It ended with ${code}.`, level: "warning", timeout: 60000 };
}
