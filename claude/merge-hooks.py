"""Adds the agent-note hook (UserPromptSubmit and Stop) to ~/.claude/settings.json, once.

install.sh runs it here, and on another machine through `hc exec --on <m> -i python3 -`.
Before changing the file it leaves a copy next to it (settings.json.bak-<time>).
"""
import json
import os
import shutil
import time

path = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}

hook = {"type": "command", "command": '"$HOME/.local/bin/agent-note"', "timeout": 5, "async": True}
hooks = settings.setdefault("hooks", {})
added = []
for event in ("UserPromptSubmit", "Stop"):
    groups = hooks.setdefault(event, [])
    if not any("agent-note" in (h.get("command") or "") for g in groups for h in g.get("hooks", [])):
        groups.append({"hooks": [dict(hook)]})
        added.append(event)

if added:
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    with open(path + ".tmp", "w") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(path + ".tmp", path)
    print("Claude Code: agent-note hooks added to ~/.claude/settings.json (" + ", ".join(added) + ")")
