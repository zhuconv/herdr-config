"""Codex's status line and theme, kept in agent-plugin/codex/tui.toml: the keys there (status_line,
status_line_use_colors, theme) are kept the same in [tui] in ~/.codex/config.toml (or
$CODEX_HOME's). Only those keys: the rest of config.toml (its local paths, MCP servers and their
keys) stays out of the repo, and as it is.

  python3 add-statusline.py          writes tui.toml's keys into config.toml (install.sh)
  python3 add-statusline.py --save   copies their values from config.toml into tui.toml (save.sh),
                                     so a theme or status line you pick in Codex is saved too

It does nothing where Codex has never run (no ~/.codex). Before changing config.toml it leaves a
copy next to it (config.toml.bak-<time>). Codex reads [tui] when it starts.
"""
import os
import re
import shutil
import sys
import time

try:
    import tomllib  # Python 3.11+. Without it (macOS's own Python 3.9), the result isn't checked.
except ImportError:
    tomllib = None

TUI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tui.toml")
home = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
if not os.path.isdir(home):
    raise SystemExit(0)
config = os.path.join(home, "config.toml")

HEADER = re.compile(r"^\[tui\][ \t]*(?:#[^\n]*)?\n", re.M)
NEXT = re.compile(r"^\[", re.M)  # the next table ([x] or [[x]]); Codex starts them at a line's start


def body(text):
    """Where [tui]'s keys are in text (which ends with a newline): (start, end), or None."""
    m = HEADER.search(text)
    if not m:
        return None
    n = NEXT.search(text, m.end())
    return m.end(), n.start() if n else len(text)


def entry(key):
    """A key's line: its value is the rest of the line, or an array of strings over several lines."""
    return re.compile(r"^" + re.escape(key) + r"[ \t]*=[ \t]*(\[[^\]]*\]|[^\n]*)", re.M)


def values(text):
    """{key: its value as written} for each key of [tui] in text."""
    span = body(text)
    if not span:
        return {}
    part = text[span[0]:span[1]]
    return {m.group(1): entry(m.group(1)).match(part, m.start()).group(1).strip()
            for m in re.finditer(r"^([A-Za-z0-9_-]+)[ \t]*=", part, re.M)}


def put(text, want):
    """text with these keys of its [tui] set to these values (as written), the others as they were."""
    span = body(text)
    if span is None:
        return text + ("\n" if text else "") + "[tui]\n" + "".join(f"{k} = {v}\n" for k, v in want.items())
    start, end = span
    part, missing = text[start:end], ""
    for k, v in want.items():
        m = entry(k).search(part)
        if m:
            part = part[:m.start(1)] + v + part[m.end(1):]
        else:
            missing += f"{k} = {v}\n"
    return text[:start] + missing + part + text[end:]


def read(path):
    try:
        with open(path) as f:
            text = f.read()
    except FileNotFoundError:
        return ""
    return text if not text or text.endswith("\n") else text + "\n"


def write(path, text):
    with open(path + ".tmp", "w") as f:
        f.write(text)
    if os.path.exists(path):
        shutil.copymode(path, path + ".tmp")
    os.replace(path + ".tmp", path)


repo = read(TUI)
want = values(repo)  # the keys this repo keeps, as tui.toml writes them
if not want:
    raise SystemExit(f"{TUI} has no keys under [tui].")
text = read(config)

if sys.argv[1:] == ["--save"]:
    have = values(text)
    saved = {k: have.get(k, v) for k, v in want.items()}
    if saved != want:
        write(TUI, put(repo, saved))
        print("Codex: its status line and theme copied into agent-plugin/codex/tui.toml.")
    raise SystemExit(0)

new = put(text, want)
if new != text:
    if tomllib:
        try:
            got = tomllib.loads(new).get("tui", {})
        except tomllib.TOMLDecodeError as e:
            raise SystemExit(f"Codex: {config} left as it is: with these keys in [tui] it wouldn't parse ({e}).")
        if any(got.get(k) != v for k, v in tomllib.loads(repo)["tui"].items()):
            raise SystemExit(f"Codex: {config} left as it is: its [tui] didn't take these keys.")
    if os.path.exists(config):
        shutil.copy2(config, f"{config}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    write(config, new)
    print(f"Codex: status line and theme set in {config} ([tui] {', '.join(want)}).")
