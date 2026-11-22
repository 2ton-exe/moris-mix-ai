"""Synthetic checks for the fail-closed owner VM network guard."""

import errno
import json
import subprocess
import unittest
from unittest.mock import Mock, call, patch

import owner_restore_network_guard as guard


BRIDGE = "br-0123456789ab"
NETWORK = "supabase_network_restore_diagnostic"
NETWORK_ID = "0123456789abcdef" * 4


def firewall_output(bridge=BRIDGE):
    return f'''\
table inet owner_restore_diag {{
 chain output {{
  type filter hook output priority -150; policy drop;
  oifname "lo" accept
  oifname "br-*" accept
 }}
 chain forward {{
  type filter hook forward priority -150; policy drop;
  iifname "veth*" oifname "veth*" accept
 }}
}}
'''


class OwnerRestoreNetworkGuardTests(unittest.TestCase):
    def test_ruleset_drops_external_host_and_container_forwarding(self):
        rules = guard._ruleset()
        self.assertEqual(rules.count("policy drop"), 2)
        self.assertIn('output oifname "lo" accept', rules)
        self.assertIn('output oifname "br-*" accept', rules)
        self.assertIn('forward iifname "veth*" oifname "veth*" accept', rules)
        self.assertNotIn('oifname "eth0" accept', rules)

    def test_firewall_verifier_accepts_exact_allowlist(self):
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, firewall_output(), ""),
        ):
            guard._verify_firewall_table()

    def test_firewall_verifier_rejects_external_accept_rule(self):
        weakened = firewall_output().replace(
            'oifname "br-*" accept\n',
            'oifname "br-*" accept\n  oifname "eth0" accept\n',
        )
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, weakened, ""),
        ):
            with self.assertRaisesRegex(guard.NetworkGuardError, "firewall-allowlist"):
                guard._verify_firewall_table()

    def test_firewall_verifier_fails_if_a_hook_defaults_to_accept(self):
        weakened = firewall_output().replace("policy drop", "policy accept", 1)
        with patch.object(
            guard,
            "_run",
            return_value=subprocess.CompletedProcess([], 0, weakened, ""),
        ):
            with self.assertRaisesRegex(guard.NetworkGuardError, "firewall-default-policy"):
                guard._verify_firewall_table()

    def test_docker_network_requires_local_bridge_and_live_interface(self):
        inspect = json.dumps([{
            "Id": NETWORK_ID,
            "Driver": "bridge",
            "Scope": "local",
            "Options": {},
        }])
        with patch.object(guard, "_run", side_effect=[
            subprocess.CompletedProcess([], 0, inspect, ""),
            subprocess.CompletedProcess([], 0, "12: br-0123456789ab: <BROADCAST,UP>\n", ""),
            subprocess.CompletedProcess([], 0, "bridge\nhost\nnull\n", ""),
        ]) as run:
            self.assertEqual(guard._docker_bridge_interface(NETWORK), BRIDGE)
            self.assertEqual(run.call_args_list[1], call(["ip", "-o", "link", "show", "dev", BRIDGE]))
            self.assertEqual(
                run.call_args_list[2],
                call(["docker", "network", "ls", "--format", "{{.Driver}}"]),
            )

    def test_docker_network_rejects_non_bridge_or_missing_interface(self):
        macvlan = json.dumps([{
            "Id": NETWORK_ID,
            "Driver": "macvlan",
            "Scope": "local",
            "Options": {},
        }])
        with patch.object(
            guard, "_run", return_value=subprocess.CompletedProcess([], 0, macvlan, "")
        ):
            with self.assertRaisesRegex(guard.NetworkGuardError, "docker-network-driver"):
                guard._docker_bridge_interface(NETWORK)
        inspect = json.dumps([{
            "Id": NETWORK_ID,
            "Driver": "bridge",
            "Scope": "local",
            "Options": {},
        }])
        with patch.object(guard, "_run", side_effect=[
            subprocess.CompletedProcess([], 0, inspect, ""),
            subprocess.CompletedProcess([], 1, "", "synthetic missing interface"),
        ]):
            with self.assertRaisesRegex(guard.NetworkGuardError, "docker-bridge-interface"):
                guard._docker_bridge_interface(NETWORK)

    def test_network_supplied_by_operator_is_validated_before_command_use(self):
        with patch.object(guard, "_run") as run:
            with self.assertRaisesRegex(guard.NetworkGuardError, "docker-network-driver"):
                guard._docker_bridge_interface("network;unexpected")
        run.assert_not_called()

    def test_host_probe_accepts_blocked_routes_and_rejects_reachable_or_refused(self):
        with patch.object(guard.socket, "create_connection", side_effect=TimeoutError()) as probe:
            guard._host_egress_is_blocked()
            self.assertEqual(probe.call_count, len(guard.PROBES))
        with patch.object(guard.socket, "create_connection", return_value=Mock()):
            with self.assertRaisesRegex(guard.NetworkGuardError, "host-egress-reachable"):
                guard._host_egress_is_blocked()
        with patch.object(
            guard.socket,
            "create_connection",
            side_effect=OSError(errno.ECONNREFUSED, "synthetic refusal"),
        ):
            with self.assertRaisesRegex(guard.NetworkGuardError, "host-egress-unverified"):
                guard._host_egress_is_blocked()

    def test_docker_probe_checks_tcp_inside_container_network_and_cleans_up(self):
        container_id = "a" * 64
        for probe_status in (0, 1):
            with self.subTest(probe_status=probe_status), patch.object(guard, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, container_id + "\n", ""),
                subprocess.CompletedProcess([], 0, "1234\n", ""),
                subprocess.CompletedProcess([], probe_status, "", ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]) as run:
                if probe_status == 0:
                    guard._docker_egress_is_blocked(NETWORK, guard.PSQL_IMAGE)
                else:
                    with self.assertRaisesRegex(guard.NetworkGuardError, "docker-egress-unverified"):
                        guard._docker_egress_is_blocked(NETWORK, guard.PSQL_IMAGE)
                self.assertEqual(run.call_args_list[2].args[0][:2], ["nsenter", "--net=/proc/1234/ns/net"])
                self.assertEqual(run.call_args_list[3], call(["docker", "rm", "-f", container_id]))

    def test_loopback_check_requires_successful_local_query(self):
        success = subprocess.CompletedProcess([], 0, "1\n", "")
        with patch.object(guard, "_run", return_value=success):
            guard._check_loopback_database(guard.PSQL_IMAGE, "postgresql://local")
        failure = subprocess.CompletedProcess([], 1, "", "connection refused")
        with patch.object(guard, "_run", return_value=failure):
            with self.assertRaisesRegex(guard.NetworkGuardError, "loopback-database-unavailable"):
                guard._check_loopback_database(guard.PSQL_IMAGE, "postgresql://local")

    def test_apply_and_verify_reject_any_image_other_than_the_repository_pin(self):
        other_digest = "postgres:17.11-alpine@sha256:" + ("0" * 64)
        for command in (guard.apply, guard.verify):
            with self.subTest(command=command.__name__):
                with patch.object(guard, "_run") as run, patch.object(
                    guard, "_firewall_table_exists"
                ) as table_exists:
                    with self.assertRaisesRegex(guard.NetworkGuardError, "client-image-mismatch"):
                        command(NETWORK, other_digest, "postgresql://local")
                run.assert_not_called()
                table_exists.assert_not_called()


if __name__ == "__main__":
    unittest.main()
