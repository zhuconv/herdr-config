// agent-deck: CPU, memory and disk use of a machine, in percent, for the Terminals tab.
// One POSIX sh script for Linux and macOS; it prints `cpu=N mem=N disk=N` (a field it
// could not measure stays empty). Run through `hc exec … -- sh -c` so the machine's own
// login shell (fish, say) never parses it.

export const USAGE_SCRIPT = `
if [ -r /proc/stat ]; then
  read -r _ a b c d e f g h _ < /proc/stat; sleep 1; read -r _ A B C D E F G H _ < /proc/stat
  idle=$((D + E - d - e)); tot=$((A + B + C + D + E + F + G + H - a - b - c - d - e - f - g - h))
  [ "$tot" -gt 0 ] && cpu=$((100 * (tot - idle) / tot))
  mem=$(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{v=$2} END{if (t) printf "%d", (t - v) * 100 / t}' /proc/meminfo)
else
  cpu=$(top -l 2 -n 0 -s 1 2>/dev/null | awk '/CPU usage/{i=$7} END{if (i != "") {sub("%", "", i); printf "%d", 100 - i}}')
  total=$(sysctl -n hw.memsize 2>/dev/null)
  mem=$(vm_stat 2>/dev/null | awk -v total="$total" '
    /page size of/ {ps=$8}
    /^Pages active:/ {u+=$3} /^Pages wired down:/ {u+=$4} /occupied by compressor:/ {u+=$5}
    END {if (ps && total) printf "%d", u * ps * 100 / total}')
fi
disk=$(df -P "$HOME" 2>/dev/null | awk 'NR==2{sub("%", "", $5); print $5}')
echo "cpu=$cpu mem=$mem disk=$disk"
`;

// `hc` arguments that run the script on machine `m` (null: this computer).
export const usageArgs = (m) => ["exec", ...(m ? ["--on", m] : []), "--timeout", "20", "--", "sh", "-c", USAGE_SCRIPT];

const pct = (s) => (s === undefined || s === "" ? null : Math.min(100, Math.max(0, parseInt(s, 10))));

// { cpu, mem, disk } (each 0..100 or null) from the script's output, or null when
// it printed no usage line with at least one value.
export function parseUsage(stdout) {
  const line = (stdout ?? "").split("\n").reverse().find((l) => /^cpu=-?\d*\s+mem=-?\d*\s+disk=-?\d*\s*$/.test(l.trim()));
  if (!line) return null;
  const v = Object.fromEntries(line.trim().split(/\s+/).map((kv) => kv.split("=")));
  const u = { cpu: pct(v.cpu), mem: pct(v.mem), disk: pct(v.disk) };
  return u.cpu === null && u.mem === null && u.disk === null ? null : u;
}
