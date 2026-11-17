// my-tabs: a look at a running terminal (a worker without a pane, or a child in the close
// dialog), over the window: the bar (mods/my-peek: who it is, its state, keep or go to, ✕) above
// the terminal itself. It stands in for Herdr's own terminal.peek, whose keep put the worker in
// the shown space, which Herdr refuses for another machine's terminal (the keep-worker design,
// 2026-11-17): my-peek's keep is the Agents list's, my-tabs.keep. Opened by the "peek <terminal>"
// command (mods/my-agents) and the close dialog (ask.js).
import { openOverlay } from "herdr";

export function openPeek(terminal) {
  if (!terminal) return null;
  return openOverlay({
    kind: "dialog",
    width: 0.84,
    height: 0.84,
    layout: {
      id: "peek",
      type: "column",
      children: [
        { id: "peek-bar", type: "block", size: { px: 34 }, content: { mod: "my-peek", props: { terminal } } },
        { id: "peek-terminal", type: "block", content: { terminal } },
      ],
    },
  });
}
