#!/bin/bash
set -f

input=$(cat)

if [ -z "$input" ]; then
    printf "Antigravity"
    exit 0
fi

# ── Colors (identical to ~/.claude/statusline.sh) ───────
blue='\033[38;2;0;153;255m'
orange='\033[38;2;255;176;85m'
green='\033[38;2;0;175;80m'
cyan='\033[38;2;86;182;194m'
red='\033[38;2;255;85;85m'
yellow='\033[38;2;230;200;0m'
white='\033[38;2;220;220;220m'
magenta='\033[38;2;180;140;255m'
dim='\033[2m'
reset='\033[0m'

sep=" ${dim}│${reset} "

# ── Helpers ─────────────────────────────────────────────
color_for_pct() {
    local pct=$1
    if [ "$pct" -ge 90 ]; then printf "$red"
    elif [ "$pct" -ge 70 ]; then printf "$yellow"
    elif [ "$pct" -ge 50 ]; then printf "$orange"
    else printf "$green"
    fi
}

build_bar() {
    local pct=$1
    local width=$2
    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100

    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))
    local bar_color
    bar_color=$(color_for_pct "$pct")

    local filled_str="" empty_str=""
    for ((i=0; i<filled; i++)); do filled_str+="●"; done
    for ((i=0; i<empty; i++)); do empty_str+="○"; done

    printf "${bar_color}${filled_str}${dim}${empty_str}${reset}"
}

format_epoch_time() {
    local epoch=$1
    local style=$2
    [ -z "$epoch" ] || [ "$epoch" = "null" ] || [ "$epoch" = "0" ] && return

    local result=""
    case "$style" in
        time)
            result=$(date -j -r "$epoch" +"%l:%M%p" 2>/dev/null)
            [ -z "$result" ] && result=$(date -d "@$epoch" +"%l:%M%P" 2>/dev/null)
            result=$(echo "$result" | sed 's/^ //; s/\.//g' | tr '[:upper:]' '[:lower:]')
            ;;
        datetime)
            result=$(date -j -r "$epoch" +"%b %-d, %l:%M %p" 2>/dev/null)
            [ -z "$result" ] && result=$(date -d "@$epoch" +"%b %-d, %l:%M %p" 2>/dev/null)
            result=$(echo "$result" | sed 's/  / /g; s/^ //; s/\.//g')
            ;;
        *)
            result=$(date -j -r "$epoch" +"%b %-d" 2>/dev/null)
            [ -z "$result" ] && result=$(date -d "@$epoch" +"%b %-d" 2>/dev/null)
            result=$(echo "$result" | tr '[:upper:]' '[:lower:]')
            ;;
    esac
    printf "%s" "$result"
}

