#!/usr/bin/env python3
from __future__ import annotations

import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADD_SCRIPT = ROOT / "agent-plugin/shared/add-artifact-site.py"
ARTIFACT_MD = ROOT / "agent-plugin/shared/artifact-md"
MCP_SCRIPT = ROOT / "agent-plugin/shared/artifact-site-mcp"


class ArtifactSiteIntegrationTest(unittest.TestCase):
    def test_add_artifact_site_idempotent_across_all_three_agents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = pathlib.Path(tmp)
            (home / ".claude").mkdir()
            (home / ".codex").mkdir()
            (home / ".gemini/antigravity-cli").mkdir(parents=True)
            (home / ".config/artifact-site").mkdir(parents=True)
            (home / ".config/artifact-site/config.json").write_text(
                json.dumps({"baseUrl": "https://yours.lexmount.com/artifact-site"}),
                encoding="utf-8",
            )
            (home / ".claude/settings.json").write_text(
                json.dumps({"permissions": {"allow": ["Bash(git push:*)"]}}),
                encoding="utf-8",
            )
            (home / ".claude/CLAUDE.md").write_text("# Existing rule\n\nKeep me.\n", encoding="utf-8")
            (home / ".codex/config.toml").write_text('model = "o3"\n', encoding="utf-8")

            env = {**os.environ, "HOME": str(home), "CODEX_HOME": str(home / ".codex")}
            env.pop("ARTIFACT_SITE_URL", None)
            env.pop("ARTIFACT_SITE_CONFIG_DIR", None)

            r1 = subprocess.run(["python3", str(ADD_SCRIPT)], env=env, capture_output=True, text=True, check=True)
            self.assertIn("Claude Code:", r1.stdout)
            self.assertIn("Codex:", r1.stdout)
            self.assertIn("agy:", r1.stdout)

            cc_json = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
            self.assertEqual(
                cc_json["mcpServers"]["artifact-site"]["command"],
                str(home / ".local/bin/artifact-site-mcp"),
            )
            st = json.loads((home / ".claude/settings.json").read_text(encoding="utf-8"))
            self.assertIn("Artifact", st["permissions"]["deny"])
            self.assertIn("mcp__artifact-site__*", st["permissions"]["allow"])
            self.assertIn("# Existing rule", (home / ".claude/CLAUDE.md").read_text(encoding="utf-8"))
            self.assertIn("# Unified Artifacts", (home / ".claude/CLAUDE.md").read_text(encoding="utf-8"))
            self.assertIn("[mcp_servers.artifact-site]", (home / ".codex/config.toml").read_text(encoding="utf-8"))
            agy_mcp = json.loads((home / ".gemini/config/mcp_config.json").read_text(encoding="utf-8"))
            self.assertIn("artifact-site", agy_mcp["mcpServers"])

            # Second run must be a complete no-op (no stdout, no extra .bak files).
            baks_before = list(home.rglob("*.bak-*"))
            r2 = subprocess.run(["python3", str(ADD_SCRIPT)], env=env, capture_output=True, text=True, check=True)
            self.assertEqual(r2.stdout.strip(), "")
            self.assertEqual(list(home.rglob("*.bak-*")), baks_before)

    def test_codex_tables_after_its_section_stay(self) -> None:
        # Its [mcp_servers.artifact-site] is rewritten in place: what follows it (other tables, a
        # comment above one, a sub-table of its own) stays, and a key past a blank line inside it goes.
        with tempfile.TemporaryDirectory() as tmp:
            home = pathlib.Path(tmp)
            (home / ".codex").mkdir()
            (home / ".config/artifact-site").mkdir(parents=True)
            (home / ".config/artifact-site/config.json").write_text(
                json.dumps({"baseUrl": "https://yours.lexmount.com/artifact-site"}), encoding="utf-8"
            )
            new = (
                "[mcp_servers.artifact-site]\ncommand = "
                + json.dumps(str(home / ".local/bin/artifact-site-mcp"))
                + "\nargs = []\n"
            )
            cases = [
                ("[tui]\ntheme = \"t\"\n\n# trust\n[hooks.state.\"h:stop:0:0\"]\ntrusted_hash = \"sha256:0\"\n", "\n"),
                ("[mcp_servers.artifact-site.env]\nK = \"v\"\n", ""),
            ]
            env = {**os.environ, "HOME": str(home), "CODEX_HOME": str(home / ".codex")}
            env.pop("ARTIFACT_SITE_URL", None)
            env.pop("ARTIFACT_SITE_CONFIG_DIR", None)
            for rest, gap in cases:
                (home / ".codex/config.toml").write_text(
                    'model = "o3"\n\n[mcp_servers.artifact-site]\ncommand = "/old"\n\nargs = ["x"]\n' + gap + rest,
                    encoding="utf-8",
                )
                subprocess.run(["python3", str(ADD_SCRIPT)], env=env, capture_output=True, text=True, check=True)
                self.assertEqual(
                    (home / ".codex/config.toml").read_text(encoding="utf-8"), 'model = "o3"\n\n' + new + gap + rest
                )

    def test_artifact_md_render(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            md = pathlib.Path(tmp) / "doc.md"
            out = pathlib.Path(tmp) / "doc.html"
            md.write_text("# Hello Title\n\n> [!NOTE]\n> Body </script> safe\n", encoding="utf-8")
            subprocess.run(["python3", str(ARTIFACT_MD), "render", str(md), "-o", str(out)], check=True)
            rendered = out.read_text(encoding="utf-8")
            self.assertIn("<title>Hello Title</title>", rendered)
            self.assertIn("<\\/script>", rendered)

    def test_pure_python_mcp_relay_fallback(self) -> None:
        seen_headers: list[dict] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                seen_headers.append(dict(self.headers))
                if "id" not in body:
                    self.send_response(202)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Mcp-Session-Id", "sess-123")
                self.end_headers()
                reply = {"jsonrpc": "2.0", "id": body["id"], "result": {"ok": True, "method": body["method"]}}
                self.wfile.write(json.dumps(reply).encode("utf-8"))

            def log_message(self, *args: object) -> None:
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        port = srv.server_address[1]
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                cfg = pathlib.Path(tmp) / "artifact-site"
                (cfg / "tokens").mkdir(parents=True)
                base_url = f"http://127.0.0.1:{port}/artifact-site"
                (cfg / "config.json").write_text(json.dumps({"baseUrl": base_url}), encoding="utf-8")
                (cfg / "tokens" / f"127.0.0.1_{port}").write_text("tok_test_secret", encoding="utf-8")

                env = {
                    **os.environ,
                    "ARTIFACT_SITE_CONFIG_DIR": str(cfg),
                    "ARTIFACT_SITE_FORCE_PY_MCP": "1",
                }
                env.pop("ARTIFACT_SITE_URL", None)
                env.pop("ARTIFACT_SITE_TOKEN", None)

                proc = subprocess.Popen(
                    ["python3", str(MCP_SCRIPT)],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                )
                assert proc.stdin and proc.stdout
                proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize"}) + "\n")
                proc.stdin.flush()
                line1 = json.loads(proc.stdout.readline())
                self.assertEqual(line1["result"]["method"], "initialize")

                proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
                proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n")
                proc.stdin.flush()
                line2 = json.loads(proc.stdout.readline())
                proc.stdin.close()
                proc.stdout.close()
                if proc.stderr:
                    proc.stderr.close()
                proc.wait(timeout=5)

                self.assertEqual(line2["result"]["method"], "tools/list")
                self.assertEqual(seen_headers[0].get("Authorization"), "Bearer tok_test_secret")
                self.assertEqual(seen_headers[2].get("Mcp-Session-Id"), "sess-123")
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
