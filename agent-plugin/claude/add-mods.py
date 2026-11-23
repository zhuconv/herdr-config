"""Has every new Claude Code session load the mods in ~/.claude/mods (short-names, accounts): adds each
one's folder to CLAUDE_CODE_PLUGIN_DIRS in the env of ~/.claude/settings.json, keeping any
folders already listed there.

install.sh runs it here, and on another machine through `hc exec --on <m> -i python3 -`.
Before changing the file it leaves a copy next to it (settings.json.bak-<time>).
"""
import json
import os
import shutil
import time

MODS = ["~/.claude/mods/short-names", "~/.claude/mods/accounts"]

path = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

env = settings.setdefault("env", {})
dirs = [d for d in str(env.get("CLAUDE_CODE_PLUGIN_DIRS", "")).split(os.pathsep) if d]
same = lambda a, b: os.path.expanduser(a).rstrip("/") == os.path.expanduser(b).rstrip("/")
added = [m for m in MODS if not any(same(m, d) for d in dirs)]

if added:
    env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(dirs + added)
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    with open(path + ".tmp", "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(path + ".tmp", path)
    print("Claude Code: new sessions load " + ", ".join(added) + " (CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json)")
