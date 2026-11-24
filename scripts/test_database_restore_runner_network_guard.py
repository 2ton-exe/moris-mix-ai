"""Offline checks for the Stage B runner host-ingress guard."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import restore_runner_network_guard as guard


def firewall_output():
    return f'''\
table inet {guard.TABLE} {{
 chain input {{
  type filter hook input priority -150; policy drop;
  iifname "lo" accept
  ct state established,related accept
 }}
}}
'''


class RestoreRunnerNetworkGuardTests(unittest.TestCase):
    def test_internal_dns_fix_version_floor(self):
        for version, expected in (("25.0.4", False), ("25.0.5", True), ("26.0.0", True), ("29.9.3", True)):
            with self.subTest(version=version), patch.object(
                guard, "_run", return_value=subprocess.CompletedProcess([], 0, version + "\n", "")
            ):
                if expected:
                    guard._server_version_supported()
                else:
                    with self.assertRaisesRegex(guard.GuardError, "docker-version-unsupported"):
                        guard._server_version_supported()

    def test_unparseable_or_unavailable_docker_version_fails_closed(self):
        for result in (
            subprocess.CompletedProcess([], 1, "", "private daemon detail"),
            subprocess.CompletedProcess([], 0, "unknown\n", ""),
        ):
            with self.subTest(result=result), patch.object(guard, "_run", return_value=result):
                with self.assertRaisesRegex(guard.GuardError, "docker-version-unverified"):
                    guard._server_version_supported()

    def test_ruleset_drops_new_host_ingress_but_keeps_established_and_loopback(self):
        rules = guard._ruleset()
        self.assertIn("type filter hook input priority -150; policy drop;", rules)
        self.assertIn('input iifname "lo" accept', rules)
        self.assertIn("input ct state established,related accept", rules)
        self.assertNotIn("policy accept", rules)

    def test_firewall_verification_rejects_extra_host_allow_rules(self):
        output = f'''\
table inet {guard.TABLE} {{
 chain input {{
  type filter hook input priority -150; policy drop;
  iifname "lo" accept
  ct state established,related accept
  iifname "br-restore" accept
 }}
}}
'''
        with patch.object(
            guard, "_run", return_value=subprocess.CompletedProcess([], 0, output, "")
        ):
            with self.assertRaisesRegex(guard.GuardError, "firewall-policy-unverified"):
                guard._verify_firewall()

    def test_firewall_verification_accepts_only_exact_policy(self):
        output = f'''\
table inet {guard.TABLE} {{
 chain input {{
  type filter hook input priority -150; policy drop;
  iifname "lo" accept
  ct state established,related accept
 }}
}}
'''
        with patch.object(
            guard, "_run", return_value=subprocess.CompletedProcess([], 0, output, "")
        ):
            guard._verify_firewall()

    def test_network_requires_internal_ipv4_only_docker_bridge_with_expected_labels(self):
        record = {
            "Driver": "bridge",
            "Internal": True,
            "EnableIPv6": False,
            "IPAM": {"Config": [{"Gateway": "172.30.0.1"}]},
            "Labels": {
                "com.supabase.cli.project": "synthetic-project",
                "com.docker.compose.project": "synthetic-project",
            },
        }
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, json.dumps([record]), ""),
        ):
            self.assertEqual(guard._network_record("restore-synthetic", "synthetic-project"), "172.30.0.1")
        record["Internal"] = False
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, json.dumps([record]), ""),
        ):
            with self.assertRaisesRegex(guard.GuardError, "docker-network-mismatch"):
                guard._network_record("restore-synthetic", "synthetic-project")

    def test_database_must_use_only_the_guarded_network(self):
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, '{"restore-synthetic":{},"bridge":{}}', ""),
        ):
            with self.assertRaisesRegex(guard.GuardError, "docker-network-mismatch"):
                guard._database_networks("a" * 12, "restore-synthetic")

    def test_marker_is_exact_runner_temp_file_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                expected = Path(temporary) / "restore-runner-network-guard.json"
                self.assertEqual(guard._marker_path(str(expected)), expected)
                wrong = Path(temporary) / "other.json"
                with self.assertRaisesRegex(guard.GuardError, "marker-invalid"):
                    guard._marker_path(str(wrong))
                target = Path(temporary) / "target.json"
                target.write_text("{}", encoding="ascii")
                link = Path(temporary) / "restore-runner-network-guard.json"
                try:
                    link.symlink_to(target)
                except (OSError, NotImplementedError):
                    self.skipTest("symlink creation is unavailable")
                with self.assertRaisesRegex(guard.GuardError, "marker-invalid"):
                    guard._marker_path(str(link))

    def test_cleanup_removes_only_our_guard_after_the_network_is_gone(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            marker.write_text(json.dumps({"network": "restore-synthetic", "table": guard.TABLE}))
            with patch.object(guard, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, "bridge\n", ""),
                subprocess.CompletedProcess([], 0, firewall_output(), ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]) as run:
                guard.remove("restore-synthetic", str(marker))
            self.assertFalse(marker.exists())
            self.assertEqual(run.call_args_list[-1].args[0], [
                "nft", "delete", "table", "inet", guard.TABLE
            ])

    def test_cleanup_keeps_guard_when_network_removal_is_not_confirmed(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            marker.write_text(json.dumps({"network": "restore-synthetic", "table": guard.TABLE}))
            with patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], 0, "restore-synthetic\n", ""),
            ) as run:
                with self.assertRaisesRegex(guard.GuardError, "cleanup-network-still-present"):
                    guard.remove("restore-synthetic", str(marker))
            self.assertTrue(marker.exists())
            run.assert_called_once_with(["docker", "network", "ls", "--format", "{{.Name}}"])

    def test_cleanup_keeps_guard_when_docker_state_is_unavailable(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            marker.write_text(json.dumps({"network": "restore-synthetic", "table": guard.TABLE}))
            with patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], 1, "", "private daemon detail"),
            ):
                with self.assertRaisesRegex(guard.GuardError, "cleanup-network-unverified"):
                    guard.remove("restore-synthetic", str(marker))
            self.assertTrue(marker.exists())


if __name__ == "__main__":
    unittest.main()
