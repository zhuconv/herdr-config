#!/usr/bin/env python3
"""Find one of the user's Claude or Codex sessions by its name, through hc, and read it.

  find.py <name>               where it is: hc address, state, folder, session id, transcript
  find.py <name> --read [N]    and its last N turns from the transcript, text only (default 5)
  find.py <name> --screen [N]  and its screen now, with N lines of history above (default 100)

<name>: what Herdr shows for it (a tab someone named, else the agent's session title), an hc
name (hc run --name), the start of a session id, an address (gpu1/t44) or its folder's name.
Part of a name works too. It looks through the terminals this machine's hc lists, finished
ones too: every machine this one reaches. Addresses print in full (machine/tN), the same
string from any machine that reaches that one.
"""
import datetime
import glob
import json
import os
import re
import shlex
import socket
import subprocess
import sys
import time

# This file, to run on another machine (piped to python3 there); None in such a piped copy.
SELF = globals().get("__file__", "<stdin>")
SELF = None if SELF.startswith("<") else os.path.abspath(SELF)


# ---- hc ---------------------------------------------------------------------------------------

def via():
    """The login node whose hc this host uses (a cluster compute node), else None."""
    v = (os.environ.get("HC_VIA") or os.environ.get("SLURM_SUBMIT_HOST") or "").split(".")[0]
    return v if v and v != socket.gethostname().split(".")[0] else None


def hc(args, data=None):
    """Runs hc here, or on the login node through ssh from a compute node: (code, out, err)."""
    login = via()
    if login:
        cmd = ["ssh", "-o", "ConnectTimeout=10", login, "~/.local/bin/hc " + " ".join(shlex.quote(a) for a in args)]
    else:
        dirs = os.environ.get("PATH", "").split(os.pathsep) + [os.path.expanduser("~/.local/bin")]
        path = next((os.path.join(d, "hc") for d in dirs if os.access(os.path.join(d, "hc"), os.X_OK)), None)
        if not path:
            sys.exit("hc isn't installed here.")
        cmd = [path] + args
    r = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       universal_newlines=True, timeout=120)
    return r.returncode, r.stdout, r.stderr


CORE = {}


def api(method, params):
    """One call to hc's API (hc connect). Also notes this core's name in CORE."""
    lines = [{"jsonrpc": "2.0", "id": 1, "method": "hello", "params": {"generation": 1}},
             {"jsonrpc": "2.0", "id": 2, "method": method, "params": params}]
    code, out, err = hc(["connect"], "".join(json.dumps(x) + "\n" for x in lines))
    for line in out.splitlines():
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("id") == 1:
            CORE.update((m.get("result") or {}).get("core") or {})
        elif m.get("id") == 2:
            if "error" in m:
                sys.exit("hc: %s" % m["error"].get("message"))
            return m["result"]
    sys.exit("hc didn't answer: " + (err.strip() or out.strip())[:300])


# ---- names ------------------------------------------------------------------------------------

def clean(s):
    """Without the marks an agent puts before its title (Claude's ✳, a spinner)."""
    return re.sub(r"^[^\w]+", "", str(s or ""), flags=re.U).strip()


def kind(t):
    """claude-code, codex, or the program's name."""
    argv = (t.get("foreground") or {}).get("argv") or t.get("argv") or ["?"]
    return (t.get("status") or {}).get("app") or os.path.basename(argv[0])


def title(t):
    """The session's own name: Claude Code's terminal title; Codex's is "session | workspace"."""
    raw = str(t.get("title") or "").strip()
    if "codex" in kind(t):
        raw = re.sub(r"\s+\|\s+[^|]+$", "", raw)
    raw = clean(raw)
    # A shell's title (a folder, user@host:folder) or the address names nothing.
    return "" if re.match(r"^[~/]|^\S+@\S+:", raw) or raw == t["address"].split("/")[-1] else raw


def tab(t):
    """The tab's name from Herdr's `where` label ("space / tab"), when someone named it."""
    w = (t.get("labels") or {}).get("where") or ""
    name = w.split(" / ", 1)[1] if " / " in w else ""
    return "" if name.isdigit() else name


def shown(t):
    """The terminal another one shows with `hc attach`, as an address from here."""
    argv = (t.get("foreground") or {}).get("argv") or []
    if len(argv) < 3 or os.path.basename(argv[0]) != "hc" or argv[1] != "attach" or argv[2].startswith("-"):
        return None
    machine = t["address"].split("/")[0] + "/" if "/" in t["address"] else ""
    return argv[2] if "/" in argv[2] else machine + argv[2]


