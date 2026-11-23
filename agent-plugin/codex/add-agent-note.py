"""Adds the agent-note hook to Codex, in ~/.codex/hooks.json (or $CODEX_HOME's): SessionStart,
UserPromptSubmit, Stop, PermissionRequest, PostToolUse and Interrupt, once per event, as
`agent-note codex`. Codex runs it with the same input as Claude Code's hooks.

install.sh runs it here, and on another machine through `hc exec --on <m> -i python3 -`. It does
nothing where Codex has never run (no ~/.codex). Before changing a file it leaves a copy next to
it (<name>.bak-<time>).

Codex runs a hook only once you trust it, and asks at its start until you do ("Hooks need
review"), which would hold up a Codex that a relay or a manager starts. So this trusts them too,
as Codex's Trust all would: config.toml's [hooks.state."<hooks.json>:<event>:<group>:<hook>"]
trusted_hash. Codex hashes the hook's definition (not its path, nor agent-note's code); the
hashes below are what Codex 0.169 gives the definitions this writes. Where they don't match (a
changed definition, another Codex), codex-hooks-trust, which install.sh runs next, asks the
installed Codex and writes its own.
"""
import json
import os
import re
import shutil
import time

home = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
if not os.path.isdir(home):
    raise SystemExit(0)
path = os.path.join(home, "hooks.json")
try:
    with open(path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}

command = '"$HOME/.local/bin/agent-note" codex'
# event, its key in config.toml, timeout (Interrupt's hooks may take 3 seconds at most), trusted_hash
EVENTS = (
    ("SessionStart", "session_start", 15, "4ff300094e0e306c50fe7cf4b959a5fb160ea2cda1b9360dd5006210fa51af82"),
    ("UserPromptSubmit", "user_prompt_submit", 15, "1d65e481e3f997afbafa855b0ccafa6ebb7a6161740d9031745b9351c5b4d1d5"),
    ("Stop", "stop", 15, "0727aa3ce86443f90cbf895dc0cc2685503c2964f5cc374672c1a698b0da0f86"),
    ("PermissionRequest", "permission_request", 15, "3324a9025de61378f08635f60896e66ecd81ccf96ea18255b7dd3ea031eb049a"),
    ("PostToolUse", "post_tool_use", 15, "f2e03a0de9938cabaaa80f3f5e505056a6401d90d36abb063612a49a9f35f4f7"),
    ("Interrupt", "interrupt", 3, "c5e6672a9ccfbb17c73c549a171eb70137cdd2529bc8498dd619032c3a4ac92b"),
)
hooks = config.setdefault("hooks", {})
added, ours = [], []  # ours: (key in config.toml, hash) of each agent-note hook
for event, key, timeout, digest in EVENTS:
    groups = hooks.setdefault(event, [])
    at = next(((gi, hi) for gi, g in enumerate(groups) for hi, h in enumerate(g.get("hooks", []))
               if "agent-note" in (h.get("command") or "")), None)
    if at is None:
        groups.append({"hooks": [{"type": "command", "command": command, "timeout": timeout, "async": True}]})
        added.append(event)
        at = (len(groups) - 1, 0)
    ours.append((f"{os.path.abspath(path)}:{key}:{at[0]}:{at[1]}", digest))


def keep(p):
    if os.path.exists(p):
        shutil.copy2(p, f"{p}.bak-{time.strftime('%Y%m%d-%H%M%S')}")


if added:
    keep(path)
    with open(path + ".tmp", "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(path + ".tmp", path)
    print(f"Codex: agent-note hooks added to {path} (" + ", ".join(added) + ").")

# Trust them: the entries config.toml doesn't have yet, appended (TOML makes [hooks.state] itself).
toml = os.path.join(home, "config.toml")
try:
    with open(toml) as f:
        text = f.read()
except FileNotFoundError:
    text = ""
new, missing = text, []
for k, d in ours:
    head = r'^(\[hooks\.state\."' + re.escape(k) + r'"\]\ntrusted_hash = )"[^"\n]*"'
    if re.search(head, new, re.M):
        new = re.sub(head, lambda m: m.group(1) + f'"sha256:{d}"', new, flags=re.M)  # an older definition's
    elif not re.search(r'^\[hooks\.state\."' + re.escape(k) + r'"\]', new, re.M):
        missing.append((k, d))
if missing:
    new += ("" if not new or new.endswith("\n") else "\n") + "".join(
        f'\n[hooks.state."{k}"]\ntrusted_hash = "sha256:{d}"\n' for k, d in missing)
if new != text:
    keep(toml)
    with open(toml + ".tmp", "w") as f:
        f.write(new)
    os.replace(toml + ".tmp", toml)
    print(f"Codex: agent-note hooks trusted in {toml}.")
