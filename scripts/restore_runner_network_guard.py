"""Apply and verify a temporary host-ingress guard for Stage B restore SQL.

This is scoped to the disposable GitHub-hosted runner used by Stage B. The
Docker bridge blocks routed egress; this guard closes the bridge-to-host path.
Only fixed labels are written to stdout or stderr.
"""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading


TABLE = "restore_stage_b"
PINNED_IMAGE = (
    "postgres:17.11-alpine@sha256:"
    "266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
)
NETWORK_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
CONTAINER_RE = re.compile(r"[0-9a-f]{12,64}")
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$")
ALLOWED_FAILURES = {
    "docker-version-unverified",
    "docker-version-unsupported",
    "docker-network-unverified",
    "docker-network-mismatch",
    "docker-container-unverified",
    "firewall-unavailable",
    "firewall-table-exists",
    "firewall-install-failed",
    "firewall-policy-unverified",
    "host-route-unverified",
    "host-route-reachable-after-guard",
    "internal-dns-unverified",
    "external-dns-resolves",
    "marker-invalid",
    "marker-exists",
    "cleanup-network-unverified",
    "cleanup-network-still-present",
    "cleanup-firewall-unverified",
    "cleanup-marker-failed",
    "client-image-mismatch",
    "network-guard-failed",
}


class GuardError(ValueError):
    """A fail-closed runner network guard check failed."""


def _run(command, *, input_text=None, timeout=20):
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
        raise GuardError("network-guard-failed") from error


def _marker_path(path):
    runner_temp = os.environ.get("RUNNER_TEMP")
    if not runner_temp:
        raise GuardError("marker-invalid")
    expected = Path(runner_temp).resolve() / "restore-runner-network-guard.json"
    supplied = Path(path)
    if supplied.resolve() != expected or supplied.is_symlink():
        raise GuardError("marker-invalid")
    return expected


def _server_version_supported():
    result = _run(["docker", "version", "--format", "{{.Server.Version}}"])
    if result.returncode != 0:
        raise GuardError("docker-version-unverified")
    version = VERSION_RE.fullmatch(result.stdout.strip())
    if version is None:
        raise GuardError("docker-version-unverified")
    major, minor, patch = (int(part) for part in version.groups())
    # Moby fixed external DNS forwarding from internal-only networks in 25.0.5.
    if (major, minor, patch) < (25, 0, 5):
        raise GuardError("docker-version-unsupported")


def _network_record(network, project_id):
    if not isinstance(network, str) or NETWORK_RE.fullmatch(network) is None:
        raise GuardError("docker-network-unverified")
    result = _run(["docker", "network", "inspect", network])
    if result.returncode != 0:
        raise GuardError("docker-network-unverified")
    try:
        records = json.loads(result.stdout)
        record = records[0]
        ipam = record["IPAM"]["Config"]
        gateway = ipaddress.ip_address(ipam[0]["Gateway"])
        labels = record.get("Labels") or {}
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise GuardError("docker-network-unverified") from error
    if (
        len(records) != 1
        or record.get("Driver") != "bridge"
        or record.get("Internal") is not True
        or record.get("EnableIPv6") is not False
        or gateway.version != 4
        or labels.get("com.supabase.cli.project") != project_id
        or labels.get("com.docker.compose.project") != project_id
    ):
        raise GuardError("docker-network-mismatch")
    return str(gateway)


def _database_networks(container_id, network):
    if not isinstance(container_id, str) or CONTAINER_RE.fullmatch(container_id) is None:
        raise GuardError("docker-container-unverified")
    result = _run(["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", container_id])
    if result.returncode != 0:
        raise GuardError("docker-container-unverified")
    try:
        networks = json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as error:
        raise GuardError("docker-container-unverified") from error
    if not isinstance(networks, dict) or set(networks) != {network}:
        raise GuardError("docker-network-mismatch")


def _ruleset():
    return f'''\
add table inet {TABLE}
add chain inet {TABLE} input {{ type filter hook input priority -150; policy drop; }}
add rule inet {TABLE} input iifname "lo" accept
add rule inet {TABLE} input ct state established,related accept
'''


def _verify_firewall():
    result = _run(["nft", "--numeric-priority", "list", "table", "inet", TABLE])
    if result.returncode != 0 or not result.stdout.lstrip().startswith(f"table inet {TABLE} {{"):
        raise GuardError("firewall-policy-unverified")
    chains = re.findall(
        r"^\s*chain\s+([A-Za-z0-9_-]+)\s*\{(.*?)^\s*\}",
        result.stdout,
        re.MULTILINE | re.DOTALL,
    )
    if len(chains) != 1 or chains[0][0] != "input":
        raise GuardError("firewall-policy-unverified")
    lines = [line.strip() for line in chains[0][1].splitlines() if line.strip()]
    expected = [
        "type filter hook input priority -150; policy drop;",
        'iifname "lo" accept',
        "ct state established,related accept",
    ]
    if lines != expected:
        raise GuardError("firewall-policy-unverified")


