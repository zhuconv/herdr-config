// my-projects: Herdr's window title, for time trackers. ActivityWatch's window watcher records
// the title of the window in front (so do the Window menu, Mission Control and share pickers
// show it), so naming the focused conversation there lets it count time by project:
//
//   Herdr — <project> · <conversation> · <program>      Herdr — paper · fix-figures · Claude Code
//
// The project is the one this panel files the conversation under (main.js conversations: its
// folder, or its starter's for a kept worker); a directory no project holds is Unsorted, as in
// the panel. A pane with no agent (a shell, an editor, a mod) has no conversation:
// "Herdr — paper · zsh", in the project of its tab, as the tab bar files tabs. A conversation
// named only after its program leaves that part out too. Nothing in focus: null, which Herdr
// shows as "Herdr". Nothing here needs Herdr, so node can test it (tests/window-title.test.mjs).

import { ownerOf, dirKey, nameOf } from "./model.js";

// The panel's label for the directories no project holds (main.js render).
const UNSORTED = "Unsorted";

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The title from its parts; an empty part is left out, and so is a conversation that is only
// its program's name. Null when there is nothing to say.
export function titleOf(project, conversation, program) {
  const prog = one(program), conv = one(conversation);
  const parts = [one(project), conv && conv !== prog ? conv : "", prog].filter(Boolean);
  return parts.length ? `Herdr — ${parts.join(" · ")}` : null;
}

// focus: focused(). convs: main.js conversations(), the agents as the panel files them. panes,
// terminals: panes(), terminals(). tabs: tabsOf(…) as main.js remember() makes it, or a function
// that makes it (only a pane with no agent needs it). state: { projects, loose }.
export function windowTitle(focus, { convs = [], panes = [], terminals = [], tabs = [], state } = {}) {
  if (!focus) return null;
  const projects = state?.projects ?? [], loose = state?.loose ?? [];
  // A directory's project, as the panel files it.
  const where = (key) => ownerOf(key, projects, loose) ?? UNSORTED;
  const projectOfConv = (c) => where(dirKey(c.machine, c.cwd));
  let tabList = null;
  // A pane with no agent files as its tab does in the tab bar (model.js tabsOf: its first
  // agent's folder, else its first terminal's, else its space's).
  const projectOfPane = (p) => {
    tabList ??= typeof tabs === "function" ? tabs() : tabs;
    const t = (tabList ?? []).find((x) => x.id === p.tab);
    const address = p.terminal ?? "";
    return where(t?.key ?? dirKey(address.includes("/") ? address.split("/")[0] : null, p.cwd ?? ""));
  };
  const plain = (p) => titleOf(projectOfPane(p), "", p.terminal ? p.program?.name ?? p.title : p.name ?? p.title);

  if (focus.pane) {
    const c = convs.find((x) => x.pane === focus.pane);
    if (c) return titleOf(projectOfConv(c), c.name, c.program?.name);
    const p = panes.find((x) => x.pane === focus.pane);
    if (p) return plain(p);
  }
  // A terminal with the keyboard but not in a pane of the tab (a peek, a terminal block): its
  // own pane's, if it has one somewhere.
  const address = focus.terminal;
  if (!address) return null;
  const c = convs.find((x) => x.address === address);
  if (c) return titleOf(projectOfConv(c), c.name, c.program?.name);
  const p = panes.find((x) => x.terminal === address);
  if (p) return plain(p);
  // No pane at all (a worker you peek at): the project of the nearest terminal up its hc parents
  // that has one (its manager's), as a kept worker files with its starter; else its own folder.
  const rec = new Map(terminals.map((t) => [t.address, t]));
  const me = rec.get(address);
  const name = nameOf({ address, title: me?.title ?? "", program: me?.program }, null);
  const seen = new Set([address]);
  for (let a = me?.parent; a && !seen.has(a); a = rec.get(a)?.parent) {
    seen.add(a);
    const up = convs.find((x) => x.address === a);
    if (up) return titleOf(projectOfConv(up), name, me?.program?.name);
    const upPane = panes.find((x) => x.terminal === a);
    if (upPane) return titleOf(projectOfPane(upPane), name, me?.program?.name);
  }
  const machine = address.includes("/") ? address.split("/")[0] : null;
  return titleOf(where(dirKey(machine, focus.cwd ?? me?.cwd ?? "")), name, me?.program?.name);
}
