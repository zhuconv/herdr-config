// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.
// my-menu (a clone of Herdr's menu 0.1.15; the my-main layout's "terminal_menu", and the tab
// bar's right-click): a pane of a split can move to a tab of its own ("Move to new tab": mods/
// my-tabs "split-out"), and a tab's menu starts with the items its opener passes (props.extra).
// The Agents list's worker rows open it too (tab "worker", mods/my-agents). A fourth element
// of an item is a hint for the right, in place of its key.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, shared } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : null);

// A worker's starter, as Send back names it: the nearest of its ancestors with a pane (else its
// parent), by its hc name, else its program's title, as the Agents list shows them. Null for a
// terminal no other started.
function starterName(term, all) {
  const by = new Map(all.map((t) => [t.address, t])), ps = panes(), seen = new Set();
  let first = null;
  for (let a = term?.parent; a && !seen.has(a); a = by.get(a)?.parent) {
    seen.add(a);
    const t = by.get(a), p = ps.find((x) => x.terminal === a);
    first = first ?? (t?.name || a);
    if (p) return t?.name || clean(p.title) || a;
  }
  return first;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its starter, still running (mods/my-tabs: then its
      // starter's tab shows, when its own was the one shown and goes).
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const boss = term ? starterName(term, all) : null;
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      const tab = panes().find((pane) => pane.pane === tg.pane)?.tab;
      const split = inTab && Boolean(tg.terminal) && panes().filter((pane) => pane.tab === tab).length > 1;
      return [
        ...(split ? [["Move to new tab", `my-tabs.split-out ${tg.terminal}`]] : []),
        ...(inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(boss ? [[`Send back to ${boss}`, `my-tabs.sendback ${term.address}`]] : []),
        // my-menu: through mods/my-tabs, which asks first when the terminal has running children
        // (terminals started from it with hc run, e.g. a manager agent's workers).
        ...(inTab ? [["Close pane", `my-tabs.close kill ${tg.pane}`]] : []),
      ];
    }
    case "tab":
      return [
        ...(Array.isArray(p.extra) ? p.extra : []),
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        // my-menu: as the tab's × and ⌘W do (mods/my-tabs): parked, ⌘⇧W brings it back, and
        // the bar's next tab shows, not the space's.
        ["Close", `my-tabs.close ${tg.id}`],
      ];
    case "worker": {
      // A worker row in the Agents list (an agent's hc child). Kept as a tab: go there, or send it
      // back under its starter. Else: keep it as a tab on its own machine (named on the right),
      // or peek at it. Through mods/my-tabs, as the row's own click and keep button.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      if (!term) return [];
      const boss = starterName(term, all);
      return panes().some((p) => p.terminal === term.address)
        ? [["Go to tab", "pane.focus", { terminal: term.address }], ...(boss ? [[`Send back to ${boss}`, `my-tabs.sendback ${term.address}`]] : [])]
        : [["Keep as tab", `my-tabs.keep ${term.address}`, undefined, machineOf(term.address) ?? (shared("my-projects.local") || "local")], ["Peek", `my-tabs.peek ${term.address}`]];
    }
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        // my-menu: through mods/my-tabs, as Close pane above.
        ["Close", `my-tabs.close space ${tg.id}`],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  if (command.startsWith("my-tabs.split-out") || command.startsWith("my-tabs.keep") || command === "pane.focus") return "mods/my-menu/pop-out.svg";
  if (command.startsWith("my-tabs.sendback")) return "mods/my-menu/undo-2.svg";
  if (command.startsWith("my-tabs.peek")) return "mods/my-menu/eye.svg";
  const name = /\.close( |$)/.test(command) ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (/\.close( |$)/.test(it[1]) || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")
              || (list[i - 1][1].startsWith("my-tabs.split-out") && !it[1].startsWith("my-tabs.split-out"))
              || (list[i - 1][1].startsWith("my-tabs.sendback") && !it[1].startsWith("my-tabs.sendback"))), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(it[3] ?? shortcut(it[1], it[2])))),
        ),
      );
  }
}
