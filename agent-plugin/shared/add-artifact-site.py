"""Wires Yours (artifact-site) across Claude Code, Codex and Antigravity (agy):

- MCP server `artifact-site` pointing at ~/.local/bin/artifact-site-mcp (in ~/.claude.json,
  ~/.codex/config.toml and ~/.gemini/config/mcp_config.json, each only where that agent's
  config folder already exists).
- Claude Code's ~/.claude/settings.json: denies the built-in claude.ai `Artifact` tool so
  sessions never fall back to account-locked claude.ai pages, and allows `mcp__artifact-site__*`,
  `Bash(artifact-site:*)` and `Bash(artifact-md:*)`.
- Unified routing & authoring section in ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and
  ~/.gemini/GEMINI.md (where each agent's folder exists).

install.sh runs it here, and on another machine through `hc exec --on <m> -i -- python3 -`.
Idempotent: leaves a <file>.bak-<time> copy only when a file actually changes, and stores no
tokens or emails in the repo.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time

HOME = os.path.expanduser("~")
MCP_CMD = os.path.join(HOME, ".local", "bin", "artifact-site-mcp")
MARKER = "# Unified Artifacts (`Yours` / `artifact-site`)"


def _configured_base() -> str:
    env_url = os.environ.get("ARTIFACT_SITE_URL") or os.environ.get("ARTIFACT_HUB_URL")
    if env_url:
        return env_url.strip().rstrip("/")
    cfg_dir = os.environ.get("ARTIFACT_SITE_CONFIG_DIR") or os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config"),
        "artifact-site",
    )
    try:
        with open(os.path.join(cfg_dir, "config.json"), encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("baseUrl"), str) and data["baseUrl"].strip():
            return data["baseUrl"].strip().rstrip("/")
    except Exception:
        pass
    return "https://yours.lexmount.com/artifact-site"


def _rule_block(base_url: str) -> str:
    return f"""{MARKER}

Claude (every `/auth` account), Codex, and Antigravity (`agy`) share **one** Artifact workspace at `{base_url}` (authenticated via `~/.config/artifact-site`). Claude's built-in `Artifact` tool is disabled — never publish to `claude.ai`.

- **When to use**: whenever the user asks for an artifact, interactive page, dashboard, visual report, walkthrough, or gives a `{base_url}/s/<slug>` (or `/v/<token>`) link. Read `~/.agents/skills/artifact-site/SKILL.md` for full details.
- **How to write & publish (same feel as native Artifacts)**:
  - **Markdown docs / specs / PR reviews** (supports GFM tables, `[!NOTE]` callouts, code highlight, `$math$`, and `mermaid` diagrams): write a `.md` file and run:
    - Create: `artifact-md publish <file.md> --title "<Title>"`
    - Update in-place (keeps exact same URL): `artifact-md update <slug-or-url> <file.md>`
  - **Interactive UI / charts / dashboards / React**: write a self-contained `index.html` (Tailwind, React/ESM via `esm.sh`, Chart.js, Lucide, Mermaid from CDN all work in the sandbox; or build multi-file static `dist/` for larger apps) and run:
    - Create: `artifact-site publish <index.html-or-dir> --title "<Title>"`
    - Update in-place (same URL): get `versionId` (`ver_...`) via `artifact-site info <slug> --json`, then `artifact-site edit <slug> <file.html> --file index.html --expected-version <ver_...>` (single HTML) or `artifact-site update <slug> <dir> --expected-version <ver_...>` (folder) — or use the `artifact-site` MCP tools (`artifact_site_*`).
  - **PDF / DOCX / PPTX**: `artifact-site publish <file> --title "<Title>"`.