def _start_host_listener(gateway):
    try:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((gateway, 0))
        listener.listen(4)
        listener.settimeout(0.2)
    except OSError as error:
        raise GuardError("host-route-unverified") from error
    stopped = threading.Event()

    def accept_and_close():
        while not stopped.is_set():
            try:
                connection, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            connection.close()

    thread = threading.Thread(target=accept_and_close, daemon=True)
    thread.start()
    return listener, stopped, thread, listener.getsockname()[1]


def _run_host_probe(network, gateway, port, image, *, database_container=None):
    command = ["docker", "run", "--rm"]
    if database_container is None:
        command.extend(["--network", network])
    else:
        command.extend(["--network", f"container:{database_container}"])
    command.extend([
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
        "--entrypoint", "sh", image,
        "-c", 'nc -z -w 2 "$1" "$2"', "restore-host-probe", gateway, str(port),
    ])
    result = _run(command, timeout=15)
    if result.returncode not in (0, 1):
        raise GuardError("host-route-unverified")
    return result.returncode == 0


def _run_dns_probe(network, image, *, database_container=None):
    command = ["docker", "run", "--rm"]
    if database_container is None:
        command.extend(["--network", network])
    else:
        command.extend(["--network", f"container:{database_container}"])
    command.extend([
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
        "--entrypoint", "sh", image,
        "-c",
        "command -v nslookup >/dev/null 2>&1 || exit 120; "
        "nslookup db >/dev/null 2>&1 || exit 121; "
        "if nslookup example.com >/dev/null 2>&1; then exit 122; fi; exit 0",
    ])
    result = _run(command, timeout=15)
    if result.returncode == 122:
        raise GuardError("external-dns-resolves")
    if result.returncode != 0:
        raise GuardError("internal-dns-unverified")


def apply(network, database_container, project_id, image, marker):
    marker = _marker_path(marker)
    if image != PINNED_IMAGE:
        raise GuardError("client-image-mismatch")
    if not shutil.which("nft"):
        raise GuardError("firewall-unavailable")
    _server_version_supported()
    gateway = _network_record(network, project_id)
    _database_networks(database_container, network)
    exists = _run(["nft", "list", "table", "inet", TABLE])
    if exists.returncode == 0:
        raise GuardError("firewall-table-exists")
    if marker.exists():
        raise GuardError("marker-exists")

    listener, stopped, thread, port = _start_host_listener(gateway)
    try:
        if not _run_host_probe(network, gateway, port, image):
            raise GuardError("host-route-unverified")
        if not _run_host_probe(network, gateway, port, image, database_container=database_container):
            raise GuardError("host-route-unverified")

        marker.write_text(json.dumps({"network": network, "table": TABLE}), encoding="ascii")
        os.chmod(marker, 0o600)
        result = _run(["nft", "-f", "-"], input_text=_ruleset())
        if result.returncode != 0:
            raise GuardError("firewall-install-failed")
        _verify_firewall()
        if _run_host_probe(network, gateway, port, image):
            raise GuardError("host-route-reachable-after-guard")
        if _run_host_probe(network, gateway, port, image, database_container=database_container):
            raise GuardError("host-route-reachable-after-guard")
        _run_dns_probe(network, image)
        _run_dns_probe(network, image, database_container=database_container)
    finally:
        stopped.set()
        listener.close()
        thread.join(timeout=1)


def remove(network, marker):
    marker = _marker_path(marker)
    if not marker.exists():
        print("restore-runner-host-guard-cleanup=not-installed")
        return
    if marker.is_symlink():
        raise GuardError("marker-invalid")
    try:
        record = json.loads(marker.read_text(encoding="ascii"))
    except (OSError, json.JSONDecodeError) as error:
        raise GuardError("marker-invalid") from error
    if record != {"network": network, "table": TABLE}:
        raise GuardError("marker-invalid")
    networks = _run(["docker", "network", "ls", "--format", "{{.Name}}"])
    if networks.returncode != 0:
        raise GuardError("cleanup-network-unverified")
    if network in networks.stdout.splitlines():
        raise GuardError("cleanup-network-still-present")
    _verify_firewall()
    deleted = _run(["nft", "delete", "table", "inet", TABLE])
    if deleted.returncode != 0:
        raise GuardError("cleanup-firewall-unverified")
    try:
        marker.unlink()
    except OSError as error:
        raise GuardError("cleanup-marker-failed") from error
    print("restore-runner-host-guard-cleanup=pass")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    install = subparsers.add_parser("apply")
    install.add_argument("--docker-network", required=True)
    install.add_argument("--database-container", required=True)
    install.add_argument("--project-id", required=True)
    install.add_argument("--psql-image", default=PINNED_IMAGE)
    install.add_argument("--marker", required=True)
    cleanup = subparsers.add_parser("remove")
    cleanup.add_argument("--docker-network", required=True)
    cleanup.add_argument("--marker", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "apply":
            apply(
                args.docker_network,
                args.database_container,
                args.project_id,
                args.psql_image,
                args.marker,
            )
        else:
            remove(args.docker_network, args.marker)
    except Exception as error:
        reason = error.args[0] if isinstance(error, GuardError) else "network-guard-failed"
        if reason not in ALLOWED_FAILURES:
            reason = "network-guard-failed"
        print(f"Restore runner network guard failed ({reason}).", file=sys.stderr)
        return 1
    if args.command == "apply":
        print("restore-runner-host-guard=verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
