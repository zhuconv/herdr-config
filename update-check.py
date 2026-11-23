#!/usr/bin/env python3
# herdr-update-check: before you restart into a Herdr update, is it safe for this setup? And after
# the restart, did everything come back?
#
#   herdr-update-check                    before: Herdr's update pill is showing
#   herdr-update-check --after            after the restart
#   herdr-update-check --from A --to B    compare two Herdr releases
#   herdr-update-check --show before      the last report (after: the last --after one)
#
# The tab bar (mods/my-tabs, updatecheck.js) runs the first two by itself, when Herdr has an
# update ready and once it's installed, and says what they found in a notification; a click on
# it opens the saved report in a dialog.
#
# An update never overwrites our files: Herdr rewrites only its own mods and layouts, and moves one
# that was edited aside first (`<name>-edited`). What it doesn't promise is that our mods keep
# working, so this looks where they lean on Herdr beyond what its mod API adds:
#   - the mod API (herdr.d.ts): anything removed or changed; the names our mods import, the
#     commands they run and keys.json binds, and Herdr's own labels they use;
#   - Herdr's pane layout code (src/window/pane_size.rs), which my-tabs/glow.js copies for ⌘G's
#     halo, and how much of a window overlay Herdr keeps on screen, which glow.js assumes;
#   - the layout formats: the tab document my-tabs/layoutdoc.js rewrites to join tabs, and the
#     window layout my-main.json is;
#   - the mods we copied from Herdr's (`cloned_from`): what changed there that the copies miss;
#   - herdr-core: a new core generation, a higher minimum, and our machines whose core carries
#     fixes no release has yet (FIXES): Herdr's per-machine Update would replace those builds.
# It reads Herdr's source at the two releases (fetched into ~/.cache/herdr-update-check), Herdr's
# release manifests, `hc machine ls`, and this repo, to tell whether the live config is saved.
# Exit status: 0 fine, 1 something to look at first, 2 don't restart yet.

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# herdr-core pull requests our machines' builds carry before a release has them. Once a release
# has both, Herdr's per-machine Update is safe again; this says so, and the list can be emptied.
FIXES = ("herdrdev/herdr-core", (309, 310))
SOURCE = "https://github.com/herdrdev/herdr-app.git"
RELEASES = os.environ.get("HERDR_RELEASES_URL", "https://releases.herdr.dev")
HOME = Path.home()
APP_HOME = Path(os.environ.get("HERDR_APP_HOME") or Path(os.environ.get("XDG_CONFIG_HOME") or HOME / ".config") / "herdr-app")
CACHE = HOME / ".cache" / "herdr-update-check"
SRC = CACHE / "herdr-app.git"
SNAP = CACHE / "before"
REPO = Path(os.path.realpath(__file__)).parent
# Run from Herdr (my-tabs runs it when an update is ready), the PATH may lack these.
for extra in (HOME / ".local/bin", Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
    if extra.is_dir() and str(extra) not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + str(extra)

# Where our code leans on Herdr's own code (paths in Herdr's source).
API = "defaults/herdr.d.ts"
GEOMETRY = "src/window/pane_size.rs"
OVERLAY_KEEP = ("src/window/movable.rs", r"KEEP_SHOWN: f32 = ([\d.]+)")
LAYOUT_FORMATS = ("src/layout.rs", "src/mirror.rs", "src/model.rs", "src/layout_sync.rs")
CORE_GENERATION = ("src/hc.rs", r"pub const GENERATION: u64 = (\d+);")
CORE_MIN = "distribution/core-version"

WORST = 0


def say(level, text, more=()):
    global WORST
    WORST = max(WORST, {"ok": 0, "note": 0, "warn": 0, "check": 1, "stop": 2}[level])
    print(f"  {level.upper() if level in ('warn', 'check', 'stop') else level:<5}  {text}")
    more = list(more)
    for line in more[:8]:
        print(f"         {line[:160]}")
    if len(more) > 8:
        print(f"         … and {len(more) - 8} more")


def sh(*cmd, cwd=None, timeout=120):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, "", str(e)


def git(*args):
    return sh("git", "--git-dir", str(SRC), *args, timeout=300)


def ver(v):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", v or "")
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


# What's installed and what's out.

def app_bundle():
    exe = shutil.which("herdr-app")
    if exe:
        bundle = Path(os.path.realpath(exe)).parents[2]  # Herdr.app/Contents/MacOS/Herdr
        if bundle.suffix == ".app":
            return bundle
    for bundle in (HOME / "Applications/Herdr.app", Path("/Applications/Herdr.app")):
        if bundle.exists():
            return bundle
    return None


def app_version(bundle):
    code, out, _ = sh("plutil", "-extract", "CFBundleShortVersionString", "raw", str(bundle / "Contents/Info.plist"))
    return out.strip() if code == 0 else None


def downloaded(bundle):
    """The version Herdr downloaded and puts in place on its next start (its update pill)."""
    receipt = read_json(bundle.with_name(bundle.name + ".new.json.noindex"))
    return receipt.get("version") if isinstance(receipt, dict) else None


def release(kind):
    code, out, _ = sh("curl", "-fsS", "--max-time", "15", f"{RELEASES}/{kind}/latest.json")
    try:
        return json.loads(out) if code == 0 else None
    except ValueError:
        return None


def mac_core():
    _, out, _ = sh("hc", "--version")
    m = re.search(r"\d+\.\d+\.\d+\S*", out)
    return m.group(0) if m else None


def machines():
    _, out, _ = sh("hc", "machine", "ls")
    try:
        return [m for m in json.loads(out)["machines"] if not m.get("temporary")]
    except (ValueError, KeyError, TypeError):
        return None


# Herdr's source at two releases.

def fetch_source(*versions):
    """Fetches the release tags (vX.Y.Z, depth 1) not yet in the cache; returns the ones it can't."""
    if not SRC.exists():
        SRC.parent.mkdir(parents=True, exist_ok=True)
        sh("git", "init", "--bare", "--quiet", str(SRC))
    missing = []
    for v in versions:
        tag = f"v{v}"
        if git("rev-parse", "--verify", "--quiet", f"refs/tags/{tag}^{{commit}}")[0] == 0:
            continue
        if git("fetch", "--quiet", "--depth", "1", "--no-tags", SOURCE, f"+refs/tags/{tag}:refs/tags/{tag}")[0] != 0:
            missing.append(tag)
    return missing


def show(tag, path):
    code, out, _ = git("show", f"{tag}:{path}")
    return out if code == 0 else ""


def changed(a, b, *paths):
    """The changed lines between two releases, as (file, "+" or "-", text)."""
    _, out, _ = git("diff", "--no-color", "--no-ext-diff", "--unified=0", a, b, "--", *paths)
    lines, file = [], None
    for line in out.splitlines():
        if line.startswith("+++ "):
            file = line[6:] if line.startswith("+++ b/") else file
        elif line.startswith("--- ") or line.startswith("@@"):
            continue
        elif line[:1] in "+-":
            lines.append((file, line[0], line[1:]))
    return lines


def found(tag, needles, paths=("src", "crates")):
    """Which of these strings Herdr's source at `tag` has."""
    if not needles:
        return set()
    args = ["grep", "-h", "-o", "-F"]
    for n in needles:
        args += ["-e", n]
    _, out, _ = git(*args, tag, "--", *paths)
    return set(out.splitlines()) & set(needles)


def code_only(lines):
    """Leaves out comment and blank lines."""
    return [t.strip() for t in lines if t.strip() and not t.strip().startswith(("*", "/*", "//", "*/"))]


EXPORT_NAME = re.compile(r"\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|namespace)\s+([A-Za-z_]\w*)")
MEMBER_NAME = re.compile(r"^(?:readonly\s+)?([A-Za-z_]\w*)\??\s*[:(<]")
FIELD_NAME = re.compile(r"^(?:pub(?:\([a-z]+\))?\s+)?(?:(?:struct|enum)\s+)?([A-Za-z_]\w*)")


def names(lines, *patterns, most=8):
    """The names these lines declare, the first `most` of them."""
    out = []
    for t in lines:
        for pattern in patterns:
            m = pattern.search(t.strip())
            if m:
                if m.group(1) not in out:
                    out.append(m.group(1))
                break
    return ", ".join(out[:most]) + (f" and {len(out) - most} more" if len(out) > most else "")


def exported(dts, name):
    return re.search(rf"\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|namespace)\s+{re.escape(name)}\b", dts) is not None


SCHEMA = re.compile(r"#\[serde|^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:struct|enum)\s|^\s*(?:pub(?:\([a-z]+\))?\s+)?[a-z_][a-z0-9_]*\s*:\s*[A-Za-z&\[<][^()=]*,?\s*$")


# Our side.

def our_mods():
    """Herdr's own mod names, and our mods' folders."""
    installed = read_json(APP_HOME / "installed.json") or {}
    shipped = {k for k in installed if ":" not in k}
    folder = APP_HOME / "mods"
    mods = sorted(p for p in folder.iterdir() if p.is_dir() and p.name not in shipped and not re.search(r"-edited(-\d+)?$", p.name)) if folder.is_dir() else []
    return shipped, mods


IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*[\"']herdr[\"']")
RUN = re.compile(r"\brun\(\s*[\"']([a-z][a-z0-9_-]*\.[a-z0-9_.-]*[a-z0-9_])[\"']")
LABEL = re.compile(r"[\"'](herdr\.[a-z0-9_.]*[a-z0-9_])[\"']")
COMMAND = re.compile(r"^([a-z][a-z0-9_-]*\.[a-z0-9_.-]*[a-z0-9_])(?::.*)?$")


def our_uses(mods, mod_names):
    """What our mods import from "herdr", the Herdr commands they and keys.json use, and Herdr's
    own labels they read or write: each with where it's used."""
    imports, commands, labels = {}, {}, {}
    for mod in mods:
        for f in sorted(mod.rglob("*.js")):
            if "node_modules" in f.parts:
                continue
            text = f.read_text(errors="replace")
            where = f"{mod.name}/{f.relative_to(mod)}"
            for m in IMPORT.finditer(text):
                for name in m.group(1).split(","):
                    name = name.strip().split(" as ")[0].strip()
                    if name:
                        imports.setdefault(name, where)
            for m in RUN.finditer(text):
                commands.setdefault(m.group(1), where)
            for m in LABEL.finditer(text):
                labels.setdefault(m.group(1), where)

    def walk(v):
        if isinstance(v, str):
            m = COMMAND.match(v)
            if m:
                commands.setdefault(m.group(1), "keys.json")
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(read_json(APP_HOME / "keys.json") or {})
    # A mod's own commands (my-tabs.close, agents.…) aren't Herdr's.
    commands = {c: w for c, w in commands.items() if c.split(".")[0] not in mod_names}
    return imports, commands, labels


def clones():
    """(our copy, Herdr's original as a path in its source) for each mod and layout we copied."""
    out = []
    for mod in our_mods()[1]:
        base = (read_json(mod / "mod.json") or {}).get("cloned_from") or {}
        if base.get("name"):
            out.append((mod.name, f"defaults/mods/{base['name']}/"))
    folder = APP_HOME / "layouts"
    for layout in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        base = (read_json(layout) or {}).get("cloned_from") or {}
        if isinstance(base, dict) and base.get("name"):
            out.append((layout.name, f"defaults/layouts/{base['name']}.json"))
    return out


# The checks.

def compare(old, new):
    a, b = f"v{old}", f"v{new}"
    print(f"\nHerdr {old} → {new}, from its source")
    missing = fetch_source(old, new)
    if missing:
        say("check", f"couldn't get Herdr's source at {', '.join(missing)} (github.com/herdrdev/herdr-app), so the app wasn't compared")
        return None

    path, pattern = CORE_GENERATION
    ga, gb = (re.search(pattern, show(t, path)) for t in (a, b))
    ga, gb = ga and ga.group(1), gb and gb.group(1)
    if ga != gb:
        say("stop", f"Herdr {new} needs a new generation of herdr-core ({ga} → {gb}).",
            ["Machines whose core carries our fixes (FIXES) need a build on the new generation first:",
             "Herdr would offer them its release, which lacks the fixes."])
    else:
        say("ok", f"same herdr-core generation ({gb})")
    min_a, min_b = show(a, CORE_MIN).strip(), show(b, CORE_MIN).strip()

    shipped, mods = our_mods()
    imports, commands, labels = our_uses(mods, shipped | {m.name for m in mods})

    api = changed(a, b, API)
    removed, added = code_only(t for _, s, t in api if s == "-"), code_only(t for _, s, t in api if s == "+")
    if removed:
        say("check", "the mod API changed, not only grew (herdr.d.ts lines removed or rewritten):", removed)
    else:
        say("ok", "the mod API only grew: " + (names(added, EXPORT_NAME, MEMBER_NAME) or "comments") if api else "the mod API is the same")
    old_dts, new_dts = show(a, API), show(b, API)
    gone = [f"{n} (imported in {w})" for n, w in imports.items() if exported(old_dts, n) and not exported(new_dts, n)]
    if gone:
        say("check", "names our mods import that Herdr no longer has:", gone)
    else:
        say("ok", f"the {len(imports)} names our mods import from herdr are all still there")

    needles = {**{f'"{c}"': (c, w) for c, w in commands.items()}, **{f'"{l}"': (l, w) for l, w in labels.items()}}
    before, after = found(a, list(needles)), found(b, list(needles))
    gone = [f"{needles[n][0]} (used in {needles[n][1]})" for n in sorted(before - after)]
    if gone:
        say("check", "commands or labels our setup uses that Herdr no longer has:", gone)
    else:
        say("ok", f"the {len(before)} Herdr commands and labels our mods and keys.json use are all still there")

    glow = APP_HOME / "mods/my-tabs/glow.js"
    if glow.exists():
        geometry = changed(a, b, GEOMETRY)
        if geometry:
            say("check", f"Herdr's pane layout code changed ({GEOMETRY}): ⌘G's halo copies it (my-tabs/glow.js), so check it still lines up",
                [f"{s} {t.strip()}" for _, s, t in geometry if t.strip()])
        else:
            say("ok", "Herdr's pane layout code is the same: ⌘G's halo still lines up")
        path, pattern = OVERLAY_KEEP
        theirs = re.search(pattern, show(b, path))
        ours = re.search(r"const KEEP = ([\d.]+)", glow.read_text())
        if not theirs:
            say("check", f"couldn't find how much of a window overlay Herdr keeps on screen ({path}); glow.js assumes {ours and ours.group(1)} px")
        elif ours and float(theirs.group(1)) != float(ours.group(1)):
            say("check", f"Herdr now keeps {theirs.group(1)} px of a window overlay on screen; glow.js assumes {ours.group(1)} (its KEEP)")

    formats = [(f, s, t) for f, s, t in changed(a, b, *LAYOUT_FORMATS) if SCHEMA.search(t)]
    removed = [f"{f}: {t.strip()}" for f, s, t in formats if s == "-"]
    if removed:
        say("check", "the layout formats changed (my-tabs/layoutdoc.js rewrites tab documents; my-main.json is a layout):",
            [f"{f}: {s} {t.strip()}" for f, s, t in formats])
    else:
        added = names((t for _, s, t in formats if s == "+" and not t.strip().startswith("#")), FIELD_NAME)
        say("ok", "the layout formats only gained: " + added if added else "the layout formats are the same")

    upstream, copies = [], clones()
    for copy, original in copies:
        _, out, _ = git("diff", "--numstat", a, b, "--", original)
        plus = sum(int(l.split()[0]) for l in out.splitlines() if l.split()[0].isdigit())
        minus = sum(int(l.split()[1]) for l in out.splitlines() if l.split()[1].isdigit())
        if plus or minus:
            upstream.append(f"{original.split('/')[-2] if original.endswith('/') else original.split('/')[-1]} (+{plus} −{minus}): your {copy}")
    if upstream:
        say("note", "Herdr changed its own versions of mods we copied; our copies don't get that:", upstream)
    elif copies:
        say("ok", "Herdr's versions of the mods we copied didn't change")
    return min_b


def fixes_released(core_latest):
    """Whether every FIXES pull request is in the latest herdr-core release: True, False, or None
    when it can't tell. Says which."""
    repo, prs = FIXES
    if not prs:
        return True
    if not shutil.which("gh"):
        say("note", f"couldn't look up {repo} " + ", ".join(f"#{n}" for n in prs) + " (no gh)")
        return None
    latest = core_latest and core_latest.get("version")
    waiting = []
    for n in prs:
        code, out, _ = sh("gh", "pr", "view", str(n), "--repo", repo, "--json", "state,mergeCommit")
        info = json.loads(out) if code == 0 and out.strip() else None
        if not info:
            say("note", f"couldn't look up {repo} #{n}")
            return None
        if info.get("state") != "MERGED":
            waiting.append(f"#{n} {info.get('state', '?').lower()}")
            continue
        sha = (info.get("mergeCommit") or {}).get("oid")
        _, out, _ = sh("gh", "api", f"repos/{repo}/compare/{sha}...v{latest}", "--jq", ".status")
        if out.strip() not in ("ahead", "identical"):
            waiting.append(f"#{n} merged, not yet in {latest}")
    if waiting:
        say("note", f"our herdr-core fixes aren't all released yet ({', '.join(waiting)})")
        return False
    say("note", f"our herdr-core fixes ({', '.join(f'#{n}' for n in prs)}) are all in herdr-core {latest}: "
        "the machines can take plain releases again, and FIXES in update-check.py can be emptied")
    return True


def machines_section(mac, ms, core_latest, core_min=None):
    print("\nYour machines")
    if ms is None:
        say("note", "couldn't list them (hc machine ls)")
        return
    released = fixes_released(core_latest)
    down = [m["name"] for m in ms if not m.get("version")]
    if down:
        say("note", "not connected now, so not checked: " + ", ".join(down))
    up = [m for m in ms if m.get("version")]
    if core_min:
        below = [f"{m['name']} {m['version']}" for m in up if ver(m["version"]) < ver(core_min)]
        if below:
            say("check", f"Herdr's new version wants herdr-core {core_min} or newer, which these don't run:", below)
    older = [f"{m['name']} {m['version']}" for m in up if ver(m["version"]) < ver(mac)]
    if not older:
        say("ok", f"all {len(up)} run herdr-core {mac} or newer, so Settings → Machines offers no Update")
    elif released:
        say("note", f"older than this Mac's {mac}: {', '.join(older)}. Settings → Machines offers Update for them, and that's fine now")
    else:
        say("warn", f"Settings → Machines will offer Update for {', '.join(n.split()[0] for n in older)}: skip it where herdr-core is our patched build",
            [f"they run {', '.join(older)}, older than this Mac's {mac}; Update would put a release without the fixes there"])


def backup_section():
    print("\nYour config in this repo")
    if not (REPO / "paths.sh").exists():
        say("note", f"{REPO} has no paths.sh, so not checked")
        return
    _, out, _ = sh("bash", "-c", 'source ./paths.sh; printf "%s\\n" "${ITEMS[@]}" "--" "${SKIP[@]}"', cwd=REPO)
    items, _, skip = out.partition("\n--\n")
    skip = skip.split()
    excludes = [skip[i + 1].strip("/").split("/")[-1] for i, x in enumerate(skip[:-1]) if x == "--exclude"]
    differ = []
    for item in items.splitlines():
        here, _, live = item.partition("|")
        if not live or not os.path.exists(live):
            continue
        if os.path.isdir(live):
            args = [x for e in excludes for x in ("-x", e)]
            code = sh("diff", "-rq", *args, live, str(REPO / here))[0]
        else:
            code = sh("cmp", "-s", live, str(REPO / here))[0]
        if code != 0:
            differ.append(here)
    _, dirty, _ = sh("git", "status", "--porcelain", cwd=REPO)
    _, ahead, _ = sh("git", "rev-list", "--count", "@{u}..HEAD", cwd=REPO)
    if differ:
        say("check", f"the live config has changes this repo doesn't: save them first ({REPO}/save.sh)", differ)
    elif dirty.strip() or ahead.strip() not in ("", "0"):
        say("note", "this repo has changes not yet committed or pushed")
    else:
        say("ok", "this repo has all of it, committed and pushed")


def herdr_status():
    _, out, _ = sh("herdr-app", "status")
    try:
        return json.loads(out)
    except ValueError:
        return None


def snapshot(app, status):
    """What --after compares with: the API files Herdr writes, its errors, the mods and layouts."""
    SNAP.mkdir(parents=True, exist_ok=True)
    for name in ("herdr.d.ts", "gpui-kit.d.ts"):
        if (APP_HOME / name).exists():
            shutil.copyfile(APP_HOME / name, SNAP / name)
    listing = {d: sorted(p.name for p in (APP_HOME / d).iterdir()) for d in ("mods", "layouts") if (APP_HOME / d).is_dir()}
    (SNAP / "state.json").write_text(json.dumps({"app": app, "errors": (status or {}).get("errors"), **listing}, indent=1))


def before(bundle, running, waiting, app_latest, core_latest, core, ms):
    print("Herdr update check: before the restart\n")
    new, how = waiting, "downloaded: Restart in the update pill puts it in"
    if not new and app_latest and ver(app_latest.get("version")) > ver(running):
        new, how = app_latest["version"], "not downloaded yet"
    print(f"  Herdr       {running}" + (f" → {new} ({how})" if new else " (the latest)"))
    generation = core_latest and core_latest.get("generation")
    core_next = core_latest["version"] if core_latest and ver(core_latest.get("version")) > ver(core) else None
    print(f"  herdr-core  this Mac {core}" + (f" → {core_next} (generation {generation}; Herdr updates it, terminals keep running)" if core_next else " (the latest)"))
    if not new and not core_next:
        return False
    core_min = compare(running, new) if new else None
    machines_section(core_next or core, ms, core_latest, core_min)
    backup_section()
    print("\nHerdr now")
    status = herdr_status()
    if status is None:
        say("note", "Herdr isn't running (herdr-app status), so --after has nothing to compare its errors with")
    elif status.get("errors"):
        say("note", "mod errors already now, before the update:", [json.dumps(e)[:160] for e in status["errors"]])
    else:
        say("ok", "no mod errors now")
    snapshot(running, status)
    return True


def after(bundle, running, waiting, core_latest, core, ms):
    print("Herdr update check: after the restart\n")
    snap = read_json(SNAP / "state.json") or {}
    if waiting and ver(waiting) > ver(running):
        say("check", f"Herdr is still {running}: restart into {waiting} (Restart in the update pill), then run this again")
    else:
        say("ok", f"Herdr {running}" + (f" (was {snap['app']})" if snap.get("app") and snap["app"] != running else ""))
    latest = core_latest and core_latest.get("version")
    if latest and ver(latest) > ver(core):
        say("note", f"this Mac's herdr-core is still {core} ({latest} is out): Herdr updates it a moment after its first start, so run this again in a minute")
    else:
        say("ok", f"this Mac's herdr-core is {core}")

    status = herdr_status()
    if status is None:
        say("check", "Herdr isn't answering (herdr-app status)")
    else:
        new = [e for e in status.get("errors") or [] if e not in (snap.get("errors") or [])]
        if new:
            say("check", "Herdr reports mod errors" + (" it didn't before:" if snap else ":"), [json.dumps(e)[:160] for e in new])
        else:
            say("ok", "no new mod errors")

    _, mods = our_mods()
    broken = []
    for mod in mods:
        _, out, err = sh("herdr-app", "check", str(mod), timeout=60)
        if "check passed" not in out + err:
            why = [l for l in (out + err).splitlines() if l.strip() and not l.lstrip().startswith("WARN")]
            broken.append(f"{mod.name}: {' / '.join(why[:2])}")
    if broken:
        say("check", "these mods don't load:", broken)
    else:
        say("ok", f"all {len(mods)} of our mods load")

    for name in ("herdr.d.ts", "gpui-kit.d.ts"):
        old, now = SNAP / name, APP_HOME / name
        if not old.exists() or not now.exists():
            continue
        lines = list(difflib.unified_diff(old.read_text().splitlines(), now.read_text().splitlines(), lineterm="", n=0))
        lines = [l for l in lines if l[:1] in "+-" and not l.startswith(("+++", "---"))]
        removed = code_only(l[1:] for l in lines if l[0] == "-")
        if removed:
            say("check", f"{name} lost or rewrote lines (our mods may use them):", removed)
        else:
            say("ok", f"{name}: " + ("only additions" if lines else "unchanged"))

    if not snap:
        say("note", "no run from before the restart to compare with, so the API files weren't compared")
    moved = [f"{d}/{n}" for d in ("mods", "layouts") if (APP_HOME / d).is_dir()
             for n in sorted(p.name for p in (APP_HOME / d).iterdir())
             if "-edited" in n and n not in (snap.get(d) or [])]
    if moved:
        say("note", "Herdr found its own mods or layouts edited and moved them aside, edits and all:", moved)
    machines_section(core, ms, core_latest)


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, text):
        for s in self.streams:
            s.write(text)
        return len(text)

    def flush(self):
        for s in self.streams:
            s.flush()