def score(q, t):
    """3: a name is q; 2: a name holds q; 1: q is its folder's name; 0: no."""
    labels = t.get("labels") or {}
    names = [x.casefold() for x in (tab(t), title(t), t.get("name") or "") if x]
    addr = t["address"].casefold()
    sid = (labels.get("note.session") or "").casefold()
    folder = os.path.basename((labels.get("note.cwd") or t.get("cwd") or "").rstrip("/")).casefold()
    if q in names or q in (addr, addr.split("/")[-1]) or (len(q) >= 6 and sid.startswith(q)):
        return 3
    if len(q) >= 3 and any(q in n for n in names):
        return 2
    return 1 if q == folder else 0


def full(address):
    """An address as every machine writes it: this hc's own terminals get its name in front."""
    return address if "/" in address or not CORE.get("name") else CORE["name"] + "/" + address


def find(q, ts):
    """The terminals q names best, a window onto another (hc attach) swapped for that one."""
    q = clean(q).casefold() or q.casefold()
    own = (CORE.get("name") or "").casefold() + "/"
    if own != "/" and q.startswith(own):
        q = q[len(own):]
    by = {t["address"]: t for t in ts}
    scored = [(score(q, t), t) for t in ts]
    best = max([s for s, _ in scored] or [0])
    hits, seen = [], set()
    for s, t in scored:
        if s and s == best:
            t = by.get(shown(t), t)
            if t["address"] not in seen:
                seen.add(t["address"])
                hits.append(t)
    rank = {"blocked": 0, "working": 1, "done": 2, "idle": 3}
    return sorted(hits, key=lambda t: (t.get("state") != "live", not t.get("status"),
                                       rank.get((t.get("status") or {}).get("state"), 4), t["address"]))


# ---- on the session's machine -----------------------------------------------------------------

def newest(paths):
    return max(paths, key=os.path.getmtime) if paths else ""


def titled(path):
    """The title a Claude transcript last gave its session: one the user set, else Claude's."""
    named = auto = None
    with open(path, errors="replace") as f:
        for line in f:
            if '-title"' in line:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                named, auto = e.get("customTitle") or named, e.get("aiTitle") or auto
    return named or auto


def claude_session(home, pid, title, cwd, since):
    """(session id, folder) of a claude: from Claude's record of each running one
    (~/.claude/sessions/<pid>.json, with its name), by its pid, else the newest with that name.
    Else (a claude behind ssh on another host) the newest transcript of that folder written
    since the terminal started that carries the title."""
    recs = []
    for p in glob.glob(home + "/.claude/sessions/*.json"):
        try:
            with open(p) as f:
                recs.append(json.load(f))
        except (OSError, ValueError):
            pass
    mine = [r for r in recs if pid and r.get("pid") == pid]
    mine = mine or sorted((r for r in recs if title and r.get("name") == title), key=lambda r: r.get("updatedAt") or 0)[-1:]
    if mine:
        return mine[-1].get("sessionId") or "", mine[-1].get("cwd") or cwd
    if title and cwd:
        folder = home + "/.claude/projects/" + re.sub(r"[^A-Za-z0-9-]", "-", cwd)
        recent = [p for p in glob.glob(folder + "/*.jsonl") if os.path.getmtime(p) * 1000 >= (since or 0)]
        for p in sorted(recent, key=os.path.getmtime, reverse=True)[:20]:
            if titled(p) == title:
                return os.path.basename(p)[:-len(".jsonl")], cwd
    return "", cwd


def codex_thread(home, sid, title):
    """A Codex thread's id and history file, from Codex's thread table (~/.codex/state_N.sqlite):
    by id, else the newest thread with that name. Else its name index and a file named for it
    (rollout-<time>-<id>.jsonl, or …-<id>_<part>.jsonl once a thread runs long)."""
    row, dbs = None, glob.glob(home + "/.codex/state_*.sqlite")
    if dbs and (sid or title):
        try:
            import sqlite3
            db = max(dbs, key=lambda p: int(re.sub(r"\D", "", os.path.basename(p)) or 0))
            c = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
            q = "select id, rollout_path from threads where %s = ? order by updated_at desc limit 1"
            row = c.execute(q % ("id" if sid else "name"), (sid or title,)).fetchone()
            c.close()
        except Exception:
            row = None
    if row:
        sid = row[0]
        if row[1] and os.path.exists(row[1]):
            return sid, row[1]
    if not sid and title:
        try:
            with open(home + "/.codex/session_index.jsonl") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("thread_name") == title:
                        sid = d.get("id") or sid
        except OSError:
            pass
    found = []
    for root in ("/.codex/sessions", "/.codex/archived_sessions") if sid else ():
        for d, _, files in os.walk(home + root):
            found += [os.path.join(d, f) for f in files if f.endswith(".jsonl") and sid in f]
    return sid, newest(found)


