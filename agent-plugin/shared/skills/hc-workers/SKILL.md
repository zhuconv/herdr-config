---
name: hc-workers
description: "Start and manage Claude or Codex workers on the user's machines through hc. Use when the user hands a task to an agent on another machine; asks about, steers or stops a worker; or a worker's report (`<hc from=…>`) or hc note arrives."
---

# Workers

The user talks to a **manager** agent most of the time. The manager starts **workers**, Claude or Codex sessions on the user's machines, and the user can open any worker in Herdr and steer it directly. That is why workers are interactive hc terminals, not subagents.

Two words used throughout: a worker **reports** to its manager; the manager or the user **steers** a worker.

Which role you have:
- Your task says you are a worker: follow the worker rules in your task (`worker.md` here) and stop reading.
- Otherwise you are the manager: read on. For vista, vista2 and vista3, also read `vista.md`.

hc's own manual is `hc --skill`. Where it differs from this skill, this skill wins: it holds the user's rules.

## Manager

### Channels

- **The user → you:** text without a tag.
- **You → a worker** (an address looks like `a5k/t3k`):
  - steer: `hc send <address> "…"`, which arrives tagged with your address;
  - a prompt or dialog on its screen: `hc keys <address> <keys>`;
  - stop its turn: `hc interrupt <address>`;
  - its screen: `hc read <address>`, plus `--lines 40` for the history above it.
- **A worker → you:** its reports, tagged `<hc from="a5k/t3k">…</hc>`, and hc's notes when it blocks, errors or exits, `<hc>a5k/t3k <name> …</hc>`. Both arrive as your next input.
- **Your address**, the same string on every machine (e.g. `mba/t5c`):
  `me="$(hc server status --json | jq -r .core.name)/$HC_TERMINAL_ID"`
- **Your workers:** `hc ls --label worker.manager="$me" --json | jq -r '.terminals[] | "\(.address) \(.name) \(.status)"'`

### Routine

**Start a worker**

1. Take the machine, folder and task from the user's words, and ask only for what they leave open. `hc machine ls --json | jq -r '.machines[].name'` lists the machines. For vista, vista2 and vista3, follow `vista.md` in place of steps 2–3.
2. Start it from your shell:

   ```sh
   me="$(hc server status --json | jq -r .core.name)/$HC_TERMINAL_ID"
   goal=$(cat <<'EOF'
   <goal, scope, what done looks like>
   EOF
   )
   rules=$(cat ~/.claude/skills/hc-workers/worker.md)
   task="$goal

   ${rules//MANAGER/$me}"
   hc run --bg --on <machine> --cwd <folder> --name <name> --outlive-parent --label worker.manager="$me" \
     -- claude --permission-mode auto -n <name> "$task" | jq -r .address
   # Codex: … -- codex --no-daemon "$task"   (its own session, so Herdr's hook knows its terminal)
   ```

   - It prints the worker's address.
   - `<name>` is short and unique (a-z 0-9 - _). The user finds the worker by it, under your row in Herdr's Agents list. `claude -n` makes it the session's name too, the one name Herdr's tabs and lists show; a `/rename` later changes it everywhere. Codex has no such option.
   - `--outlive-parent` keeps the worker running after your session ends. The label lets you list your workers later.
3. `hc wait <address> --timeout 30`, then `hc read <address>`. Done when the screen shows the worker on the task. Answer a startup dialog, such as folder trust, with `hc keys`.
4. Tell the user the worker's name and address, then end your turn.

**While workers run**

- When news arrives, read the worker's screen, or the file its report names, before telling the user anything.
- Settle prompts and dialogs yourself: read the screen, then press the answer with `hc keys`. Answer a worker's question yourself when the task settles it. Bring the user only missing key information or a key decision, including a risky action that its permission checks blocked.
- Before you steer, read the worker's screen: the user may have steered it directly. Build on what they told it, and when your plan conflicts with theirs, ask the user.

**Finish:** when the user agrees a worker is done, `hc kill <address>`, then `hc rm <address>`.

### Caveats

- Start every worker yourself, with `hc run` from your shell. That makes you its parent: you get its notes, it nests under you in the Agents list, and its machine may send to you. A session started any other way (`hcx`, Herdr's +, a tab the user opens) has none of these.
- A bare `tN` names a terminal on the machine where hc runs, so workers always get your full `$me`.
- Keep the goal in the quoted heredoc, so its quotes and `$` reach the worker unchanged.
