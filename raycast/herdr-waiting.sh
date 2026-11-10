#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title Go to Waiting Agent
# @raycast.packageName Herdr
# @raycast.description Bring Herdr to the front at the Claude/Codex that rang last (finished, or needs you). Inside Herdr, ⌘G does the same.
# @raycast.icon 🔔
# @raycast.mode silent

# Bound to ⌘G in Raycast. VS Code keeps its own ⌘G (Find Next): the key is handed back
# to it with postkey (~/.local/share/postkey/postkey.c), which needs Raycast in Accessibility.
# Elsewhere the pick is my-tabs' "waiting" command (~/.config/herdr-app/mods/my-tabs/waiting.js).
# It runs before Herdr comes to the front. When Herdr wasn't in front, "away" lets the
# focused agent count: it may be the one that rang while you were in another app.
herdr="$HOME/.local/bin/herdr-app"
front=$(/usr/bin/lsappinfo info -only bundleid -only pid "$(/usr/bin/lsappinfo front)" 2>/dev/null)
case $front in
  *'"com.microsoft.VSCode"'*)
    # The key goes straight to VS Code, past Raycast's hotkey. If it ever came back
    # here instead, this lock stops the loop after one round (stale after 2 s).
    lock=${TMPDIR:-/tmp}/herdr-waiting-vscode.lock
    if [[ -d $lock ]] && (( $(/bin/date +%s) - $(/usr/bin/stat -f %m "$lock") > 1 )); then /bin/rmdir "$lock"; fi
    /bin/mkdir "$lock" 2>/dev/null || exit 0
    (/bin/sleep 0.2; /bin/rmdir "$lock") >/dev/null 2>&1 &
    pid=$(/usr/bin/sed -n 's/^"pid"=//p' <<<"$front")
    "$HOME/.local/bin/postkey" "$pid" 5 cmd ||
      echo "To keep ⌘G in VS Code, allow Raycast in Privacy & Security → Accessibility" ;;
  *'"dev.herdr.app"'*)
    "$herdr" do my-tabs.waiting >/dev/null 2>&1 ;;
  *)
    "$herdr" do "my-tabs.waiting away" >/dev/null 2>&1
    /usr/bin/open -b dev.herdr.app ;;
esac