- **Sharing & comments**: new works default to `private` (immediately visible to the user's browser and all local agents across every account). Only run `artifact-site visibility <slug> unlisted` when asked to share externally. Read inline page comments with `artifact-site comments list <slug> --json`.
"""


def _keep(path: str) -> None:
    if os.path.exists(path):
        shutil.copy2(path, f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}")


def _load_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read().strip()
            return json.loads(raw) if raw else {}
    except FileNotFoundError:
        return {}


def _save_json(path: str, data: dict, mode: int | None = None) -> None:
    _keep(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if mode is not None:
        os.chmod(tmp, mode)
    os.replace(tmp, path)


def _ensure_rule_section(md_path: str, block: str) -> bool:
    try:
        with open(md_path, encoding="utf-8") as f:
            cur = f.read()
    except FileNotFoundError:
        cur = ""

    if MARKER in cur:
        prefix = cur[: cur.index(MARKER)].rstrip()
        # Preserve any subsequent unrelated top-level `# ` section after Unified Artifacts.
        rest = cur[cur.index(MARKER) + len(MARKER) :]
        next_h1 = re.search(r"\n# (?!Unified Artifacts)", rest)
        suffix = "\n" + rest[next_h1.start() + 1 :] if next_h1 else ""
        sep = "\n\n" if prefix else ""
        updated = prefix + sep + block.rstrip() + ("\n" + suffix if suffix else "\n")
    else:
        sep = "\n\n" if cur.strip() else ""
        updated = cur.rstrip() + sep + block.rstrip() + "\n"

    if updated == cur:
        return False
    _keep(md_path)
    os.makedirs(os.path.dirname(md_path), exist_ok=True)
    tmp = md_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(updated)
    os.replace(tmp, md_path)
    return True


def setup_claude(block: str) -> None:
    claude_dir = os.path.join(HOME, ".claude")
    claude_json = os.path.join(HOME, ".claude.json")
    if not os.path.isdir(claude_dir) and not os.path.exists(claude_json):
        return

    changed: list[str] = []

    cc = _load_json(claude_json)
    desired_mcp = {"type": "stdio", "command": MCP_CMD, "args": [], "env": {}}
    if cc.get("mcpServers", {}).get("artifact-site") != desired_mcp:
        cc.setdefault("mcpServers", {})["artifact-site"] = desired_mcp
        _save_json(claude_json, cc)
        changed.append("~/.claude.json")

    settings_path = os.path.join(claude_dir, "settings.json")
    st = _load_json(settings_path)
    st_before = json.dumps(st, sort_keys=True)
    perms = st.setdefault("permissions", {})
    deny = perms.setdefault("deny", [])
    if "Artifact" not in deny:
        deny.append("Artifact")
    allow = perms.setdefault("allow", [])
    for rule in ("mcp__artifact-site__*", "Bash(artifact-site:*)", "Bash(artifact-md:*)"):
        if rule not in allow:
            allow.append(rule)
    if json.dumps(st, sort_keys=True) != st_before:
        _save_json(settings_path, st)
        changed.append("~/.claude/settings.json")

    if _ensure_rule_section(os.path.join(claude_dir, "CLAUDE.md"), block):
        changed.append("~/.claude/CLAUDE.md")

    if changed:
        print("Claude Code: artifact-site configured in " + ", ".join(changed))


def _update_codex_toml(text: str, cmd: str) -> str:
    section = f'[mcp_servers.artifact-site]\ncommand = {json.dumps(cmd)}\nargs = []\n'
    pattern = re.compile(
        r"(?ms)^\[mcp_servers\.(?:\"artifact-site\"|artifact-site)\]\n(?:^(?!\[).*\n?)*"
    )
    if pattern.search(text):
        return pattern.sub(section, text, count=1)
    sep = "" if not text or text.endswith("\n") else "\n"
    extra_nl = "\n" if text.strip() else ""
    return text + sep + extra_nl + section


def setup_codex(block: str) -> None:
    codex_home = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
    if not os.path.isdir(codex_home):
        return

    changed: list[str] = []
    toml_path = os.path.join(codex_home, "config.toml")
    try:
        with open(toml_path, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        text = ""

    new_text = _update_codex_toml(text, MCP_CMD)
    if new_text != text:
        _keep(toml_path)
        tmp = toml_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new_text)
        os.replace(tmp, toml_path)
        changed.append(f"{toml_path}")

    if _ensure_rule_section(os.path.join(codex_home, "AGENTS.md"), block):
        changed.append(os.path.join(codex_home, "AGENTS.md"))

    if changed:
        print("Codex: artifact-site configured in " + ", ".join(changed))


def setup_antigravity(block: str) -> None:
    gemini_dir = os.path.join(HOME, ".gemini")
    if not os.path.isdir(os.path.join(gemini_dir, "antigravity-cli")):
        return

    changed: list[str] = []
    mcp_path = os.path.join(gemini_dir, "config", "mcp_config.json")
    mcp_cfg = _load_json(mcp_path)
    desired = {"command": MCP_CMD, "args": []}
    if mcp_cfg.get("mcpServers", {}).get("artifact-site") != desired:
        mcp_cfg.setdefault("mcpServers", {})["artifact-site"] = desired
        _save_json(mcp_path, mcp_cfg, 0o644)
        changed.append(mcp_path)

    if _ensure_rule_section(os.path.join(gemini_dir, "GEMINI.md"), block):
        changed.append(os.path.join(gemini_dir, "GEMINI.md"))

    if changed:
        print("agy: artifact-site configured in " + ", ".join(changed))


def main() -> None:
    block = _rule_block(_configured_base())
    setup_claude(block)
    setup_codex(block)
    setup_antigravity(block)


if __name__ == "__main__":
    main()