def keep_report(mode):
    """What this run prints goes to CACHE/report-<mode>.txt too, for --show."""
    CACHE.mkdir(parents=True, exist_ok=True)
    f = open(CACHE / f"report-{mode}.txt", "w")
    f.write(f"herdr-update-check{' --after' if mode == 'after' else ''}, {time.strftime('%Y-%m-%d %H:%M')}\n\n")
    sys.stdout = Tee(sys.stdout, f)


def main():
    parser = argparse.ArgumentParser(description="Is the Herdr update waiting safe for this setup? (see the top of this file)")
    parser.add_argument("--after", action="store_true", help="check after restarting into the update")
    parser.add_argument("--from", dest="old", help="compare two Herdr releases: this one…")
    parser.add_argument("--to", dest="new", help="…and this one")
    parser.add_argument("--show", choices=("before", "after"), help="print the last report (in a terminal, then stay as a shell)")
    args = parser.parse_args()

    if args.show:
        report = CACHE / f"report-{args.show}.txt"
        print(report.read_text() if report.exists() else "No report yet: herdr-update-check hasn't run.")
        if sys.stdin.isatty() and sys.stdout.isatty():
            sys.stdout.flush()
            os.chdir(REPO)
            shell = os.environ.get("SHELL") or "/bin/zsh"
            os.execvp(shell, [shell, "-l"])
        return

    if args.old or args.new:
        if not (args.old and args.new):
            parser.error("--from and --to go together")
        compare(args.old.lstrip("v"), args.new.lstrip("v"))
        print("\n→ " + ("Nothing in the way." if WORST == 0 else "Look at the CHECK lines." if WORST == 1 else "Not without the STOP lines sorted out."))
        sys.exit(WORST)

    bundle = app_bundle()
    if not bundle:
        sys.exit("Herdr.app not found (herdr-app isn't on PATH, and it's not in ~/Applications or /Applications)")
    running, waiting = app_version(bundle), downloaded(bundle)
    core, ms = mac_core(), machines()
    core_latest = release("core")
    keep_report("after" if args.after else "before")
    if args.after:
        after(bundle, running, waiting, core_latest, core, ms)
        print("\n→ " + ("All good." if WORST == 0 else "Look at the CHECK lines." if WORST == 1 else "See the STOP lines."))
    else:
        if not before(bundle, running, waiting, release("app"), core_latest, core, ms):
            print("\n→ Nothing is waiting.")
        elif WORST == 0:
            print("\n→ Fine to restart (Restart in the update pill). Afterwards: herdr-update-check --after")
        else:
            print("\n→ " + ("Look at the CHECK lines before restarting." if WORST == 1 else "Don't restart yet: see the STOP lines."))
    sys.stdout.flush()
    sys.exit(WORST)


if __name__ == "__main__":
    main()
