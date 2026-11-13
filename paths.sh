# What this repo carries: "repo path|live path" pairs, read by install.sh and save.sh.
# A trailing slash marks a directory, synced whole except the files Herdr writes into
# every mod folder itself (gpui-kit.d.ts, jsconfig.json).
H="$HOME/.config/herdr-app"
ITEMS=(
  "herdr-app/keys.json|$H/keys.json"
  "herdr-app/settings.json|$H/settings.json"
  "herdr-app/programs.json|$H/programs.json"
  "herdr-app/my-icons/|$H/my-icons/"
  "herdr-app/layouts/my-main.json|$H/layouts/my-main.json"
  "herdr-app/themes/warp-dracula.json|$H/themes/warp-dracula.json"
  "herdr-app/mods/my-tabs/|$H/mods/my-tabs/"
  "herdr-app/mods/my-agents/|$H/mods/my-agents/"
  "herdr-app/mods/my-projects/|$H/mods/my-projects/"
  "herdr-app/mods/my-pane/|$H/mods/my-pane/"
  "herdr-app/mods/my-menu/|$H/mods/my-menu/"
  "herdr-app/mods/my-toast/|$H/mods/my-toast/"
  "herdr-app/mods/agent-switcher/|$H/mods/agent-switcher/"
  "herdr-app/mods/agent-deck-overview/|$H/mods/agent-deck-overview/"
  "herdr-app/mods/agent-deck-labels/|$H/mods/agent-deck-labels/"
  "claude/agent-note|$HOME/.local/bin/agent-note"
  "raycast/postkey.c|$HOME/.local/share/postkey/postkey.c"
)
SKIP=(--exclude gpui-kit.d.ts --exclude jsconfig.json --exclude .DS_Store)

# The Raycast script lives in whichever Raycast script folder holds it already;
# a new Mac gets ~/Documents/Raycast/herdr.
raycast_script() {
  local found
  found=$(find "$HOME/Documents/Raycast" -name herdr-waiting.sh 2>/dev/null | head -1)
  echo "${found:-$HOME/Documents/Raycast/herdr/herdr-waiting.sh}"
}
