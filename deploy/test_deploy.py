"""Exercise deployment decisions with fake Docker/curl commands; no services change."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("deploy.sh")
SHA = "a" * 40
FAKE_TOOL = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
case = os.environ.get("DEPLOY_TEST_CASE", "success")
root = pathlib.Path(os.environ["DEPLOY_TEST_ROOT"])
with (root / "calls").open("a") as f:
    f.write(json.dumps([name, *args]) + "\n")
if name == "git":
    if args[0] == "rev-parse": print("a" * 40)
    elif args[0] == "status" and case == "dirty": print(" M file")
elif name == "sleep":
    pass
elif name == "curl":
    (root / "http-started").touch()
    if case == "tls": sys.exit(60)
    if case == "http-error": sys.exit(22)
    path = args[-1].split("example.test", 1)[1]
    body = "<html>frontend</html>"
    if path == "/api/users/health": body = '{"status":"ok","service":"identity-service"}'
    elif path.endswith("/actuator/health"): body = '{"status":"UP"}'
    if case == "wrong-body" and path == "/api/chat/actuator/health": body = "<html>SPA fallback</html>"
    if case == "down-body" and path == "/api/orgs/actuator/health": body = '{"status":"DOWN"}'
    pathlib.Path(args[args.index("--output") + 1]).write_text(body)
    print("302" if case == "redirect" else "200", end="")
elif name == "docker":
    if args[:2] == ["compose", "config"]:
        if case == "config-error": sys.exit(12)
        if "--format" in args:
            print(json.dumps({"services": {
                "nginx": {"environment": {"DOMAIN": "example.test", "SECRET": "DO_NOT_PRINT_SECRET"},
                          "depends_on": {"frontend": {"condition": "service_healthy"}}},
                "frontend": {}, "org-service": {}, "chat-service": {},
                "identity-service": {"depends_on": {"schema-setup": {"condition": "service_completed_successfully"}}},
                "schema-setup": {}, "telemetry-worker": {}
            }}))
    elif args[:2] == ["compose", "build"]:
        if case == "build-error": sys.exit(13)
    elif args[:2] == ["compose", "up"]:
        if case in ("startup-error", "migration-error", "unhealthy"): sys.exit(17)
    elif args[:2] == ["compose", "ps"]:
        items = [{"ID": service + "-id", "Service": service, "State": "running", "Health": "healthy", "ExitCode": 0}
                 for service in ("nginx", "frontend", "identity-service", "org-service", "chat-service", "telemetry-worker")]
        items.append({"ID":"schema-setup-id", "Service":"schema-setup", "State":"exited", "Health":"", "ExitCode":0})
        if case == "startup-error": items[-2].update(State="exited", ExitCode=2)
        if case == "migration-error": items[-1]["ExitCode"] = 1
        if case == "exited-zero": items[-2].update(State="exited", Health="", ExitCode=0)
        if case == "unhealthy": items[-2]["Health"] = "unhealthy"
        if case == "starting": items[-2]["Health"] = "starting"
        if case == "missing": items = [x for x in items if x["Service"] != "telemetry-worker"]
        if case == "late-exit" and (root / "http-started").exists(): items[-2]["State"] = "restarting"
        if "--format" in args:
            if case == "array-json": print(json.dumps(items))
            else:
                for item in items: print(json.dumps(item))
        else: print("All container statuses")
    elif args[:2] == ["compose", "logs"]: print("Recent service logs")
    elif args[0] == "inspect": print('container state: {"Health":{"Log":[{"Output":"probe failed"}]}}')
'''


class DeploymentTests(unittest.TestCase):
    def run_case(self, case, **overrides):
        with tempfile.TemporaryDirectory(prefix="deploy-test-") as tmp:
            root = Path(tmp)
            (root / "deploy").mkdir()
            (root / "bin").mkdir()
            (root / "tmp").mkdir()
            (root / ".env").touch()
            shutil.copy2(SCRIPT, root / "deploy/deploy.sh")
            for command in ("git", "docker", "curl", "sleep"):
                executable = root / "bin" / command
                executable.write_text(FAKE_TOOL)
                executable.chmod(0o755)
            env = dict(os.environ, PATH=f"{root / 'bin'}:{os.environ['PATH']}",
                       DEPLOY_TEST_ROOT=tmp, DEPLOY_TEST_CASE=case,
                       DEPLOY_WAIT_TIMEOUT="1", DEPLOY_HTTP_TIMEOUT="2", DEPLOY_LOG_TAIL="7",
                       TMPDIR=str(root / "tmp"))
            env.pop("DEPLOY_CA_CERT", None)
            env.update(overrides)
            result = subprocess.run(["bash", str(root / "deploy/deploy.sh"), SHA],
                                    env=env, capture_output=True, text=True, timeout=15)
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            self.assertNotIn("DO_NOT_PRINT_SECRET", result.stdout + result.stderr)
            self.assertEqual(list((root / "tmp").iterdir()), [])
            return result, calls

    def assert_failed(self, case, code=None):
        result, calls = self.run_case(case)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        if code is not None:
            self.assertEqual(result.returncode, code, result.stderr)
        self.assertFalse(any(c[:3] == ["docker", "image", "prune"] for c in calls))
        return result, calls

    def test_success_and_both_compose_json_formats(self):
        for case in ("success", "array-json"):
            with self.subTest(case=case):
                result, calls = self.run_case(case)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                build = next(i for i,c in enumerate(calls) if c[:3] == ["docker","compose","build"])
                up = next(i for i,c in enumerate(calls) if c[:3] == ["docker","compose","up"])
                self.assertLess(build, up)
                self.assertIn("--wait", calls[up])
                probes = [c for c in calls if c[0] == "curl"]
                self.assertEqual(len(probes), 4)
                for probe in probes:
                    self.assertNotIn("-k", probe)
                    self.assertNotIn("--insecure", probe)
                    self.assertIn("example.test:443:127.0.0.1", probe)
                self.assertTrue(any(c[:3] == ["docker","image","prune"] for c in calls))
                self.assertFalse(any(c[:3] == ["docker","compose","logs"] for c in calls))

    def test_config_and_build_errors_do_not_update_containers(self):
        for case,code in (("config-error",12),("build-error",13)):
            with self.subTest(case=case):
                result,calls = self.assert_failed(case,code)
                self.assertFalse(any(c[:3] == ["docker","compose","up"] for c in calls))
                self.assertIn("Recent service logs", result.stdout)

    def test_reports_any_failing_service_and_health_output(self):
        for case in ("startup-error", "unhealthy"):
            with self.subTest(case=case):
                result,calls = self.assert_failed(case,17)
                logs = [c for c in calls if c[:3] == ["docker","compose","logs"]]
                self.assertEqual(len(logs), 1)
                self.assertIn("telemetry-worker", logs[0])
                self.assertNotIn("schema-setup", logs[0])
                self.assertIn("probe failed", result.stdout)

    def test_failed_migration_is_reported(self):
        _,calls = self.assert_failed("migration-error",17)
        self.assertTrue(any("schema-setup" in c for c in calls if c[:3] == ["docker","compose","logs"]))

    def test_stopped_running_services_and_timeouts_fail(self):
        for case in ("exited-zero", "starting", "missing", "late-exit"):
            with self.subTest(case=case):
                self.assert_failed(case)

    def test_http_tls_status_and_body_failures(self):
        for case,code in (("tls",60),("http-error",22),("redirect",1),("wrong-body",1),("down-body",1)):
            with self.subTest(case=case):
                result,calls = self.assert_failed(case,code)
                logs = [c for c in calls if c[:3] == ["docker","compose","logs"]]
                self.assertEqual(len(logs), 1)
                self.assertIn("nginx", logs[0])
                if case == "wrong-body": self.assertIn("chat-service", logs[0])
                if case == "down-body": self.assertIn("org-service", logs[0])
                self.assertIn("HTTPS check", result.stderr)

    def test_custom_ca_and_invalid_timeout(self):
        with tempfile.NamedTemporaryFile() as ca:
            result,calls = self.run_case("success",DEPLOY_CA_CERT=ca.name)
            self.assertEqual(result.returncode, 0, result.stderr)
            for call in calls:
                if call[0] == "curl": self.assertIn(ca.name,call)
        result,calls = self.run_case("success",DEPLOY_WAIT_TIMEOUT="0")
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(c[0] == "docker" for c in calls))

    def test_dirty_checkout_is_rejected(self):
        result,calls = self.run_case("dirty")
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(c[0] == "docker" for c in calls))


if __name__ == "__main__":
    unittest.main()
