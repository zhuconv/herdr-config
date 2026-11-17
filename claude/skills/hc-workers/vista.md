# Workers on Vista (vista, vista2, vista3)

Agents run only on compute nodes there. The Vista section of the global CLAUDE.md has the rules and the user's idev command; ask the user before using another partition or time.

In place of steps 2–3 of "Start a worker", with `me` set as in step 2:

1. Get a compute node in a new terminal of yours:

   ```sh
   hc run --bg --on <vista> --name <name> --outlive-parent --label worker.manager="$me" "idev -p gg -t 47:00:00 -E" | jq -r .address
   hc wait <address> --output "Job is now running on masternode"
   ```

   When `squeue --me` there already shows a job on that partition, start `bash` in place of idev, then `hc send <address> 'ssh <node>'`. Done when `hc read <address>` shows a compute-node prompt (`c6xx-xxx` or `i6xx-xxx`).
2. Build `task` as in step 2, then add this line to it, with `<tN>` taken from the address (`vista/t2r` → `t2r`):

   > hc's core runs on login1, not on this node. To report, write the report to `~/.cache/workers/<name>.txt`, then run `timeout 60 ssh login1 'HC_TERMINAL_ID=<tN> ~/.local/bin/hc send MANAGER "$(cat ~/.cache/workers/<name>.txt)"' < /dev/null`.

   `HC_TERMINAL_ID` makes the report arrive tagged as the worker's. Replace MANAGER in it as in step 2.
3. Put the task in a file there, and start the agent with it:

   ```sh
   printf '%s' "$task" | hc file write --on <vista> .cache/workers/<name>.task
   hc send <address> 'cd <folder> && claude --permission-mode auto "$(cat ~/.cache/workers/<name>.task)"'   # or codex "$(cat …)"
   ```

Then go on with step 3 of "Start a worker". When this worker is finished, also check with `squeue --me` that its idev job ended.