def probe(a):
    """Its session id, folder and transcript: from what hc knows (a: the hook's note.session),
    else from the agent's own records on this machine."""
    home, k = os.path.expanduser("~"), a["kind"]
    sid, cwd, title, path = a.get("session") or "", a.get("cwd") or "", a.get("title") or "", ""
    if "codex" not in k:
        if not sid and "claude" in k:
            sid, cwd = claude_session(home, a.get("pid"), title, cwd, a.get("since"))
        if sid:
            path = newest(glob.glob(home + "/.claude/projects/*/%s.jsonl" % sid))
    if not path and "claude" not in k and (sid or "codex" in k):
        sid, path = codex_thread(home, sid, title)
    out = {"session": sid, "cwd": cwd, "transcript": path}
    if path:
        st = os.stat(path)
        out.update(size=st.st_size, mtime=st.st_mtime)
    return out


def noise(text):
    """What a harness put in a user message (reminders, command tags, instructions). An hc note
    or a worker's report (<hc …>) is real."""
    s = text.lstrip()
    return (s.startswith("<") and not s.startswith("<hc")) or s.startswith(("# AGENTS.md", "Caveat:"))


def turns(path, n, offset):
    """The last n prompts and the replies after each, as text; times at `offset` minutes from UTC
    (the caller's clock)."""
    codex = os.path.basename(path).startswith("rollout-")
    msgs, steps = [], 0
    with open(path, errors="replace") as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            role = text = None
            if codex:
                p = d.get("payload") or {}
                if d.get("type") == "response_item" and p.get("type") == "message" and p.get("role") in ("user", "assistant"):
                    role = p["role"]
                    text = "\n".join(c.get("text", "") for c in p.get("content") or []
                                     if isinstance(c, dict) and c.get("type") in ("input_text", "output_text"))
                elif d.get("type") == "response_item" and str(p.get("type", "")).endswith("call"):
                    steps += 1
            elif d.get("type") in ("user", "assistant") and not d.get("isSidechain") and not d.get("isMeta"):
                role = d["type"]
                c = (d.get("message") or {}).get("content")
                if isinstance(c, str):
                    text = c
                elif isinstance(c, list):
                    text = "\n".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
                    steps += sum(1 for x in c if isinstance(x, dict) and x.get("type") == "tool_use")
            if not role or not text or not text.strip() or (role == "user" and noise(text)):
                continue
            steps = 0
            if role == "assistant" and msgs and msgs[-1][0] == "assistant":
                msgs[-1][2] += "\n\n" + text.strip()
            else:
                msgs.append([role, d.get("timestamp"), text.strip()])
    users = [i for i, m in enumerate(msgs) if m[0] == "user"]
    start = users[-n] if len(users) >= n else 0
    if start:
        print("(%d earlier prompts left out)\n" % (len(users) - n))
    agent = "codex" if codex else "claude"
    for role, ts, text in msgs[start:]:
        who = agent if role == "assistant" else "hc note" if text.startswith("<hc") else "user"
        if len(text) > 2400:
            text = text[:1600] + "\n  …[%d chars left out]…\n" % (len(text) - 2400) + text[-800:]
        print("── %s · %s\n%s\n" % (who, when(ts, offset), text))
    if steps:
        print("(then %d tool calls with no words yet: --screen shows where it is)" % steps)


def when(ts, offset):
    try:
        d = datetime.datetime.strptime(str(ts)[:19], "%Y-%m-%dT%H:%M:%S")
        return (d + datetime.timedelta(minutes=offset)).strftime("%m-%d %H:%M")
    except ValueError:
        return "?"


def here(args):
    """What on() runs on the session's machine."""
    if args[0] == "--probe":
        return json.dumps(probe(json.loads(args[1])))
    turns(args[1], int(args[2]), int(args[3]))
    return ""


