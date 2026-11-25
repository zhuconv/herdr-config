"""token: the token of the login cswap keeps for an account, for /auth.
Runs the script against a fake claude_swap package that keeps its state in a
temporary folder:  python3 tests/token_test.py"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "token")
ORG = "aaaaaaaa-0000-4000-8000-000000000001"
HOUR = 3600 * 1000

# cswap as the script uses it: its slots (sequence.json), the machine's slot, each
# slot's saved login, the `cswap run` sessions on a slot, and its refresh gate.
SWITCHER = r'''
import json, os, time
F = os.environ["FAKE_CSWAP"]

def load():
    with open(os.path.join(F, "state.json")) as f:
        return json.load(f)

def log(line):
    with open(os.path.join(F, "log"), "a") as f:
        f.write(line + "\n")

class RefreshOutcome:
    def __init__(self, credentials, error):
        self.credentials, self.error = credentials, error

class ClaudeAccountSwitcher:
    def __init__(self):
        self.sequence_file = os.path.join(F, "sequence.json")
        log("env " + " ".join(k for k in ("CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR") if k in os.environ))

    def current_account_number(self):
        return load().get("active")

    def read_account_credentials(self, number, email):
        return load()["creds"].get(number, "")

    def live_session_pids_for(self, number, email):
        return load().get("running", {}).get(number, [])

    def consume_backup_grant(self, number, email, snapshot):
        log("consume " + number)
        state = load()
        grant = state.get("grant", "ok")
        if grant != "ok":
            return RefreshOutcome(None, grant)
        new = json.dumps({"claudeAiOauth": {"accessToken": number + "-refreshed", "refreshToken": "r2",
                                            "expiresAt": int(time.time() * 1000) + 8 * 3600 * 1000}})
        state["creds"][number] = new
        with open(os.path.join(F, "state.json"), "w") as f:
            json.dump(state, f)
        return RefreshOutcome(new, None)
'''

OAUTH = r'''
import json, time
def extract_oauth_data(credentials):
    try:
        data = json.loads(credentials)
    except ValueError:
        return None
    oauth = data.get("claudeAiOauth")
    return oauth if isinstance(oauth, dict) else None
def is_oauth_token_expired(expires_at):
    return isinstance(expires_at, (int, float)) and time.time() * 1000 + 5 * 60 * 1000 >= expires_at
'''


def write(path, text):
    with open(path, "w") as f:
        f.write(text)


def read(path):
    with open(path) as f:
        return f.read()


def login(token, expires_in):
    return json.dumps({"claudeAiOauth": {"accessToken": token, "refreshToken": "r1",
                                         "expiresAt": int(time.time() * 1000) + expires_in}})


class Cswap:
    """A machine's cswap: slot 1 gt, slot 2 jian (the machine's own), slot 3 ut of an org."""

    def __init__(self):
        self.dir = tempfile.mkdtemp()
        self.pkg = os.path.join(self.dir, "lib")
        os.makedirs(os.path.join(self.pkg, "claude_swap"))
        for name, text in (("__init__.py", ""), ("switcher.py", SWITCHER), ("oauth.py", OAUTH)):
            write(os.path.join(self.pkg, "claude_swap", name), text)
        write(os.path.join(self.dir, "sequence.json"), json.dumps({"accounts": {
            "1": {"email": "gt@example.com"},
            "2": {"email": "jian@example.com"},
            "3": {"email": "UT@example.com", "organizationUuid": ORG},
        }}))
        self.state = {"active": "2", "creds": {
            "1": login("gt-1", 6 * HOUR), "2": login("jian-1", HOUR), "3": login("ut-1", 6 * HOUR)}}
        self.save()

    def save(self):
        write(os.path.join(self.dir, "state.json"), json.dumps(self.state))

    def log(self):
        try:
            return [l for l in read(os.path.join(self.dir, "log")).splitlines() if not l.startswith("env")]
        except OSError:
            return []

    def token(self, *args, env=None):
        base = {"PATH": os.environ["PATH"], "HOME": self.dir, "FAKE_CSWAP": self.dir, "PYTHONPATH": self.pkg}
        r = subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, env={**base, **(env or {})})
        return json.loads(r.stdout.strip().splitlines()[-1])


class TokenTest(unittest.TestCase):
    def setUp(self):
        self.c = Cswap()

    def test_saved_login_token(self):
        self.assertEqual(self.c.token("gt@example.com")["token"], "gt-1")
        self.assertEqual(self.c.log(), [])

    def test_machine_account_is_left_to_claude_code(self):
        self.assertEqual(self.c.token("jian@example.com"), {"active": True})
        self.assertEqual(self.c.token("jian@example.com", "--refresh"), {"active": True})
        self.assertEqual(self.c.log(), [])

    def test_expiring_login_is_refreshed_through_the_gate(self):
        self.c.state["creds"]["1"] = login("gt-1", 2 * 60 * 1000)
        self.c.save()
        self.assertEqual(self.c.token("gt@example.com")["token"], "1-refreshed")
        self.assertEqual(self.c.token("gt@example.com")["token"], "1-refreshed")
        self.assertEqual(self.c.log(), ["consume 1"])

    def test_refresh_after_a_refusal(self):
        self.assertEqual(self.c.token("gt@example.com", "--refresh")["token"], "1-refreshed")
        self.assertEqual(self.c.log(), ["consume 1"])

    def test_spent_grant_is_dead(self):
        self.c.state["grant"] = "invalid_grant"
        self.c.save()
        self.assertEqual(self.c.token("gt@example.com", "--refresh"), {"error": "its saved login has expired", "dead": True})

    def test_busy_gate_keeps_a_good_token_and_reports_an_expired_one(self):
        self.c.state["grant"] = "consume-busy"
        self.c.save()
        self.assertEqual(self.c.token("gt@example.com", "--refresh")["token"], "gt-1")
        self.c.state["creds"]["1"] = login("gt-1", -60 * 1000)
        self.c.save()
        self.assertEqual(self.c.token("gt@example.com"), {"error": "its login couldn't be refreshed (consume-busy)"})

    def test_a_cswap_run_session_keeps_its_login(self):
        self.c.state["running"] = {"1": [4242]}
        self.c.save()
        self.assertEqual(self.c.token("gt@example.com", "--refresh")["token"], "gt-1")
        self.c.state["creds"]["1"] = login("gt-1", -60 * 1000)
        self.c.save()
        self.assertIn("`cswap run` session", self.c.token("gt@example.com")["error"])
        self.assertEqual(self.c.log(), [])

    def test_accounts_by_email_and_organization(self):
        self.assertEqual(self.c.token("ut@example.com", ORG)["token"], "ut-1")
        self.assertEqual(self.c.token("ut@example.com")["token"], "ut-1")
        self.assertEqual(self.c.token("ut@example.com", "another-org"), {"error": "cswap has no login saved for it here", "dead": True})
        self.assertEqual(self.c.token("nobody@example.com"), {"error": "cswap has no login saved for it here", "dead": True})

    def test_session_variables_are_unset(self):
        self.c.token("gt@example.com", env={"CLAUDE_CONFIG_DIR": "/x", "CLAUDE_SECURESTORAGE_CONFIG_DIR": "/y"})
        self.assertEqual(read(os.path.join(self.c.dir, "log")).splitlines(), ["env "])

    def test_runs_in_cswaps_python(self):
        # Without claude_swap at hand, the script runs again in the Python cswap's launcher names.
        bin_dir = os.path.join(self.c.dir, "bin")
        os.makedirs(bin_dir)
        python = os.path.join(bin_dir, "cswap-python")
        write(python, "#!/bin/sh\nshift\nPYTHONPATH=%s exec %s \"$@\"\n" % (self.c.pkg, sys.executable))
        write(os.path.join(bin_dir, "cswap"), "#!%s\n" % python)
        for path in (python, os.path.join(bin_dir, "cswap")):
            os.chmod(path, 0o755)
        self.assertEqual(self.c.token("gt@example.com", env={"PATH": bin_dir + os.pathsep + os.environ["PATH"], "PYTHONPATH": ""})["token"], "gt-1")
        self.assertIn("cswap isn't installed", self.c.token("gt@example.com", env={"PATH": "/usr/bin:/bin", "PYTHONPATH": ""})["error"])


if __name__ == "__main__":
    unittest.main()
