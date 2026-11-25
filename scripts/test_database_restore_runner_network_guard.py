"""Offline checks for the disposable Stage B host and network guard."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import restore_runner_network_guard as guard


INTERFACE = "br-aaaaaaaaaaaa"
DATABASE_IP = "172.30.0.2"


def network_record(*, internal=True, ipv6=False):
    return {
        "Id": "a" * 64,
        "Driver": "bridge",
        "Internal": internal,
        "EnableIPv6": ipv6,
        "IPAM": {"Config": [{"Gateway": "172.30.0.1"}]},
        "Labels": {
            "com.supabase.cli.project": "synthetic-project",
            "com.docker.compose.project": "synthetic-project",
        },
        "Options": {"com.docker.network.bridge.name": INTERFACE},
    }


def firewall_output(interface=INTERFACE, database_ip=DATABASE_IP, *, extra=""):
    return f'''\
table inet {guard.TABLE} {{
 chain input {{
  type filter hook input priority -150; policy drop;
  iifname "lo" meta nfproto ipv6 tcp dport 54322 drop
  iifname "lo" ip daddr != 127.0.0.1 tcp dport 54322 drop
  iifname "lo" accept
  ct state established,related accept
  {extra}
 }}
 chain forward {{
  type filter hook forward priority -1; policy accept;
  meta nfproto ipv6 tcp dport 5432 drop
  iifname "lo" ip daddr {database_ip} tcp dport 5432 accept
  iifname "{interface}" ip daddr {database_ip} tcp dport 5432 accept
  tcp dport 5432 drop
 }}
}}
'''


class RestoreRunnerNetworkGuardTests(unittest.TestCase):
    def test_network_requires_the_owned_internal_ipv4_only_bridge(self):
        for record, accepted in (
            (network_record(), True),
            (network_record(internal=False), False),
            (network_record(ipv6=True), False),
        ):
            with self.subTest(record=record["Internal"], ipv6=record["EnableIPv6"]), patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], 0, json.dumps([record]), ""),
            ):
                if accepted:
                    self.assertEqual(
                        guard._network_details("restore-synthetic", "synthetic-project"),
                        ("172.30.0.1", INTERFACE),
                    )
                else:
                    with self.assertRaisesRegex(guard.GuardError, "docker-network-mismatch"):
                        guard._network_details("restore-synthetic", "synthetic-project")

    def test_network_rejects_malformed_or_wrong_project_records(self):
        for source in ("not-json", "[]"):
            with self.subTest(source=source), patch.object(
                guard, "_run", return_value=subprocess.CompletedProcess([], 0, source, "")
            ):
                with self.assertRaisesRegex(guard.GuardError, "docker-network-unverified"):
                    guard._network_details("restore-synthetic", "synthetic-project")
        record = network_record()
        record["Labels"]["com.docker.compose.project"] = "other-project"
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, json.dumps([record]), ""),
        ):
            with self.assertRaisesRegex(guard.GuardError, "docker-network-mismatch"):
                guard._network_details("restore-synthetic", "synthetic-project")

    def test_database_must_be_only_on_expected_network_and_have_ipv4(self):
        good = json.dumps({"restore-synthetic": {"IPAddress": DATABASE_IP}})
        with patch.object(
            guard, "_run", return_value=subprocess.CompletedProcess([], 0, good, "")
        ):
            self.assertEqual(guard._database_ipv4("a" * 12, "restore-synthetic"), DATABASE_IP)
        for source in (
            json.dumps({"restore-synthetic": {"IPAddress": DATABASE_IP}, "bridge": {}}),
            json.dumps({"restore-synthetic": {"IPAddress": "2001:db8::1"}}),
            "not-json",
        ):
            with self.subTest(source=source), patch.object(
                guard, "_run", return_value=subprocess.CompletedProcess([], 0, source, "")
            ):
                with self.assertRaises(guard.GuardError):
                    guard._database_ipv4("a" * 12, "restore-synthetic")

    def test_firewall_is_narrow_and_keeps_host_egress_outside_its_hooks(self):
        rules = guard._ruleset(INTERFACE, DATABASE_IP)
        self.assertIn("type filter hook input priority -150; policy drop;", rules)
        self.assertIn('input iifname "lo" ip daddr != 127.0.0.1 tcp dport 54322 drop', rules)
        self.assertIn('input iifname "lo" accept', rules)
        self.assertIn("input ct state established,related accept", rules)
        self.assertIn("type filter hook forward priority -1; policy accept;", rules)
        self.assertIn(f'iifname "{INTERFACE}" ip daddr {DATABASE_IP} tcp dport 5432 accept', rules)
        self.assertIn("forward tcp dport 5432 drop", rules)
        self.assertNotIn("hook output", rules)

    def test_firewall_verification_accepts_exact_rules_and_rejects_widened_policy(self):
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess(
                [], 0, firewall_output(), ""
            ),
        ):
            guard._verify_firewall(INTERFACE, DATABASE_IP)
        for output in (
            firewall_output(extra='iifname "br-other" accept'),
            firewall_output().replace("priority -1", "priority -150"),
            firewall_output().replace(DATABASE_IP, "172.30.0.99"),
        ):
            with self.subTest(output=output[-100:]), patch.object(
                guard, "_run", return_value=subprocess.CompletedProcess([], 0, output, "")
            ):
                with self.assertRaisesRegex(guard.GuardError, "firewall-policy-unverified"):
                    guard._verify_firewall(INTERFACE, DATABASE_IP)

    def test_published_port_probe_fails_closed_on_reachable_or_unverifiable_results(self):
        command_results = (
            (subprocess.CompletedProcess([], 1, "", ""), None),
            (subprocess.CompletedProcess([], 0, "", ""), "published-port-reachable"),
            (subprocess.CompletedProcess([], 125, "", "SYNTHETIC_PRIVATE_SENTINEL"), "published-port-unverified"),
        )
        for result, error in command_results:
            with self.subTest(error=error), patch.object(guard, "_run", return_value=result) as run:
                if error:
                    with self.assertRaisesRegex(guard.GuardError, error):
                        guard._run_published_port_probe(guard.PINNED_IMAGE)
                else:
                    guard._run_published_port_probe(guard.PINNED_IMAGE)
                self.assertIn("--network", run.call_args.args[0])
                self.assertIn("host.docker.internal:host-gateway", run.call_args.args[0])

    def test_dns_probe_requires_internal_resolution_and_denies_external_resolution(self):
        with patch.object(
            guard, "_run", return_value=subprocess.CompletedProcess([], 0, "", "")
        ) as run:
            guard._run_dns_probe("restore-synthetic", guard.PINNED_IMAGE)
        self.assertIn("nslookup db", run.call_args.args[0][-1])
        self.assertIn("nslookup example.com", run.call_args.args[0][-1])
        for returncode, error in ((122, "external-dns-resolves"), (121, "internal-dns-unverified"), (125, "internal-dns-unverified")):
            with self.subTest(returncode=returncode), patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], returncode, "", ""),
            ):
                with self.assertRaisesRegex(guard.GuardError, error):
                    guard._run_dns_probe("restore-synthetic", guard.PINNED_IMAGE)

    def test_marker_is_exact_runner_temp_file_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                expected = Path(temporary) / "restore-runner-network-guard.json"
                self.assertEqual(guard._marker_path(str(expected)), expected)
                with self.assertRaisesRegex(guard.GuardError, "marker-invalid"):
                    guard._marker_path(str(Path(temporary) / "other.json"))
                target = Path(temporary) / "target.json"
                target.write_text("{}", encoding="ascii")
                try:
                    expected.symlink_to(target)
                except (OSError, NotImplementedError):
                    self.skipTest("symlink creation is unavailable")
                with self.assertRaisesRegex(guard.GuardError, "marker-invalid"):
                    guard._marker_path(str(expected))

    def test_cleanup_removes_only_the_verified_guard_after_network_removal(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            marker.write_text(
                json.dumps({
                    "database_ipv4": DATABASE_IP,
                    "interface": INTERFACE,
                    "network": "restore-synthetic",
                    "phase": "active",
                    "table": guard.TABLE,
                }),
                encoding="ascii",
            )
            with patch.object(guard, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, "bridge\n", ""),
                subprocess.CompletedProcess([], 0, f"table inet {guard.TABLE}\n", ""),
                subprocess.CompletedProcess([], 0, firewall_output(), ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]) as run:
                guard.remove("restore-synthetic", str(marker))
            self.assertFalse(marker.exists())
            self.assertEqual(run.call_args_list[-1].args[0], [
                "nft", "delete", "table", "inet", guard.TABLE
            ])

    def test_cleanup_keeps_guard_if_network_removal_or_firewall_state_is_unverified(self):
        for results, error in (
            ([subprocess.CompletedProcess([], 0, "restore-synthetic\n", "")], "cleanup-network-still-present"),
            ([subprocess.CompletedProcess([], 1, "", "SYNTHETIC_PRIVATE_SENTINEL")], "cleanup-network-unverified"),
            ([subprocess.CompletedProcess([], 0, "", ""), subprocess.CompletedProcess([], 0, "", "")], "cleanup-firewall-unverified"),
        ):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temporary, patch.dict(
                os.environ, {"RUNNER_TEMP": temporary}
            ):
                marker = Path(temporary) / "restore-runner-network-guard.json"
                marker.write_text(
                    json.dumps({
                        "database_ipv4": DATABASE_IP,
                        "interface": INTERFACE,
                        "network": "restore-synthetic",
                        "phase": "active",
                        "table": guard.TABLE,
                    }),
                    encoding="ascii",
                )
                with patch.object(guard, "_run", side_effect=results):
                    with self.assertRaisesRegex(guard.GuardError, error):
                        guard.remove("restore-synthetic", str(marker))
                self.assertTrue(marker.exists())

    def test_installing_marker_can_be_removed_if_firewall_was_never_created(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            marker.write_text(
                json.dumps({
                    "database_ipv4": DATABASE_IP,
                    "interface": INTERFACE,
                    "network": "restore-synthetic",
                    "phase": "installing",
                    "table": guard.TABLE,
                }),
                encoding="ascii",
            )
            with patch.object(guard, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, "", ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]):
                guard.remove("restore-synthetic", str(marker))
            self.assertFalse(marker.exists())

    def test_cli_suppresses_unexpected_private_diagnostic_text(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ), patch.object(
            guard, "apply", side_effect=RuntimeError("SYNTHETIC_PRIVATE_SENTINEL")
        ):
            from contextlib import redirect_stderr, redirect_stdout
            from io import StringIO

            stdout = StringIO()
            stderr = StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                result = guard.main([
                    "apply",
                    "--docker-network", "restore-synthetic",
                    "--database-container", "a" * 12,
                    "--project-id", "synthetic-project",
                    "--marker", str(Path(temporary) / "restore-runner-network-guard.json"),
                ])
            self.assertEqual(result, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(
                stderr.getvalue(),
                "Restore runner network guard failed (network-guard-failed).\n",
            )
            self.assertNotIn("SYNTHETIC_PRIVATE_SENTINEL", stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