def on(t, *args):
    """here(args) on the terminal's machine: in this process for this hc's own terminals (on a
    compute node, the login node's home is this one), else this file piped to python3 there."""
    machine = t["address"].split("/")[0] if "/" in t["address"] else None
    if not machine:
        return here(list(args))
    with open(SELF) as f:
        code, out, err = hc(["exec", "--on", machine, "-i", "--", "python3", "-"] + list(args), f.read())
    if code:
        sys.exit("on %s: %s" % (machine, (err.strip() or out.strip())[:400]))
    return out


# ---- output -----------------------------------------------------------------------------------

def ago(s):
    s = max(0, int(s))
    return "%ds" % s if s < 60 else "%dm" % (s // 60) if s < 3600 else "%dh" % (s // 3600) if s < 86400 else "%dd" % (s // 86400)


def show(t, ts):
    labels = t.get("labels") or {}
    prog = kind(t)
    state = (t.get("status") or {}).get("state") or "no status" if t.get("state") == "live" else "finished"
    name = tab(t) or title(t) or t.get("name") or ""
    head = [full(t["address"]), json.dumps(name, ensure_ascii=False) if name else "(no name)", "%s · %s" % (prog, state)]
    print("  ".join(head) + ("  · tab %s" % labels["where"] if labels.get("where") else ""))
    if t.get("name") and t["name"] != name:
        print("  hc name     %s" % t["name"])
    views = [full(v["address"]) for v in ts if shown(v) == t["address"] and v.get("state") == "live"]
    if views:
        print("  shown in    %s (hc attach)" % ", ".join(views))
    a = {"session": labels.get("note.session"), "cwd": labels.get("note.cwd") or t.get("cwd"),
         "pid": (t.get("foreground") or {}).get("pid"), "title": title(t), "kind": prog, "since": t.get("created_ms")}
    info = json.loads(on(t, "--probe", json.dumps(a)) or "{}")
    machine = t["address"].split("/")[0] if "/" in t["address"] else CORE.get("name") or "here"
    print("  folder      %s" % (info.get("cwd") or a["cwd"] or "?"))
    if labels.get("note.host"):
        print("  runs on     %s, a compute node (its home is %s's)" % (labels["note.host"], machine))
    if info.get("session"):
        print("  session     %s" % info["session"])
    if info.get("transcript"):
        age = datetime.datetime.now().timestamp() - info["mtime"]
        print("  transcript  %s:%s  (%.1f MB, written %s ago)" % (machine, info["transcript"], info["size"] / 1e6, ago(age)))
    elif "claude" in prog or "codex" in prog:
        print("  transcript  not found (no session id for it); --screen still reads it")
    return info


def option(argv, flag, default):
    """argv without `flag [N]`, and N (default when N is left out; None without the flag)."""
    if flag not in argv:
        return argv, None
    i = argv.index(flag)
    n = argv[i + 1] if i + 1 < len(argv) and argv[i + 1].isdigit() else None
    return argv[:i] + argv[i + (2 if n else 1):], int(n) if n else default


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return
    if argv[0] in ("--probe", "--turns"):
        print(here(argv), end="")
        return
    argv, read = option(argv, "--read", 5)
    argv, screen = option(argv, "--screen", 100)
    q = " ".join(argv).strip()
    res = api("terminal.list", {"all": True})
    ts = res.get("terminals", []) if isinstance(res, dict) else res
    hits = find(q, ts)
    if not hits:
        seen = sorted({t["address"].split("/")[0] for t in ts if "/" in t["address"]} | {CORE.get("name") or "this one"})
        print("No session named %r here. This machine's hc lists %d terminals, on %s." % (q, len(ts), ", ".join(seen)))
        sys.exit(1)
    if len(hits) > 1:
        print("%d sessions fit %r:\n" % (len(hits), q))
    infos = []
    for t in hits[:8]:
        infos.append(show(t, ts))
        print()
    if len(hits) > 8:
        print("…and %d more." % (len(hits) - 8))
    if read is None and screen is None:
        return
    if len(hits) > 1:
        sys.exit("Several fit: give one's address to read it.")
    t, info = hits[0], infos[0]
    if screen is not None:
        code, out, err = hc(["read", t["address"], "--lines", str(screen)])
        print("Its screen, with %d lines above:\n\n%s" % (screen, (out or err).rstrip()))
    if read is not None:
        if not info.get("transcript"):
            sys.exit("No transcript found to --read; --screen shows it.")
        offset = time.localtime().tm_gmtoff // 60
        print("Its last %d turns:\n" % read)
        print(on(t, "--turns", info["transcript"], str(read), str(offset)), end="")


if __name__ == "__main__":
    main(sys.argv[1:])
