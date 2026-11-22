"""Install and verify a temporary host/Docker network deny policy.

This command is intended only for the disposable owner-run Linux VM described
in docs/devops/owner-restore-diagnostic.md. It blocks non-local host traffic and
Docker external forwarding while preserving loopback, host access to local
Docker bridges, and container-to-container forwarding. Provider policy must
also deny external ingress and egress. It never prints probe destinations or
raw firewall output.
"""

import argparse
import errno
import json
from pathlib import Path
import re
import socket
import subprocess
import sys


TABLE = "owner_restore_diag"
PSQL_IMAGE = (
    "postgres:17.11-alpine@sha256:"
    "266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
)
PROBES = (
    ("1.1.1.1", 443),
    ("8.8.8.8", 443),
    ("2606:4700:4700::1111", 443),
    ("2001:4860:4860::8888", 443),
)
BLOCKED_ERRNOS = {
    errno.EACCES,
    errno.EPERM,
    errno.ENETUNREACH,
    errno.EHOSTUNREACH,
    errno.ETIMEDOUT,
}
BRIDGE_NAME = re.compile(r"[A-Za-z0-9_.-]{1,15}")


class NetworkGuardError(ValueError):
    """A network isolation condition is missing or not verifiable."""


def _run(command, *, input_text=None, timeout=15):
    try:
        return subprocess.run(
            command,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise NetworkGuardError("network-check-unavailable") from error


def _firewall_table_exists():
    result = _run(["nft", "list", "table", "inet", TABLE])
    return result.returncode == 0


def _docker_bridge_interface(network):
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", network) is None:
        raise NetworkGuardError("docker-network-driver")
    result = _run(["docker", "network", "inspect", network])
    if result.returncode != 0:
        raise NetworkGuardError("docker-network-driver")
    try:
        records = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise NetworkGuardError("docker-network-inspect") from error
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise NetworkGuardError("docker-network-inspect")
    record = records[0]
    network_id = record.get("Id")
    options = record.get("Options")
    if (
        record.get("Driver") != "bridge"
        or record.get("Scope") != "local"
        or not isinstance(network_id, str)
        or re.fullmatch(r"[0-9a-f]{64}", network_id) is None
        or not isinstance(options, dict)
    ):
        raise NetworkGuardError("docker-network-driver")
    bridge = options.get("com.docker.network.bridge.name") or f"br-{network_id[:12]}"
    if not isinstance(bridge, str) or BRIDGE_NAME.fullmatch(bridge) is None:
        raise NetworkGuardError("docker-bridge-interface")
    link = _run(["ip", "-o", "link", "show", "dev", bridge])
    if link.returncode != 0:
        raise NetworkGuardError("docker-bridge-interface")
    all_networks = _run(["docker", "network", "ls", "--format", "{{.Driver}}"])
    if all_networks.returncode != 0 or not all_networks.stdout.strip():
        raise NetworkGuardError("docker-network-list")
    if any(
        driver not in {"bridge", "host", "null"}
        for driver in all_networks.stdout.splitlines()
    ):
        raise NetworkGuardError("docker-network-driver")
    return bridge


def _ruleset():
    return f'''\
add table inet {TABLE}
add chain inet {TABLE} output {{ type filter hook output priority -150; policy drop; }}
add rule inet {TABLE} output oifname "lo" accept
add rule inet {TABLE} output oifname "br-*" accept
add chain inet {TABLE} forward {{ type filter hook forward priority -150; policy drop; }}
add rule inet {TABLE} forward iifname "veth*" oifname "veth*" accept
'''


def _verify_firewall_table():
    result = _run(["nft", "--numeric-priority", "list", "table", "inet", TABLE])
    if result.returncode != 0:
        raise NetworkGuardError("firewall-table-missing")
    output = result.stdout
    if not output.lstrip().startswith(f"table inet {TABLE} {{"):
        raise NetworkGuardError("firewall-table-name")
    chains = re.findall(r"^\s*chain\s+([A-Za-z0-9_-]+)\s*\{(.*?)^\s*\}", output, re.MULTILINE | re.DOTALL)
    chain_names = {name for name, _ in chains}
    if len(chains) != 2 or chain_names != {"output", "forward"}:
        raise NetworkGuardError("firewall-chain-set")
    expected_rules = {
        "output": {'oifname "lo" accept', 'oifname "br-*" accept'},
        "forward": {'iifname "veth*" oifname "veth*" accept'},
    }
    for name, body in chains:
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        if not lines or lines[0] != f"type filter hook {name} priority -150; policy drop;":
            raise NetworkGuardError("firewall-default-policy")
        if set(lines[1:]) != expected_rules[name] or len(lines[1:]) != len(expected_rules[name]):
            raise NetworkGuardError("firewall-allowlist")


def _host_egress_is_blocked():
    for address, port in PROBES:
        try:
            connection = socket.create_connection((address, port), timeout=2)
        except OSError as error:
            if isinstance(error, TimeoutError) or error.errno in BLOCKED_ERRNOS:
                continue
            raise NetworkGuardError("host-egress-unverified") from error
        else:
            connection.close()
            raise NetworkGuardError("host-egress-reachable")


def _docker_egress_is_blocked(network, image):
    container = _run([
        "docker", "run", "--detach", "--rm", "--network", network,
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--read-only", image, "sleep", "60",
    ])
    container_id = container.stdout.strip()
    if container.returncode != 0 or re.fullmatch(r"[0-9a-f]{64}", container_id) is None:
        raise NetworkGuardError("docker-egress-unverified")
    try:
        inspected = _run(["docker", "inspect", "--format", "{{.State.Pid}}", container_id])
        pid = inspected.stdout.strip()
        if inspected.returncode != 0 or re.fullmatch(r"[1-9][0-9]*", pid) is None:
            raise NetworkGuardError("docker-egress-unverified")
        # Run the same TCP connect checks in the container network namespace.
        # No PostgreSQL handshake or DNS lookup is needed to detect egress.
        result = _run(
            [
                "nsenter", f"--net=/proc/{pid}/ns/net", "--", sys.executable,
                "-I", "-c", "import runpy, sys; runpy.run_path(sys.argv[1])['_host_egress_is_blocked']()",
                str(Path(__file__).resolve()),
            ],
            timeout=15,
        )
        if result.returncode != 0:
            raise NetworkGuardError("docker-egress-unverified")
    finally:
        removed = _run(["docker", "rm", "-f", container_id])
        if removed.returncode != 0:
            raise NetworkGuardError("docker-egress-unverified")


def _check_loopback_database(image, dsn):
    result = _run(
        [
            "docker", "run", "--rm", "--network", "host",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--read-only", image, "psql", "-X", "-q", "-A", "-t",
            "--no-password", "-v", "ON_ERROR_STOP=1", "-d", dsn,
            "-c", "SELECT 1",
        ],
        timeout=10,
    )
    if result.returncode != 0 or result.stdout.strip() != "1":
        raise NetworkGuardError("loopback-database-unavailable")


def verify(network, image, dsn):
    if image != PSQL_IMAGE:
        raise NetworkGuardError("client-image-mismatch")
    _docker_bridge_interface(network)
    _verify_firewall_table()
    _host_egress_is_blocked()
    _docker_egress_is_blocked(network, image)
    _check_loopback_database(image, dsn)


def apply(network, image, dsn):
    if image != PSQL_IMAGE:
        raise NetworkGuardError("client-image-mismatch")
    if _firewall_table_exists():
        raise NetworkGuardError("firewall-table-already-exists")
    _docker_bridge_interface(network)
    result = _run(["nft", "-f", "-"], input_text=_ruleset())
    if result.returncode != 0:
        raise NetworkGuardError("firewall-install-failed")
    verify(network, image, dsn)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("apply", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--docker-network", required=True)
        subparser.add_argument("--psql-image", default=PSQL_IMAGE)
        subparser.add_argument(
            "--local-dsn",
            default="postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        )
    args = parser.parse_args(argv)
    try:
        if args.command == "apply":
            apply(args.docker_network, args.psql_image, args.local_dsn)
        else:
            verify(args.docker_network, args.psql_image, args.local_dsn)
    except Exception as error:
        reason = error.args[0] if isinstance(error, NetworkGuardError) else "network-check-failed"
        allowed = {
            "network-check-unavailable", "firewall-table-missing", "firewall-chain-set",
            "firewall-default-policy", "firewall-hook-priority", "firewall-allowlist",
            "docker-network-driver", "docker-network-inspect", "docker-bridge-interface",
            "docker-network-list", "firewall-table-name",
            "host-egress-unverified", "host-egress-reachable", "docker-egress-unverified",
            "loopback-database-unavailable", "client-image-mismatch",
            "firewall-table-already-exists", "firewall-install-failed",
        }
        if reason not in allowed:
            reason = "network-check-failed"
        print(f"Owner restore network isolation failed ({reason}).", file=sys.stderr)
        return 1
    print("Owner restore network isolation verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
