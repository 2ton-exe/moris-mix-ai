"""Offline checks for the disposable Stage B host and network guard."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

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


def bootstrap_firewall_output(*, extra_input="", extra_forward=""):
    return f'''\
table inet {guard.BOOTSTRAP_TABLE} {{
 chain input {{
  type filter hook input priority -150; policy accept;
  iifname "lo" ip daddr 127.0.0.1 tcp dport 54322 accept
  tcp dport 54322 drop
  {extra_input}
 }}
 chain forward {{
  type filter hook forward priority -1; policy accept;
  iifname "lo" meta nfproto ipv4 ct status dnat tcp dport 5432 accept
  tcp dport 5432 drop
  {extra_forward}
 }}
}}
'''


class RestoreRunnerNetworkGuardTests(unittest.TestCase):
    def test_bootstrap_guard_covers_host_and_forwarded_ipv4_ipv6_ingress(self):
        rules = guard._bootstrap_ruleset()
        self.assertIn(
            "type filter hook input priority -150; policy accept;", rules
        )
        self.assertIn(
            'input iifname "lo" ip daddr 127.0.0.1 tcp dport 54322 accept',
            rules,
        )
        self.assertIn("input tcp dport 54322 drop", rules)
        self.assertIn(
            "type filter hook forward priority -1; policy accept;", rules
        )
        self.assertIn(
            'forward iifname "lo" meta nfproto ipv4 ct status dnat tcp dport 5432 accept',
            rules,
        )
        self.assertIn("forward tcp dport 5432 drop", rules)
        self.assertNotIn("hook output", rules)
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess(
                [], 0, bootstrap_firewall_output(), ""
            ),
        ):
            guard._verify_bootstrap_firewall()
        for output in (
            bootstrap_firewall_output(extra_input='iifname "eth0" tcp dport 54322 accept'),
            bootstrap_firewall_output(extra_forward='iifname "br-other" tcp dport 5432 accept'),
            bootstrap_firewall_output().replace("policy accept", "policy drop"),
        ):
            with self.subTest(output=output[-120:]), patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], 0, output, ""),
            ):
                with self.assertRaisesRegex(
                    guard.GuardError, "bootstrap-firewall-policy-unverified"
                ):
                    guard._verify_bootstrap_firewall()

    def test_bootstrap_installs_exact_rules_before_start_and_writes_owned_marker(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ), patch.object(guard.shutil, "which", return_value="/usr/sbin/nft"), patch.object(
            guard, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, "", ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]
        ) as run, patch.object(guard, "_verify_bootstrap_firewall") as verify:
            marker = Path(temporary) / "restore-runner-bootstrap-guard.json"
            guard.bootstrap(str(marker))
            self.assertEqual(
                json.loads(marker.read_text(encoding="ascii")),
                {"phase": "active", "table": guard.BOOTSTRAP_TABLE},
            )
            self.assertEqual(run.call_args_list[0].args[0], ["nft", "list", "tables"])
            self.assertEqual(run.call_args_list[1].args[0], ["nft", "-f", "-"])
            self.assertEqual(run.call_args_list[1].kwargs["input_text"], guard._bootstrap_ruleset())
            verify.assert_called_once_with()

    def test_bootstrap_verification_requires_active_marker_and_live_denial_probe(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-bootstrap-guard.json"
            marker.write_text(
                json.dumps({"phase": "active", "table": guard.BOOTSTRAP_TABLE}),
                encoding="ascii",
            )
            listener, stopped, thread = MagicMock(), MagicMock(), MagicMock()
            with patch.object(guard, "_verify_bootstrap_firewall") as verify, patch.object(
                guard, "_default_bridge_gateway", return_value="172.17.0.1"
            ), patch.object(
                guard, "_start_host_listener",
                return_value=(listener, stopped, thread, 43123),
            ), patch.object(
                guard, "_run_host_probe", return_value=True
            ) as host_probe, patch.object(
                guard, "_run_published_port_probe"
            ) as probe:
                guard.verify_bootstrap(str(marker), guard.PINNED_IMAGE)
                verify.assert_called_once_with()
                host_probe.assert_called_once_with(
                    "bridge", "172.17.0.1", 43123, guard.PINNED_IMAGE
                )
                probe.assert_called_once_with(guard.PINNED_IMAGE)
                listener.close.assert_called_once_with()
                stopped.set.assert_called_once_with()
                thread.join.assert_called_once_with(timeout=1)
            with patch.object(guard, "_verify_bootstrap_firewall"), patch.object(
                guard, "_default_bridge_gateway", return_value="172.17.0.1"
            ), patch.object(
                guard, "_start_host_listener",
                return_value=(MagicMock(), MagicMock(), MagicMock(), 43123),
            ), patch.object(
                guard, "_run_host_probe", return_value=True
            ), patch.object(
                guard,
                "_run_published_port_probe",
                side_effect=guard.GuardError("published-port-reachable"),
            ):
                with self.assertRaisesRegex(guard.GuardError, "published-port-reachable"):
                    guard.verify_bootstrap(str(marker), guard.PINNED_IMAGE)
            with patch.object(guard, "_verify_bootstrap_firewall"), patch.object(
                guard, "_default_bridge_gateway", return_value="172.17.0.1"
            ), patch.object(
                guard, "_start_host_listener",
                return_value=(MagicMock(), MagicMock(), MagicMock(), 43123),
            ), patch.object(
                guard, "_run_host_probe", return_value=False
            ), patch.object(
                guard, "_run_published_port_probe"
            ) as probe:
                with self.assertRaisesRegex(guard.GuardError, "host-route-unverified"):
                    guard.verify_bootstrap(str(marker), guard.PINNED_IMAGE)
                probe.assert_not_called()

    def test_default_bridge_gateway_requires_a_single_ipv4_bridge_record(self):
        valid = [{
            "Driver": "bridge",
            "IPAM": {"Config": [{"Gateway": "172.17.0.1"}]},
        }]
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, json.dumps(valid), ""),
        ):
            self.assertEqual(guard._default_bridge_gateway(), "172.17.0.1")
        for records in (
            [],
            [{"Driver": "overlay", "IPAM": {"Config": [{"Gateway": "172.17.0.1"}]}}],
            [{"Driver": "bridge", "IPAM": {"Config": [{"Gateway": "2001:db8::1"}]}}],
            [{"Driver": "bridge", "IPAM": {"Config": []}}],
        ):
            with self.subTest(records=records), patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], 0, json.dumps(records), ""),
            ):
                with self.assertRaisesRegex(guard.GuardError, "host-route-unverified"):
                    guard._default_bridge_gateway()

    def test_bootstrap_handoff_requires_verified_internal_guard_before_removal(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            bootstrap_marker = Path(temporary) / "restore-runner-bootstrap-guard.json"
            final_marker = Path(temporary) / "restore-runner-network-guard.json"
            bootstrap_marker.write_text(
                json.dumps({"phase": "active", "table": guard.BOOTSTRAP_TABLE}),
                encoding="ascii",
            )
            final_marker.write_text(
                json.dumps({
                    "database_ipv4": DATABASE_IP,
                    "interface": INTERFACE,
                    "network": "restore-synthetic",
                    "phase": "active",
                    "table": guard.TABLE,
                }),
                encoding="ascii",
            )
            with patch.object(
                guard,
                "_network_details",
                return_value=("172.30.0.1", INTERFACE),
            ), patch.object(
                guard, "_database_ipv4", return_value=DATABASE_IP
            ), patch.object(
                guard, "_verify_firewall"
            ) as verify_final, patch.object(
                guard, "_verify_bootstrap_firewall"
            ) as verify_bootstrap, patch.object(
                guard, "_run", side_effect=[
                    subprocess.CompletedProcess(
                        [], 0, f"table inet {guard.BOOTSTRAP_TABLE}\n", ""
                    ),
                    subprocess.CompletedProcess([], 0, "", ""),
                ]
            ) as run:
                guard.handoff_bootstrap(
                    str(bootstrap_marker),
                    str(final_marker),
                    "restore-synthetic",
                    "a" * 12,
                    "synthetic-project",
                )
            verify_final.assert_called_once_with(INTERFACE, DATABASE_IP)
            self.assertEqual(verify_bootstrap.call_count, 2)
            self.assertEqual(
                run.call_args_list[-1].args[0],
                ["nft", "delete", "table", "inet", guard.BOOTSTRAP_TABLE],
            )
            self.assertFalse(bootstrap_marker.exists())
            self.assertTrue(final_marker.exists())

            bootstrap_marker.write_text(
                json.dumps({"phase": "active", "table": guard.BOOTSTRAP_TABLE}),
                encoding="ascii",
            )
            with patch.object(
                guard,
                "_network_details",
                return_value=("172.30.0.1", INTERFACE),
            ), patch.object(
                guard, "_database_ipv4", return_value=DATABASE_IP
            ), patch.object(
                guard, "_verify_firewall"
            ), patch.object(
                guard, "_run"
            ) as run:
                with self.assertRaisesRegex(
                    guard.GuardError, "firewall-policy-unverified"
                ):
                    guard.handoff_bootstrap(
                        str(bootstrap_marker),
                        str(final_marker),
                        "other-network",
                        "a" * 12,
                        "synthetic-project",
                    )
            run.assert_not_called()
            self.assertTrue(bootstrap_marker.exists())

    def test_bootstrap_cleanup_requires_all_project_resources_gone(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-bootstrap-guard.json"
            with patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess(
                    [], 0, f"table inet {guard.BOOTSTRAP_TABLE}\n", ""
                ),
            ):
                with self.assertRaisesRegex(
                    guard.GuardError, "bootstrap-cleanup-firewall-unverified"
                ):
                    guard.remove_bootstrap(str(marker), "synthetic-project")
            marker.write_text(
                json.dumps({"phase": "active", "table": guard.BOOTSTRAP_TABLE}),
                encoding="ascii",
            )
            with patch.object(
                guard, "_run", side_effect=[
                    subprocess.CompletedProcess([], 0, "container\n", "")
                ]
            ) as run:
                with self.assertRaisesRegex(
                    guard.GuardError, "bootstrap-resources-remain"
                ):
                    guard.remove_bootstrap(str(marker), "synthetic-project")
            run.assert_called_once()
            self.assertTrue(marker.exists())

            with patch.object(
                guard, "_run", side_effect=[
                    subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess([], 0, "", ""),
                    subprocess.CompletedProcess(
                        [], 0, f"table inet {guard.BOOTSTRAP_TABLE}\n", ""
                    ),
                    subprocess.CompletedProcess([], 0, "", ""),
                ]
            ) as run, patch.object(guard, "_verify_bootstrap_firewall") as verify:
                guard.remove_bootstrap(str(marker), "synthetic-project")
            self.assertFalse(marker.exists())
            self.assertEqual(
                run.call_args_list[-1].args[0],
                ["nft", "delete", "table", "inet", guard.BOOTSTRAP_TABLE],
            )
            verify.assert_called_once_with()

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
        self.assertIn("getent hosts db", run.call_args.args[0][-1])
        self.assertIn("nslookup example.com", run.call_args.args[0][-1])
        for returncode, error in (
            (120, "dns-probe-client-missing"),
            (121, "internal-dns-unverified"),
            (122, "external-dns-resolves"),
            (125, "dns-probe-failed"),
        ):
            with self.subTest(returncode=returncode), patch.object(
                guard,
                "_run",
                return_value=subprocess.CompletedProcess([], returncode, "", ""),
            ):
                with self.assertRaisesRegex(guard.GuardError, error):
                    guard._run_dns_probe("restore-synthetic", guard.PINNED_IMAGE)
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 121, "", ""),
        ):
            with self.assertRaisesRegex(
                guard.GuardError, "database-namespace-dns-unverified"
            ):
                guard._run_dns_probe(
                    "restore-synthetic",
                    guard.PINNED_IMAGE,
                    database_container="0123456789abcdef",
                )

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

    def test_both_marker_helpers_reject_symlinked_runner_temp_parents(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            real_parent = base / "real-runner-temp"
            real_parent.mkdir()
            linked_parent = base / "runner-temp-link"
            try:
                linked_parent.symlink_to(real_parent, target_is_directory=True)
            except (OSError, NotImplementedError):
                if os.name == "nt":
                    self.skipTest("Windows does not permit symlink creation in this environment")
                raise
            with patch.dict(os.environ, {"RUNNER_TEMP": str(linked_parent)}):
                with self.assertRaisesRegex(guard.GuardError, "marker-invalid"):
                    guard._marker_path(str(linked_parent / "restore-runner-network-guard.json"))
                with self.assertRaisesRegex(guard.GuardError, "bootstrap-marker-invalid"):
                    guard._bootstrap_marker_path(
                        str(linked_parent / "restore-runner-bootstrap-guard.json")
                    )

    def test_bootstrap_marker_helper_rejects_a_final_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {"RUNNER_TEMP": temporary}):
                target = Path(temporary) / "target.json"
                target.write_text("{}", encoding="ascii")
                marker = Path(temporary) / "restore-runner-bootstrap-guard.json"
                try:
                    marker.symlink_to(target)
                except (OSError, NotImplementedError):
                    if os.name == "nt":
                        self.skipTest("Windows does not permit symlink creation in this environment")
                    raise
                with self.assertRaisesRegex(guard.GuardError, "bootstrap-marker-invalid"):
                    guard._bootstrap_marker_path(str(marker))

    def test_marker_writer_preserves_preexisting_temp_and_removes_its_partial_temp(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ):
            marker = Path(temporary) / "restore-runner-network-guard.json"
            temp_marker = Path(str(marker) + ".tmp")
            temp_marker.write_bytes(b"SYNTHETIC_PREEXISTING_MARKER_SENTINEL")
            with self.assertRaisesRegex(guard.GuardError, "marker-state-invalid"):
                guard._write_marker(marker, {
                    "database_ipv4": DATABASE_IP,
                    "interface": INTERFACE,
                    "network": "restore-synthetic",
                    "phase": "installing",
                    "table": guard.TABLE,
                })
            self.assertEqual(
                temp_marker.read_bytes(), b"SYNTHETIC_PREEXISTING_MARKER_SENTINEL"
            )
            temp_marker.unlink()

            with patch.object(guard.os, "replace", side_effect=OSError("synthetic replace failure")):
                with self.assertRaisesRegex(guard.GuardError, "marker-state-invalid"):
                    guard._write_marker(marker, {
                        "database_ipv4": DATABASE_IP,
                        "interface": INTERFACE,
                        "network": "restore-synthetic",
                        "phase": "installing",
                        "table": guard.TABLE,
                    })
            self.assertFalse(temp_marker.exists())
            self.assertFalse(marker.exists())

    def test_cleanup_rejects_orphan_temporary_marker_files(self):
        cases = (
            (
                "restore-runner-network-guard.json",
                {
                    "database_ipv4": DATABASE_IP,
                    "interface": INTERFACE,
                    "network": "restore-synthetic",
                    "phase": "active",
                    "table": guard.TABLE,
                },
                lambda marker: guard.remove("restore-synthetic", str(marker)),
                "marker-state-invalid",
            ),
            (
                "restore-runner-bootstrap-guard.json",
                {"phase": "active", "table": guard.BOOTSTRAP_TABLE},
                lambda marker: guard.remove_bootstrap(str(marker), "synthetic-project"),
                "bootstrap-marker-state-invalid",
            ),
        )
        for filename, record, cleanup, error in cases:
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary, patch.dict(
                os.environ, {"RUNNER_TEMP": temporary}
            ), patch.object(guard, "_run") as run:
                marker = Path(temporary) / filename
                marker.write_text(json.dumps(record), encoding="ascii")
                temp_marker = Path(str(marker) + ".tmp")
                temp_marker.write_bytes(b"SYNTHETIC_INTERRUPTED_MARKER_WRITE")
                with self.assertRaisesRegex(guard.GuardError, error):
                    cleanup(marker)
                self.assertTrue(marker.exists())
                self.assertEqual(temp_marker.read_bytes(), b"SYNTHETIC_INTERRUPTED_MARKER_WRITE")
                run.assert_not_called()

    def test_missing_host_marker_requires_verified_firewall_absence(self):
        results = (
            (subprocess.CompletedProcess([], 0, "table inet unrelated\n", ""), False),
            (
                subprocess.CompletedProcess([], 0, f"table inet {guard.TABLE}\n", ""),
                True,
            ),
            (subprocess.CompletedProcess([], 1, "", "SYNTHETIC_PRIVATE_SENTINEL"), True),
        )
        for result, should_fail in results:
            with self.subTest(result=result), tempfile.TemporaryDirectory() as temporary, patch.dict(
                os.environ, {"RUNNER_TEMP": temporary}
            ), patch.object(guard, "_run", return_value=result) as run, patch(
                "builtins.print"
            ) as printed:
                marker = Path(temporary) / "restore-runner-network-guard.json"
                if should_fail:
                    with self.assertRaisesRegex(
                        guard.GuardError, "cleanup-firewall-unverified"
                    ):
                        guard.remove("restore-synthetic", str(marker))
                    printed.assert_not_called()
                else:
                    guard.remove("restore-synthetic", str(marker))
                    printed.assert_called_once_with(
                        "restore-runner-host-guard-cleanup=not-installed"
                    )
                run.assert_called_once_with(["nft", "list", "tables"])

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

        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"RUNNER_TEMP": temporary}
        ), patch.object(
            guard, "bootstrap", side_effect=RuntimeError("SYNTHETIC_PRIVATE_SENTINEL")
        ):
            from contextlib import redirect_stderr, redirect_stdout
            from io import StringIO

            stdout = StringIO()
            stderr = StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                result = guard.main([
                    "bootstrap",
                    "--marker",
                    str(Path(temporary) / "restore-runner-bootstrap-guard.json"),
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