iso_to_epoch() {
    local iso_str="$1"
    [ -z "$iso_str" ] || [ "$iso_str" = "null" ] && return 1

    local epoch
    epoch=$(date -d "${iso_str}" +%s 2>/dev/null)
    if [ -n "$epoch" ]; then
        echo "$epoch"
        return 0
    fi

    local stripped="${iso_str%%.*}"
    stripped="${stripped%%Z}"
    stripped="${stripped%%+*}"
    stripped="${stripped%%-[0-9][0-9]:[0-9][0-9]}"

    if [[ "$iso_str" == *"Z"* ]] || [[ "$iso_str" == *"+00:00"* ]] || [[ "$iso_str" == *"-00:00"* ]]; then
        epoch=$(env TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
        [ -z "$epoch" ] && epoch=$(env TZ=UTC date -d "${stripped/T/ }" +%s 2>/dev/null)
    else
        epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
        [ -z "$epoch" ] && epoch=$(date -d "${stripped/T/ }" +%s 2>/dev/null)
    fi

    if [ -n "$epoch" ]; then
        echo "$epoch"
        return 0
    fi

    return 1
}

# ── Extract JSON data in a single jq pass ───────────────
parsed=$(printf '%s' "$input" | jq -r '
  (.model.display_name // .model.id // "Antigravity") as $mname
  # agy passes its plan quota as buckets keyed by id: gemini-weekly and gemini-5h for the Gemini
  # models, 3p-weekly and 3p-5h for the Claude and GPT ones (agy 1.5.18). The line shows the
  # weekly bucket of the group the running model is in.
  | (if ($mname | test("^(claude|gpt)"; "i")) then "3p-weekly" else "gemini-weekly" end) as $bucket
  | (.quota[$bucket]? // null) as $b
  | [
      $mname,
      (.model.effort // .effort // ""),
      (
        if (.context_window.used_percentage != null) then
          (.context_window.used_percentage | round)
        elif ((.context_window.context_window_size // 0) > 0 and .context_window.current_usage != null) then
          ((((.context_window.current_usage.input_tokens // 0)
            + (.context_window.current_usage.cache_creation_input_tokens // 0)
            + (.context_window.current_usage.cache_read_input_tokens // 0)) * 100)
           / .context_window.context_window_size | floor)
        else 0 end
      ),
      (.workspace.current_dir // .cwd // ""),
      (.vcs.branch // ""),
      (if .vcs.dirty == true then "*" elif .vcs.dirty == false then "clean" else "" end),
      (.session.start_time // ""),
      (if $b.remaining_fraction != null then ((1 - $b.remaining_fraction) * 100 | round) else "" end),
      ($b.reset_time // ""),
      ($b.reset_in_seconds // "")
    ]
  | map(tostring) | join("\u001f")
' 2>/dev/null)

if [ -z "$parsed" ]; then
    printf "Antigravity"
    exit 0
fi

IFS=$'\x1f' read -r model_name effort pct_used cwd vcs_branch vcs_dirty session_start \
    quota_pct quota_reset_iso quota_reset_in_sec <<< "$parsed"

# ── Normalize model name & effort ───────────────────────
# Strip trailing "(High)" / "(Medium)" / etc. from display_name if present,
# using it as fallback for effort so effort is not shown twice.
if [[ "$model_name" =~ ^(.*)[[:space:]]+\(([Ll]ow|[Mm]edium|[Hh]igh|[Xx][Hh]igh|[Mm]ax)\)$ ]]; then
    base_model="${BASH_REMATCH[1]}"
    paren_effort=$(printf '%s' "${BASH_REMATCH[2]}" | tr '[:upper:]' '[:lower:]')
    model_name="$base_model"
    [ -z "$effort" ] && effort="$paren_effort"
fi

effort=$(printf '%s' "$effort" | tr '[:upper:]' '[:lower:]')
if [ -z "$effort" ]; then
    parent_cmd=$(ps -o args= -p "$PPID" 2>/dev/null)
    if [[ "$parent_cmd" =~ --effort[=[:space:]]+(low|medium|high|xhigh|max) ]]; then
        effort="${BASH_REMATCH[1]}"
    fi
fi
[ -z "$effort" ] && effort="default"

[ -z "$pct_used" ] && pct_used=0

# ── Working directory + git ─────────────────────────────
[ -z "$cwd" ] || [ "$cwd" = "null" ] && cwd=$(pwd)
dirname=$(basename "$cwd")

git_branch="$vcs_branch"
git_dirty=""
if [ "$vcs_dirty" = "*" ]; then
    git_dirty="*"
fi

if [ -z "$git_branch" ] && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git_branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
    [ -z "$git_branch" ] && git_branch=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
fi
if [ -n "$git_branch" ] && [ -z "$vcs_dirty" ]; then
    if [ -n "$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)" ]; then
        git_dirty="*"
    fi
fi

# ── Session duration (when provided) ────────────────────
session_duration=""
if [ -n "$session_start" ] && [ "$session_start" != "null" ]; then
    start_epoch=$(iso_to_epoch "$session_start")
    if [ -n "$start_epoch" ]; then
        now_epoch=$(date +%s)
        elapsed=$(( now_epoch - start_epoch ))
        if [ "$elapsed" -ge 0 ]; then
            if [ "$elapsed" -ge 3600 ]; then
                session_duration="$(( elapsed / 3600 ))h$(( (elapsed % 3600) / 60 ))m"
            elif [ "$elapsed" -ge 60 ]; then
                session_duration="$(( elapsed / 60 ))m"
            else
                session_duration="${elapsed}s"
            fi
        fi
    fi
fi

skip_perms=""
parent_cmd=${parent_cmd:-$(ps -o args= -p "$PPID" 2>/dev/null)}
if [[ "$parent_cmd" == *"--dangerously-skip-permissions"* ]]; then
    skip_perms="⚡  "
fi

# ── Weekly limit's reset time ───────────────────────────
reset_epoch=""
if [ -n "$quota_reset_iso" ] && [ "$quota_reset_iso" != "null" ]; then
    reset_epoch=$(iso_to_epoch "$quota_reset_iso")
fi
if [ -z "$reset_epoch" ] && [ -n "$quota_reset_in_sec" ] && [ "$quota_reset_in_sec" != "null" ]; then
    sec_int="${quota_reset_in_sec%%.*}"
    if [ "$sec_int" -gt 0 ] 2>/dev/null; then
        now_epoch=$(date +%s)
        reset_epoch=$(( now_epoch + sec_int ))
    fi
fi

# ── Build status line ───────────────────────────────────
pct_color=$(color_for_pct "$pct_used")

line1="${blue}${model_name}${reset}"
line1+="${sep}"
line1+="✍️ ${pct_color}${pct_used}%${reset}"
line1+="${sep}"
line1+="${skip_perms}${cyan}${dirname}${reset}"
if [ -n "$git_branch" ]; then
    line1+=" ${green}(${git_branch}${red}${git_dirty}${green})${reset}"
fi
if [ -n "$session_duration" ]; then
    line1+="${sep}"
    line1+="${dim}⏱ ${reset}${white}${session_duration}${reset}"
fi
line1+="${sep}"
case "$effort" in
    max)    line1+="${magenta}◉ ${effort}${reset}" ;;
    xhigh)  line1+="${magenta}● ${effort}${reset}" ;;
    high)   line1+="${magenta}● ${effort}${reset}" ;;
    medium) line1+="${dim}◑ ${effort}${reset}" ;;
    low)    line1+="${dim}◔ ${effort}${reset}" ;;
    *)      line1+="${dim}◑ ${effort}${reset}" ;;
esac

if [ -n "$quota_pct" ]; then
    quota_reset=$(format_epoch_time "$reset_epoch" "datetime")
    quota_bar=$(build_bar "$quota_pct" 10)
    quota_pct_color=$(color_for_pct "$quota_pct")
    line1+="${sep}"
    line1+="${white}weekly${reset} ${quota_bar} ${quota_pct_color}${quota_pct}%${reset}"
    [ -n "$quota_reset" ] && line1+=" ${dim}⟳${reset} ${white}${quota_reset}${reset}"
fi

printf "%b" "$line1"
exit 0
