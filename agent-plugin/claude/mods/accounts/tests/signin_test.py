"""signin: signing a machine in to each account it has no working login for,
without losing a login. Runs the script against a fake claude and cswap that
keep their state in a temporary home:  python3 tests/signin_test.py"""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "signin")
UT_ORG = "aaaaaaaa-0000-4000-8000-000000000001"
TABLE = {"accounts": [
    {"alias": "ut", "email": "UT@example.com", "org": UT_ORG},
    {"alias": "shui", "email": "shui@example.com"},
    {"alias": "gt", "email": "gt@example.com"},
    {"alias": "jian", "email": "jian@example.com", "chrome": "Profile 10"},
    {"alias": "sr"},
]}

# The machine: ~/.claude.json holds its login, ~/.fake/creds the token it holds,
# ~/.fake/slots.json what cswap keeps ('dead' for a token past its refresh).
COMMON = r'''
import json, os, sys
H = os.environ["HOME"]; F = os.path.join(H, ".fake")
def load(name, default):
    try:
        return json.load(open(os.path.join(F, name)))
    except OSError:
        return default
def dump(name, value):
    json.dump(value, open(os.path.join(F, name), "w"))
def live():
    try:
        a = json.load(open(os.path.join(H, ".claude.json")))["oauthAccount"]
        return a["emailAddress"].lower(), (a.get("organizationUuid") or None)
    except (OSError, KeyError):
        return None
def set_live(email, org, creds):
    json.dump({"oauthAccount": {"emailAddress": email, "organizationUuid": org}}, open(os.path.join(H, ".claude.json"), "w"))
    open(os.path.join(F, "creds"), "w").write(creds)
def creds():
    return open(os.path.join(F, "creds")).read()
def log(line):
    open(os.path.join(F, "log"), "a").write(line + "\n")
'''

FAKE_CSWAP = "#!/usr/bin/env python3\n" + COMMON + r'''
args = sys.argv[1:]
log("cswap " + " ".join(args))
slots = load("slots.json", [])
me = live()
mine = lambda s: me is not None and (s["email"], s.get("organizationUuid")) == me
if args[:1] == ["list"]:
    out = []
    for s in slots:
        token = creds() if mine(s) else s["creds"]
        out.append({"number": s["number"], "email": s["email"], "organizationUuid": s.get("organizationUuid"),
                    "active": mine(s), "usageStatus": "relogin_required" if token == "dead" else "ok"})
    print(json.dumps({"schemaVersion": 1, "accounts": out}))
elif args[:1] == ["add"]:
    if me is None:
        sys.exit("No active Claude account found")
    slot = next((s for s in slots if mine(s)), None)
    if slot:
        slot["creds"] = creds()
    else:
        slots.append({"number": max([0] + [s["number"] for s in slots]) + 1, "email": me[0],
                      "organizationUuid": me[1], "creds": creds()})
    dump("slots.json", slots)
elif args[:1] == ["switch"]:
    target = next((s for s in slots if str(s["number"]) == args[1]), None)
    if target is None:
        sys.exit("no such account")
    leaving = next((s for s in slots if mine(s)), None)
    if leaving:
        leaving["creds"] = creds()
    dump("slots.json", slots)
    set_live(target["email"], target.get("organizationUuid"), target["creds"])
else:
    sys.exit(2)
'''

# `claude auth login --email X`: a new login replaces the machine's. ~/.fake/plan.json
# can make one give another account ({"as": email, "org": org}) or fail ({"exit": 1}).
FAKE_CLAUDE = "#!/usr/bin/env python3\n" + COMMON + r'''
args = sys.argv[1:]
log("claude " + " ".join(args))
assert args[:3] == ["auth", "login", "--email"], args
plan = load("plan.json", {}).get(args[3], {})
if plan.get("exit"):
    sys.exit(plan["exit"])
n = load("signins.json", 0) + 1
dump("signins.json", n)
set_live(plan.get("as", args[3]).lower(), plan.get("org"), "login-%d" % n)
'''


class Machine:
    def __init__(self, live=None, slots=(), plan=None):
        self.dir = tempfile.TemporaryDirectory(prefix="signin-test-")
        self.home = self.dir.name
        os.makedirs(os.path.join(self.home, ".fake"))
        os.makedirs(os.path.join(self.home, ".config", "claude-accounts"))
        self.bin = os.path.join(self.home, "fakebin")
        os.makedirs(self.bin)
        for name, body in (("cswap", FAKE_CSWAP), ("claude", FAKE_CLAUDE)):
            path = os.path.join(self.bin, name)
            with open(path, "w") as f:
                f.write(body)
            os.chmod(path, 0o755)
        self.write(".config/claude-accounts/accounts.json", TABLE)
        self.write(".fake/slots.json", [dict(s) for s in slots])
        self.write(".fake/plan.json", plan or {})
        if live:
            email, org = live
            self.write(".claude.json", {"oauthAccount": {"emailAddress": email, "organizationUuid": org}})
            self.write(".fake/creds", "login-0")

    def write(self, rel, value):
        with open(os.path.join(self.home, rel), "w") as f:
            f.write(value if isinstance(value, str) else json.dumps(value))

    def read(self, rel):
        with open(os.path.join(self.home, rel)) as f:
            return f.read()

    def run(self, *args, cswap=True):
        if not cswap:
            os.remove(os.path.join(self.bin, "cswap"))
        # Only the fakes: the real claude and cswap are never on this PATH.
        env = {"HOME": self.home, "PATH": self.bin + ":/usr/bin:/bin", "LANG": "C.UTF-8"}
        r = subprocess.run([sys.executable, SCRIPT] + list(args), env=env, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=60)
        return r.returncode, r.stdout

    def log(self):
        try:
            return self.read(".fake/log").splitlines()
        except OSError:
            return []

    def slots(self):
        slots = json.loads(self.read(".fake/slots.json"))
        emails = [s["email"] for s in slots]
        assert len(emails) == len(set(emails)), "two slots for one account: %s" % emails
        return {s["email"]: s["creds"] for s in slots}

    def live(self):
        a = json.loads(self.read(".claude.json"))["oauthAccount"]
        return a["emailAddress"], self.read(".fake/creds")


