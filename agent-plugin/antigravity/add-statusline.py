"""Makes ~/.config/antigravity/statusline.sh (agent-plugin/antigravity/statusline.sh, which
install.sh puts there) the Antigravity CLI's status line: "statusLine" in
~/.gemini/antigravity-cli/settings.json. The rest of the file stays as it is, and so does a status
line you set to something else.

install.sh runs it. It does nothing where agy has never run (no ~/.gemini/antigravity-cli). Before
changing the file it leaves a copy next to it (settings.json.bak-<time>). A running agy keeps the
keys others write to the file; it shows the new status line once it starts again.
"""
import json
import os
import shutil
import time

cli = os.path.expanduser("~/.gemini/antigravity-cli")
if not os.path.isdir(cli):
    raise SystemExit(0)
path = os.path.join(cli, "settings.json")
LINE = {"type": "command", "command": 'bash "$HOME/.config/antigravity/statusline.sh"'}

try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

line = settings.get("statusLine")
if not line:
    mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o600
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    settings["statusLine"] = LINE
    with open(path + ".tmp", "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(path + ".tmp", mode)
    os.replace(path + ".tmp", path)
    print(f"agy: its status line is ~/.config/antigravity/statusline.sh (statusLine in {path}).")
elif "antigravity/statusline.sh" not in str(line.get("command") if isinstance(line, dict) else line):
    print(f"agy: {path} has a status line of its own, kept. To use this one, delete its statusLine "
          "and run install.sh again.")
