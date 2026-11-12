#!/usr/bin/env python3
"""Builds docs/index.html, the public clickable mock, from the design canvas's Main.dc.html.

    python3 docs/make-demo.py path/to/Main.dc.html

The canvas file plays here as it is (docs/support.js stands in for the canvas's runtime). This
swaps its project, folder and session names for sample ones, gives the page an English title,
and adds a small card saying what to try (hidden with ?clean, as for the README screenshot).
Every swap must match exactly once, so a changed canvas fails loudly instead of leaking a name.
"""
import pathlib
import sys

SWAPS = [
    ('<html lang="zh">', '<html lang="en">'),
    ("<title>Herdr · tab 按目录分组</title>", "<title>herdr-config · a clickable mock</title>"),
    # Sessions.
    ("name: 'hc-core',", "name: 'tab-bar',"),
    ("name: 'herdr-feats',", "name: 'left-panel',"),
    ("name: 'harbor-adapter',", "name: 'auth-refactor',"),
    ("name: 'relbench-viewer',", "name: 'ui-polish',"),
    ("name: 'viewer-ui',", "name: 'dark-mode',"),
    ("name: 'SchemaLoop',", "name: 'load-test',"),
    ("name: 'dbt-bench',", "name: 'train-sweep',"),
    ("name: 'alpha-writing',", "name: 'draft-intro',"),
    # Folders.
    ("path: '~/PyProjects/herdr', base: 'herdr',", "path: '~/code/herdr-config', base: 'herdr-config',"),
    ("path: '~/PyProjects/SchemaRouterRepos/relbench-harbor-adapter', base: 'relbench-harbor-adapter',",
     "path: '~/code/web-app/api', base: 'api',"),
    ("path: '~/PyProjects/SchemaRouterRepos/relbench-viewer', base: 'relbench-viewer',",
     "path: '~/code/web-app/frontend', base: 'frontend',"),
    ("path: '~/SchemaLoop', base: 'SchemaLoop',", "path: '~/load-tests', base: 'load-tests',"),
    ("path: '~/PyProjects/alpha-dir', base: 'alpha-dir',", "path: '~/writing/paper', base: 'paper',"),
    # Projects.
    ("name: 'relbench-adapter',", "name: 'web-app',"),
    ("{ id: 'dbt', name: 'dbt',", "{ id: 'dbt', name: 'ml-research',"),
    ("{ id: 'alpha', name: 'alpha',", "{ id: 'alpha', name: 'paper',"),
    # What New directory… finds on each machine.
    ("'~/': ['.claude', 'Desktop', 'Documents', 'Downloads', 'PyProjects'], '~/PyProjects/': ['SchemaRouterRepos', 'alpha-dir', 'herdr', 'hub-stats'], '~/PyProjects/SchemaRouterRepos/': ['relbench-harbor-adapter', 'relbench-viewer']",
     "'~/': ['.claude', 'Desktop', 'Documents', 'Downloads', 'code', 'writing'], '~/code/': ['herdr-config', 'web-app'], '~/code/web-app/': ['api', 'frontend'], '~/writing/': ['paper']"),
    ("'~/': ['.cache', 'SchemaRouter', 'schemaloop-test']", "'~/': ['.cache', 'datasets', 'load-tests']"),
    ("'~/': ['.cache', 'SchemaLoop'], '~/SchemaLoop/': ['configs', 'runs']", "'~/': ['.cache', 'load-tests'], '~/load-tests/': ['configs', 'runs']"),
    ("'~/': ['.cache', 'claude-relay', 'dbt']", "'~/': ['.cache', 'experiments', 'train']"),
]

# Internal ids that still read like a name: renamed wherever they appear.
IDS = [("'r-harbor'", "'r-api'")]

HINT = """<aside id="demo-hint" aria-label="About this page" style="position: fixed; right: 16px; bottom: 16px; z-index: 50; width: 310px; max-width: calc(100% - 32px); box-sizing: border-box; padding: 14px 16px; border-radius: 12px; border: 1px solid #373841; background: #23252f; box-shadow: 0 12px 36px rgba(0,0,0,0.45); color: #eeeeef; font: 13px/1.45 Inter, -apple-system, sans-serif">
<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px">
<strong style="flex: 1; font-size: 13.5px">A clickable mock of <a href="https://github.com/zhuconv/herdr-config" style="color: #8be9fd">herdr-config</a></strong>
<button id="demo-hint-close" aria-label="Close" style="width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #9fa0a5; font-size: 16px">×</button>
</div>
<ul style="margin: 0; padding-left: 18px; color: #c9cace">
<li>Drag a tab onto another to split them (hold ⌥ to stack). Drag a name out of a split tab to undo it.</li>
<li>Click a project's <b>+</b>, pick a5k, type <code>/mn</code>, press Tab.</li>
<li>Click a project's row to fold it. Click in the left panel, then press ⌥1–⌥4.</li>
<li>Right-click a tab, a pane or a project.</li>
</ul>
<div style="margin-top: 8px; font-size: 12px; color: #8b8c93">Sample names; nothing here runs anything.</div>
</aside>
<script>
(function () {
  var hint = document.getElementById("demo-hint");
  if (/[?&]clean\\b/.test(location.search)) { hint.remove(); return; }
  document.getElementById("demo-hint-close").onclick = function () { hint.remove(); };
})();
</script>
</body>"""


def main():
    src = pathlib.Path(sys.argv[1]).read_text()
    for old, new in SWAPS:
        n = src.count(old)
        if n != 1:
            sys.exit(f"expected one {old[:60]!r}, found {n}: the canvas changed, update SWAPS")
        src = src.replace(old, new)
    for old, new in IDS:
        if old not in src:
            sys.exit(f"expected {old!r}: the canvas changed, update IDS")
        src = src.replace(old, new)
    if src.count("</body>") != 1:
        sys.exit("expected one </body>")
    src = src.replace("</body>", HINT)
    out = pathlib.Path(__file__).resolve().parent / "index.html"
    out.write_text(src)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
