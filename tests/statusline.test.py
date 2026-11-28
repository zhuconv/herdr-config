"""The status lines: the scripts that set them (agent-plugin/*/add-statusline.py), run against a
made-up home folder, and the two status line scripts, fed what Claude Code and agy pass them.

  python3 tests/statusline.test.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, "agent-plugin")


def run(script, home, *args):
    env = {k: v for k, v in os.environ.items() if k != "CODEX_HOME"}
    env["HOME"] = home
    return subprocess.run([sys.executable, script, *args], env=env, capture_output=True, text=True,
                          check=True).stdout


def read(path):
    with open(path) as f:
        return f.read()


def write(path, text, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    os.chmod(path, mode)


def backups(path):
    return [n for n in os.listdir(os.path.dirname(path)) if n.startswith(os.path.basename(path) + ".bak-")]


class Home(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.home)


class JsonStatusLine:
    """What the Claude Code and agy scripts share: statusLine set once, the rest kept."""
    script = path = command = None

    def at(self):
        return os.path.join(self.home, self.path)

    def test_adds_it_and_keeps_the_rest(self):
        write(self.at(), json.dumps({"model": "m", "hooks": {"Stop": []}}), 0o600)
        run(self.script, self.home)
        settings = json.loads(read(self.at()))
        self.assertEqual(settings["statusLine"], {"type": "command", "command": self.command})
        self.assertEqual((settings["model"], settings["hooks"]), ("m", {"Stop": []}))
        self.assertEqual(os.stat(self.at()).st_mode & 0o777, 0o600)
        self.assertEqual(len(backups(self.at())), 1)

    def test_twice_changes_nothing(self):
        write(self.at(), "{}")
        run(self.script, self.home)
        self.assertEqual(run(self.script, self.home), "")
        self.assertEqual(len(backups(self.at())), 1)

    def test_keeps_a_status_line_of_your_own(self):
        own = {"type": "command", "command": "npx ccstatusline"}
        write(self.at(), json.dumps({"statusLine": own}))
        self.assertIn("of its own, kept", run(self.script, self.home))
        self.assertEqual(json.loads(read(self.at()))["statusLine"], own)
        self.assertEqual(backups(self.at()), [])


class Claude(JsonStatusLine, Home):
    script = os.path.join(PLUGIN, "claude", "add-statusline.py")
    path = ".claude/settings.json"
    command = 'bash "$HOME/.claude/statusline.sh"'

    def test_no_settings_yet(self):
        run(self.script, self.home)
        self.assertEqual(json.loads(read(self.at()))["statusLine"]["command"], self.command)


class Antigravity(JsonStatusLine, Home):
    script = os.path.join(PLUGIN, "antigravity", "add-statusline.py")
    path = ".gemini/antigravity-cli/settings.json"
    command = 'bash "$HOME/.config/antigravity/statusline.sh"'

    def test_nothing_where_agy_never_ran(self):
        run(self.script, self.home)
        self.assertFalse(os.path.exists(os.path.join(self.home, ".gemini")))

    def test_new_settings_are_private(self):
        os.makedirs(os.path.dirname(self.at()))
        run(self.script, self.home)
        self.assertEqual(os.stat(self.at()).st_mode & 0o777, 0o600)


KEYS = ('status_line = ["model", "context-used", "project-name", "git-branch", "reasoning", "weekly-limit"]\n'
        'status_line_use_colors = true\n'
        'theme = "catppuccin-mocha"\n')


class Codex(Home):
    def setUp(self):
        super().setUp()
        plugin = os.path.join(self.home, "plugin")  # a copy, so that --save writes its own tui.toml
        os.makedirs(plugin)
        for name in ("add-statusline.py", "tui.toml"):
            shutil.copy(os.path.join(PLUGIN, "codex", name), plugin)
        self.script = os.path.join(plugin, "add-statusline.py")
        self.tui = os.path.join(plugin, "tui.toml")
        self.config = os.path.join(self.home, ".codex", "config.toml")

    def test_the_repo_keeps_these_keys(self):
        self.assertTrue(read(os.path.join(PLUGIN, "codex", "tui.toml")).endswith("[tui]\n" + KEYS))

    def test_nothing_where_codex_never_ran(self):
        run(self.script, self.home)
        self.assertFalse(os.path.exists(os.path.join(self.home, ".codex")))

    def test_sets_its_keys_and_leaves_the_rest(self):
        rest = '\n[mcp_servers.docs]\nurl = "https://example.com/mcp"\nenv = { TOKEN = "t" }\n'
        write(self.config, 'model = "m"\n\n[tui]\nstatus_line = [\n  "model",\n  "git-branch",\n]\n'
                           'sidebar_width_percent = 28\ntheme = "dracula"  # from /theme\n' + rest, 0o600)
        self.assertIn("status line and theme set", run(self.script, self.home))
        self.assertEqual(read(self.config), 'model = "m"\n\n[tui]\nstatus_line_use_colors = true\n'
                         'status_line = ["model", "context-used", "project-name", "git-branch", "reasoning", '
                         '"weekly-limit"]\nsidebar_width_percent = 28\ntheme = "catppuccin-mocha"\n' + rest)
        self.assertEqual(os.stat(self.config).st_mode & 0o777, 0o600)
        self.assertEqual(run(self.script, self.home), "")
        self.assertEqual(len(backups(self.config)), 1)

    def test_adds_a_tui_table(self):
        write(self.config, 'model = "m"\n\n[projects."/work"]\ntrust_level = "trusted"')
        run(self.script, self.home)
        self.assertEqual(read(self.config), 'model = "m"\n\n[projects."/work"]\ntrust_level = "trusted"\n'
                         '\n[tui]\n' + KEYS)

    def test_no_config_yet(self):
        os.makedirs(os.path.dirname(self.config))
        run(self.script, self.home)
        self.assertEqual(read(self.config), "[tui]\n" + KEYS)

    def test_save_copies_its_keys_back(self):
        write(self.config, '[tui]\ntheme = "dracula"\nstatus_line_use_colors = false\nsidebar_width_percent = 28\n')
        before = read(self.tui)
        self.assertIn("copied into", run(self.script, self.home, "--save"))
        self.assertEqual(read(self.tui), before.replace('theme = "catppuccin-mocha"', 'theme = "dracula"')
                         .replace("status_line_use_colors = true", "status_line_use_colors = false"))
        self.assertEqual(run(self.script, self.home, "--save"), "")


def plain(text):
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


class Scripts(Home):
    def show(self, script, given):
        env = dict(os.environ, HOME=self.home)
        return plain(subprocess.run(["bash", os.path.join(PLUGIN, script)], input=json.dumps(given), env=env,
                                    capture_output=True, text=True, check=True).stdout)

    def test_claude(self):
        line = self.show("claude/statusline.sh", {
            "model": {"display_name": "Opus"}, "cwd": self.home,
            "context_window": {"context_window_size": 200000, "current_usage": {"input_tokens": 50000}},
            "rate_limits": {"seven_day": {"used_percentage": 42, "resets_at": 1796000000}}})
        self.assertTrue(line.startswith("Opus │ ✍️ 25% │ "), line)
        self.assertIn("weekly ●●●●○○○○○○ 42%", line)

    def test_antigravity_shows_the_weekly_limit_of_the_models_group(self):
        # The quota as agy 1.5.18 passes it: buckets by id, a weekly and a 5-hour one per group.
        given = {
            "model": {"id": "Gemini 4 Carbon (High)", "display_name": "Gemini 4 Carbon (High)", "effort": "high"},
            "workspace": {"current_dir": self.home, "project_dir": self.home},
            "context_window": {"used_percentage": 12},
            "quota": {
                "gemini-5h": {"remaining_fraction": 0.8, "reset_time": "2026-11-28T20:39:53Z", "reset_in_seconds": 14804},
                "gemini-weekly": {"remaining_fraction": 0.93, "reset_time": "2026-12-05T06:09:31Z", "reset_in_seconds": 567382},
                "3p-5h": {"remaining_fraction": 1, "reset_time": "1970-01-01T00:00:00Z", "reset_in_seconds": 0},
                "3p-weekly": {"remaining_fraction": 0.5, "reset_time": "2026-12-04T00:00:00Z", "reset_in_seconds": 480000}}}
        line = self.show("antigravity/statusline.sh", given)
        self.assertTrue(line.startswith("Gemini 4 Carbon │ ✍️ 12% │ "), line)
        self.assertIn("● high", line)
        self.assertIn("weekly ○○○○○○○○○○ 7% ⟳ Dec ", line)
        given["model"]["display_name"] = "Claude Opus 5.5 (High)"
        self.assertIn("weekly ●●●●●○○○○○ 50%", self.show("antigravity/statusline.sh", given))
        given["quota"] = None  # a GEMINI_API_KEY session has no plan quota
        self.assertNotIn("weekly", self.show("antigravity/statusline.sh", given))


if __name__ == "__main__":
    unittest.main()
