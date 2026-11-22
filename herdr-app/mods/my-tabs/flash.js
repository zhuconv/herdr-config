// my-tabs: ⌘G's flash. The focused pane's border, the pane frame's "focus" line in the shown
// layout, turns bright for a moment and then back, so you can see which pane of the tab ⌘G
// went to. Herdr has no command for a border's look while it runs, and layout.set rewrites the
// whole file and resets the person's clicks (the sizes they dragged). An edit to the layout file
// keeps them: Herdr reloads it and drops only the clicks on fields the edit changed
// (check_layout_file in its window.rs). So a flash is two atomic writes of the file: a bright
// copy, then the text as it was. Only the color changes: a wider border would make the terminal
// smaller, and its program would redraw for the new size.

// Dracula's cyan, the brightest of its blues, against the resting #6272a4.
export const FLASH_COLOR = "#8be9fd";

// The layout's text with every pane frame's focus line in `color` (a frame without one gets its
// border's line); null when the text isn't a layout or no frame would show it.
export function brightened(text, color) {
  let tree;
  try { tree = JSON.parse(text); } catch { return null; }
  let changed = false;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    const pane = n.content?.tab ? n.content.pane : null;
    const line = pane?.focus ?? pane?.border;
    if (line && typeof line === "object") {
      pane.focus = { ...line, color };
      changed = true;
    }
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  walk(tree);
  return changed ? JSON.stringify(tree, null, 2) + "\n" : null;
}