class SigninTest(unittest.TestCase):
    def setUp(self):
        self.machines = []

    def tearDown(self):
        for m in self.machines:
            m.dir.cleanup()

    def machine(self, **kw):
        m = Machine(**kw)
        self.machines.append(m)
        return m

    def test_signs_in_each_account_without_a_working_login_then_goes_back(self):
        m = self.machine(live=("jian@example.com", None), plan={"ut@example.com": {"org": UT_ORG}}, slots=[
            {"number": 1, "email": "ut@example.com", "organizationUuid": UT_ORG, "creds": "dead"},
            {"number": 2, "email": "gt@example.com", "organizationUuid": None, "creds": "gt-old"},
        ])
        code, out = m.run()
        self.assertEqual(code, 0, out)
        logins = [l for l in m.log() if l.startswith("claude")]
        self.assertEqual(logins, ["claude auth login --email ut@example.com",
                                  "claude auth login --email shui@example.com"])
        # The machine's own login is saved before the first sign-in writes over it.
        self.assertEqual(m.log()[0], "cswap add")
        self.assertEqual(m.slots(), {"ut@example.com": "login-1", "shui@example.com": "login-2",
                                     "gt@example.com": "gt-old", "jian@example.com": "login-0"})
        self.assertEqual(m.live(), ("jian@example.com", "login-0"))
        self.assertIn("Signed in and saved: ut, shui.", out)
        self.assertIn("sr has no email in the account table.", out)
        self.assertIn("opens in ut's container in Zen", out)

    def test_a_sign_in_that_gives_another_account_is_kept_and_reported(self):
        m = self.machine(live=("jian@example.com", None), plan={"ut@example.com": {"as": "gt@example.com"}})
        code, out = m.run("ut", "shui")
        self.assertEqual(code, 1, out)
        self.assertIn("ut: the sign-in gave gt's login", out)
        self.assertEqual(m.slots(), {"jian@example.com": "login-0", "gt@example.com": "login-1",
                                     "shui@example.com": "login-2"})
        self.assertEqual(m.live(), ("jian@example.com", "login-0"))
        self.assertIn("Signed in and saved: shui.", out)

    def test_an_unfinished_sign_in_stops_and_goes_back(self):
        m = self.machine(live=("shui@example.com", None), plan={"gt@example.com": {"exit": 1}},
                    slots=[{"number": 1, "email": "shui@example.com", "organizationUuid": None, "creds": "login-0"}])
        code, out = m.run("ut", "gt", "jian")
        self.assertEqual(code, 1, out)
        self.assertIn("Signing in to gt didn't finish.", out)
        self.assertNotIn("claude auth login --email jian@example.com", m.log())
        self.assertEqual(m.slots()["ut@example.com"], "login-1")
        self.assertEqual(m.live(), ("shui@example.com", "login-0"))

    def test_nothing_to_do_when_every_account_has_a_working_login(self):
        m = self.machine(live=("jian@example.com", None), slots=[
            {"number": n, "email": e, "organizationUuid": o, "creds": "ok-%d" % n}
            for n, e, o in ((1, "ut@example.com", UT_ORG), (2, "shui@example.com", None), (3, "gt@example.com", None))
        ])
        code, out = m.run()
        self.assertEqual(code, 0, out)
        self.assertIn("Nothing to sign in to here.", out)
        self.assertFalse([l for l in m.log() if l.startswith("claude")])

    def test_names_must_be_in_the_table_and_cswap_must_be_here(self):
        m = self.machine(live=("jian@example.com", None))
        code, out = m.run("nobody")
        self.assertEqual(code, 1)
        self.assertIn("No account nobody.", out)
        self.assertEqual(m.log(), [])
        code, out = m.run(cswap=False)
        self.assertEqual(code, 1)
        self.assertIn("cswap isn't installed here", out)

    def test_vista_login_nodes_are_refused(self):
        sys.dont_write_bytecode = True  # no __pycache__ beside the script
        loader = importlib.machinery.SourceFileLoader("signin", SCRIPT)
        spec = importlib.util.spec_from_loader("signin", loader)
        signin = importlib.util.module_from_spec(spec)
        loader.exec_module(signin)
        self.assertTrue(signin.on_vista_login_node("login1.vista.tacc.utexas.edu"))
        self.assertFalse(signin.on_vista_login_node("c608-021.vista.tacc.utexas.edu"))
        self.assertFalse(signin.on_vista_login_node("login3.horizon.tacc.utexas.edu", "horizon"))
        self.assertTrue(signin.on_vista_login_node("login2", "vista"))


if __name__ == "__main__":
    unittest.main()
