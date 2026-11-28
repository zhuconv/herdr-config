"""Hooks agent-note into the Antigravity CLI (agy), twice:
- its title command, in ~/.gemini/antigravity-cli/settings.json ("title": `agent-note agy-title`),
  which makes each agy name its terminal after its conversation (the name /rename gave it, else
  the title agy made for it), so Herdr shows that name as Claude's session names: in the pane
  header, the Agents list, the tab bar, ⌃Tab and toasts. A title command you set yourself stays.
- its hooks, in ~/.gemini/config/hooks.json (a hook named herdr-agent-note on SessionStart,
  PreInvocation and Stop, as `agent-note antigravity`), for the ⌃Tab cards' notes.

install.sh runs it here, and on another machine through `hc exec --on <m> -i python3 -`. It does
nothing where agy has never run (no ~/.gemini/antigravity-cli), and nothing twice. Before changing
a file it leaves a copy next to it (<name>.bak-<time>). An agy that is running takes up the hooks
at once, the title command only when it starts again (agy 1.5.18).
"""
import json
import os
import shutil
import time

home = os.path.expanduser("~/.gemini")
cli = os.path.join(home, "antigravity-cli")
if not os.path.isdir(cli):
    raise SystemExit(0)

TITLE = {"type": "command", "command": "~/.local/bin/agent-note agy-title"}
HOOK = {"type": "command", "command": "~/.local/bin/agent-note antigravity", "timeout": 10}
EVENTS = ("SessionStart", "PreInvocation", "Stop")  # each one flat: a list of handlers


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(path, data, mode=0o600):
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(path + ".tmp", mode)
    os.replace(path + ".tmp", path)


settings_path = os.path.join(cli, "settings.json")
settings = load(settings_path)
title = settings.get("title")
if not isinstance(title, dict) or not title.get("command"):
    # agy reads true/false as {"enabled": …}: a title you switched off (/title off) stays off.
    base = title if isinstance(title, dict) else {"enabled": title} if isinstance(title, bool) else {}
    settings["title"] = {**base, **TITLE}
    save(settings_path, settings)
    if base.get("enabled") is False:
        print(f"agy: title command added to {settings_path}, but titles are off there: /title on in agy turns them on.")
    else:
        print(f"agy: its terminals take their conversation's name (title command in {settings_path}).")
elif "agent-note" not in title["command"]:
    print(f"agy: {settings_path} has a title command of its own, kept: its terminals keep that title, "
          "and Herdr shows agy sessions by it.")

hooks_path = os.path.join(home, "config", "hooks.json")
hooks = load(hooks_path)
ours = any("agent-note" in (h.get("command") or "") for spec in hooks.values() if isinstance(spec, dict)
           for e in EVENTS for h in (spec.get(e) or []) if isinstance(h, dict))
if not ours:
    hooks["herdr-agent-note"] = {e: [dict(HOOK)] for e in EVENTS}
    save(hooks_path, hooks, 0o644)
    print(f"agy: agent-note hooks added to {hooks_path} ({', '.join(EVENTS)}).")
