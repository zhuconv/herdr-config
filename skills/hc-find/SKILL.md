---
name: hc-find
description: "Find another of the user's Claude or Codex sessions by its name through hc, and read it: where it runs, its address, folder, transcript, screen and recent turns. Use when the user names another session to locate, read or check on, or before sending one a message."
---

# Find a session by name

The user's session names are, in practice, unique across all their machines, so a name is enough.

```sh
python3 ~/.agents/skills/hc-find/find.py <name>               # where it is
python3 ~/.agents/skills/hc-find/find.py <name> --screen [N]  # + its screen now, N lines above (default 100)
python3 ~/.agents/skills/hc-find/find.py <name> --read [N]    # + its last N turns (default 5)
```

For each session the name fits, it prints:
- its full hc address (`gpu1/t44`, the same string from any machine);
- its state, folder and session id;
- its transcript, as `machine:path`.

1. **Find it.** Pass the name as the user wrote it. It matches:
   - the name Herdr shows (a tab they named, else the agent's session title);
   - an hc name, the start of a session id, an address, or a folder's name.

   Part of a name works too. When several fit, all are listed. Pick by what the user said (machine, folder, its work), else ask which. Done when you have one address.
2. **Read what the user asked about.**
   - `--screen`: what it is doing right now, mid-turn included. With the address, `hc read <address>` shows the same screen.
   - `--read`: what it said and did, finished turns only.
   - More of the transcript: it is JSONL on that machine. Use `hc exec --on <machine> -- grep …`, or `hc file read --on <machine> <path> --offset … --limit …`.
3. **Writing to it** (`hc send`, `hc keys`) is for when the user asks you to. Use the address from step 1.

**Not found:** the error lists the machines this hc sees. Each machine's hc reaches only some of the others. Tell the user to ask from a machine that reaches the session's.
