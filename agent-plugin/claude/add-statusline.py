"""Makes ~/.claude/statusline.sh (agent-plugin/claude/statusline.sh, which install.sh puts there)
Claude Code's status line: "statusLine" in ~/.claude/settings.json. The rest of the file stays as
it is, and so does a status line you set to something else.

install.sh runs it. Before changing the file it leaves a copy next to it (settings.json.bak-<time>).
Sessions show the new status line when they start.
"""
import json
import os
import shutil
import time

path = os.path.expanduser("~/.claude/settings.json")
LINE = {"type": "command", "command": 'bash "$HOME/.claude/statusline.sh"'}

try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

line = settings.get("statusLine")
if not line:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    settings["statusLine"] = LINE
    with open(path + ".tmp", "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if os.path.exists(path):
        shutil.copymode(path, path + ".tmp")
    os.replace(path + ".tmp", path)
    print("Claude Code: its status line is ~/.claude/statusline.sh (statusLine in ~/.claude/settings.json).")
elif ".claude/statusline.sh" not in str(line.get("command") if isinstance(line, dict) else line):
    print("Claude Code: ~/.claude/settings.json has a status line of its own, kept. To use this one, "
          "delete its statusLine and run install.sh again.")
