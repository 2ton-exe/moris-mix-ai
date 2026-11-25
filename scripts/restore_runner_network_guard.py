"""Verify host and Docker ingress isolation for the disposable Stage B database.

The pinned Supabase CLI needs a host-loopback readiness check while starting
the empty database. A narrow bootstrap guard denies non-loopback PostgreSQL
ingress first; after the database moves to a verified internal IPv4 bridge,
the final guard takes over and the bootstrap guard is removed. Both guards are
verified before private backup data or R2 credentials are introduced. Public
output uses fixed labels.
"""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import socket
import subprocess
import sys
import threading


TABLE = "restore_stage_b"
BOOTSTRAP_TABLE = "restore_stage_b_bootstrap"
PINNED_IMAGE = (
    "postgres:17.11-alpine@sha256:"
    "266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
)
NETWORK_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
CONTAINER_RE = re.compile(r"[0-9a-f]{12,64}")
INTERFACE_RE = re.compile(r"[A-Za-z0-9_.:-]{1,15}")
ALLOWED_FAILURES = {
    "docker-network-unverified",
    "docker-network-mismatch",
    "docker-container-unverified",
    "database-ip-unverified",
    "firewall-unavailable",
    "firewall-table-exists",
    "firewall-install-failed",
    "firewall-policy-unverified",
    "host-route-unverified",
    "host-route-reachable-after-guard",
    "internal-dns-unverified",
    "database-namespace-dns-unverified",
    "dns-probe-client-missing",
    "dns-probe-failed",
    "external-dns-resolves",
    "published-port-unverified",
    "published-port-reachable",
    "marker-invalid",
    "marker-exists",
    "marker-state-invalid",
    "cleanup-network-unverified",
    "cleanup-network-still-present",
    "cleanup-firewall-unverified",
    "cleanup-marker-failed",
    "client-image-mismatch",
    "bootstrap-firewall-table-exists",
    "bootstrap-firewall-install-failed",
    "bootstrap-firewall-policy-unverified",
    "bootstrap-marker-invalid",
    "bootstrap-marker-exists",
    "bootstrap-marker-state-invalid",
    "bootstrap-resources-remain",
    "bootstrap-cleanup-firewall-unverified",
    "bootstrap-cleanup-marker-failed",
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


def _path_contains_symlink_component(path):
    candidate = Path(path)
    if not candidate.is_absolute() or ".." in candidate.parts:
        return True
    current = Path(candidate.anchor)
    for component in candidate.parts[1:]:
        current /= component
        try:
            details = current.lstat()
        except FileNotFoundError:
            return False
        except OSError:
            return True
        if stat.S_ISLNK(details.st_mode) or (
            getattr(details, "st_file_attributes", 0) & 0x400
        ):
            return True
    return False


def _marker_path(path):
    runner_temp = os.environ.get("RUNNER_TEMP")
    if not runner_temp:
        raise GuardError("marker-invalid")
    runner_path = Path(runner_temp)
    supplied = Path(path)
    if (
        _path_contains_symlink_component(runner_path)
        or _path_contains_symlink_component(supplied)
    ):
        raise GuardError("marker-invalid")
    expected = runner_path.resolve() / "restore-runner-network-guard.json"
    if supplied.resolve() != expected:
        raise GuardError("marker-invalid")
    return expected


def _bootstrap_marker_path(path):
    runner_temp = os.environ.get("RUNNER_TEMP")
    if not runner_temp:
        raise GuardError("bootstrap-marker-invalid")
    runner_path = Path(runner_temp)
    supplied = Path(path)
    if (
        _path_contains_symlink_component(runner_path)
        or _path_contains_symlink_component(supplied)
    ):
        raise GuardError("bootstrap-marker-invalid")
    expected = runner_path.resolve() / "restore-runner-bootstrap-guard.json"
    if supplied.resolve() != expected:
        raise GuardError("bootstrap-marker-invalid")
    return expected


def _bootstrap_ruleset():
    """Protect Supabase's published port while its empty DB starts."""
    return "\n".join(
        [
            f"add table inet {BOOTSTRAP_TABLE}",
            f"add chain inet {BOOTSTRAP_TABLE} input {{ type filter hook input priority -150; policy accept; }}",
            f"add rule inet {BOOTSTRAP_TABLE} input iifname \"lo\" ip daddr 127.0.0.1 tcp dport 54322 accept",
            f"add rule inet {BOOTSTRAP_TABLE} input tcp dport 54322 drop",
            f"add chain inet {BOOTSTRAP_TABLE} forward {{ type filter hook forward priority -1; policy accept; }}",
            f"add rule inet {BOOTSTRAP_TABLE} forward iifname \"lo\" meta nfproto ipv4 ct status dnat tcp dport 5432 accept",
            f"add rule inet {BOOTSTRAP_TABLE} forward tcp dport 5432 drop",
        ]
    ) + "\n"


def _verify_bootstrap_firewall():
    result = _run(
        ["nft", "--numeric-priority", "list", "table", "inet", BOOTSTRAP_TABLE]
    )
    if result.returncode != 0 or not result.stdout.lstrip().startswith(
        f"table inet {BOOTSTRAP_TABLE} {{"
    ):
        raise GuardError("bootstrap-firewall-policy-unverified")
    chains = dict(
        re.findall(
            r"^\s*chain\s+([A-Za-z0-9_-]+)\s*\{(.*?)^\s*\}",
            result.stdout,
            re.MULTILINE | re.DOTALL,
        )
    )
    if set(chains) != {"input", "forward"}:
        raise GuardError("bootstrap-firewall-policy-unverified")
    actual_input = [line.strip() for line in chains["input"].splitlines() if line.strip()]
    expected_input = [
        "type filter hook input priority -150; policy accept;",
        'iifname "lo" ip daddr 127.0.0.1 tcp dport 54322 accept',
        "tcp dport 54322 drop",
    ]
    actual_forward = [line.strip() for line in chains["forward"].splitlines() if line.strip()]
    expected_forward = [
        "type filter hook forward priority -1; policy accept;",
        'iifname "lo" meta nfproto ipv4 ct status dnat tcp dport 5432 accept',
        "tcp dport 5432 drop",
    ]
    if actual_input != expected_input or actual_forward != expected_forward:
        raise GuardError("bootstrap-firewall-policy-unverified")


def _read_bootstrap_marker(marker):
    _reject_temporary_marker(marker, "bootstrap-marker-state-invalid")
    if not marker.exists() or marker.is_symlink():
        raise GuardError("bootstrap-marker-state-invalid")
    try:
        record = json.loads(marker.read_text(encoding="ascii"))
    except (OSError, json.JSONDecodeError) as error:
        raise GuardError("bootstrap-marker-state-invalid") from error
    if (
        not isinstance(record, dict)
        or set(record) != {"phase", "table"}
        or record.get("table") != BOOTSTRAP_TABLE
        or record.get("phase") not in {"installing", "active"}
    ):
        raise GuardError("bootstrap-marker-state-invalid")
    return record


def _network_details(network, project_id):
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
        options = record.get("Options") or {}
        network_id = record["Id"]
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise GuardError("docker-network-unverified") from error
    if (
        len(records) != 1
        or record.get("Driver") != "bridge"
        or record.get("Internal") is not True
        or record.get("EnableIPv6") is not False
        or len(ipam) != 1
        or gateway.version != 4
        or not isinstance(network_id, str)
        or re.fullmatch(r"[0-9a-f]{64}", network_id) is None
        or labels.get("com.supabase.cli.project") != project_id
        or labels.get("com.docker.compose.project") != project_id
    ):
        raise GuardError("docker-network-mismatch")
    interface = options.get("com.docker.network.bridge.name") or f"br-{network_id[:12]}"
    if not isinstance(interface, str) or INTERFACE_RE.fullmatch(interface) is None:
        raise GuardError("docker-network-unverified")
    return str(gateway), interface


def _database_ipv4(container_id, network):
    if not isinstance(container_id, str) or CONTAINER_RE.fullmatch(container_id) is None:
        raise GuardError("docker-container-unverified")
    result = _run(
        ["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", container_id]
    )
    if result.returncode != 0:
        raise GuardError("docker-container-unverified")
    try:
        networks = json.loads(result.stdout)
        if not isinstance(networks, dict) or set(networks) != {network}:
            raise GuardError("docker-network-mismatch")
        address = ipaddress.ip_address(networks[network]["IPAddress"])
    except GuardError:
        raise
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise GuardError("database-ip-unverified") from error
    if address.version != 4:
        raise GuardError("database-ip-unverified")
    return str(address)


def _forward_rules(interface, database_ip):
    if not isinstance(interface, str) or INTERFACE_RE.fullmatch(interface) is None:
        raise GuardError("marker-state-invalid")
    try:
        address = ipaddress.ip_address(database_ip)
    except ValueError as error:
        raise GuardError("marker-state-invalid") from error
    if address.version != 4:
        raise GuardError("marker-state-invalid")
    return [
        f"add rule inet {TABLE} forward meta nfproto ipv6 tcp dport 5432 drop",
        f"add rule inet {TABLE} forward iifname \"lo\" ip daddr {address} tcp dport 5432 accept",
        f"add rule inet {TABLE} forward iifname \"{interface}\" ip daddr {address} tcp dport 5432 accept",
        f"add rule inet {TABLE} forward tcp dport 5432 drop",
    ]


def _ruleset(interface, database_ip):
    rules = [
        f"add table inet {TABLE}",
        f"add chain inet {TABLE} input {{ type filter hook input priority -150; policy drop; }}",
        f"add rule inet {TABLE} input iifname \"lo\" meta nfproto ipv6 tcp dport 54322 drop",
        f"add rule inet {TABLE} input iifname \"lo\" ip daddr != 127.0.0.1 tcp dport 54322 drop",
        f"add rule inet {TABLE} input iifname \"lo\" accept",
        f"add rule inet {TABLE} input ct state established,related accept",
        # Run after Docker DNAT (-100) and before its filter accept rules (0).
        f"add chain inet {TABLE} forward {{ type filter hook forward priority -1; policy accept; }}",
        *_forward_rules(interface, database_ip),
    ]
    return "\n".join(rules) + "\n"


def _verify_firewall(interface, database_ip):
    result = _run(["nft", "--numeric-priority", "list", "table", "inet", TABLE])
    if result.returncode != 0 or not result.stdout.lstrip().startswith(f"table inet {TABLE} {{"):
        raise GuardError("firewall-policy-unverified")
    chains = dict(
        re.findall(
            r"^\s*chain\s+([A-Za-z0-9_-]+)\s*\{(.*?)^\s*\}",
            result.stdout,
            re.MULTILINE | re.DOTALL,
        )
    )
    if set(chains) != {"input", "forward"}:
        raise GuardError("firewall-policy-unverified")
    actual_input = [line.strip() for line in chains["input"].splitlines() if line.strip()]
    expected_input = [
        "type filter hook input priority -150; policy drop;",
        'iifname "lo" meta nfproto ipv6 tcp dport 54322 drop',
        'iifname "lo" ip daddr != 127.0.0.1 tcp dport 54322 drop',
        'iifname "lo" accept',
        "ct state established,related accept",
    ]
    actual_forward = [line.strip() for line in chains["forward"].splitlines() if line.strip()]
    expected_forward = [
        "type filter hook forward priority -1; policy accept;",
        *[
            rule.removeprefix(f"add rule inet {TABLE} forward ")
            for rule in _forward_rules(interface, database_ip)
        ],
    ]
    if actual_input != expected_input or actual_forward != expected_forward:
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
    command.extend(
        [
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--read-only",
            "--entrypoint",
            "sh",
            image,
            "-c",
            'nc -z -w 2 "$1" "$2"',
            "restore-host-probe",
            gateway,
            str(port),
        ]
    )
    result = _run(command, timeout=15)
    if result.returncode not in (0, 1):
        raise GuardError("host-route-unverified")
    return result.returncode == 0


def _run_published_port_probe(image):
    command = [
        "docker",
        "run",
        "--rm",
        "--network",
        "bridge",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--entrypoint",
        "sh",
        image,
        "-c",
        "grep -q 'host.docker.internal' /etc/hosts || exit 120; nc -z -w 2 host.docker.internal 54322",
    ]
    result = _run(command, timeout=15)
    if result.returncode == 0:
        raise GuardError("published-port-reachable")
    if result.returncode != 1:
        raise GuardError("published-port-unverified")


def _default_bridge_gateway():
    result = _run(["docker", "network", "inspect", "bridge"])
    if result.returncode != 0:
        raise GuardError("host-route-unverified")
    try:
        records = json.loads(result.stdout)
        record = records[0]
        configs = record["IPAM"]["Config"]
        gateway = ipaddress.ip_address(configs[0]["Gateway"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise GuardError("host-route-unverified") from error
    if (
        len(records) != 1
        or record.get("Driver") != "bridge"
        or len(configs) != 1
        or gateway.version != 4
    ):
        raise GuardError("host-route-unverified")
    return str(gateway)


def _run_dns_probe(network, image, *, database_container=None):
    command = ["docker", "run", "--rm"]
    if database_container is None:
        command.extend(["--network", network])
    else:
        command.extend(["--network", f"container:{database_container}"])
    command.extend(
        [
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--read-only",
            "--entrypoint",
            "sh",
            image,
            "-c",
            "command -v getent >/dev/null 2>&1 || exit 120; "
            "command -v nslookup >/dev/null 2>&1 || exit 120; "
            "getent hosts db >/dev/null 2>&1 || exit 121; "
            "if nslookup example.com >/dev/null 2>&1; then exit 122; fi; exit 0",
        ]
    )
    result = _run(command, timeout=15)
    if result.returncode == 120:
        raise GuardError("dns-probe-client-missing")
    if result.returncode == 121:
        reason = (
            "database-namespace-dns-unverified"
            if database_container is not None
            else "internal-dns-unverified"
        )
        raise GuardError(reason)
    if result.returncode == 122:
        raise GuardError("external-dns-resolves")
    if result.returncode != 0:
        raise GuardError("dns-probe-failed")


def _read_marker(marker):
    _reject_temporary_marker(marker, "marker-state-invalid")
    if not marker.exists() or marker.is_symlink():
        raise GuardError("marker-state-invalid")
    try:
        record = json.loads(marker.read_text(encoding="ascii"))
    except (OSError, json.JSONDecodeError) as error:
        raise GuardError("marker-state-invalid") from error
    if (
        not isinstance(record, dict)
        or record.get("table") != TABLE
        or record.get("phase") not in {"installing", "active"}
        or not isinstance(record.get("network"), str)
        or NETWORK_RE.fullmatch(record["network"]) is None
        or not isinstance(record.get("interface"), str)
        or INTERFACE_RE.fullmatch(record["interface"]) is None
        or not isinstance(record.get("database_ipv4"), str)
    ):
        raise GuardError("marker-state-invalid")
    try:
        address = ipaddress.ip_address(record["database_ipv4"])
    except ValueError as error:
        raise GuardError("marker-state-invalid") from error
    if address.version != 4:
        raise GuardError("marker-state-invalid")
    return record


def _reject_temporary_marker(marker, reason):
    temporary = marker.with_name(marker.name + ".tmp")
    try:
        temporary.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise GuardError(reason) from error
    raise GuardError(reason)


def _write_marker(marker, record):
    temporary = marker.with_name(marker.name + ".tmp")
    descriptor = None
    created = False
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(descriptor, "w", encoding="ascii") as output:
            descriptor = None
            json.dump(record, output, sort_keys=True)
            output.write("\n")
        os.replace(temporary, marker)
    except OSError as error:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if created:
            try:
                temporary.unlink()
            except OSError:
                pass
        raise GuardError("marker-state-invalid") from error
    except BaseException:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if created:
            try:
                temporary.unlink()
            except OSError:
                pass
        raise


def apply(network, database_container, project_id, image, marker):
    marker = _marker_path(marker)
    if image != PINNED_IMAGE:
        raise GuardError("client-image-mismatch")
    if not shutil.which("nft"):
        raise GuardError("firewall-unavailable")
    gateway, interface = _network_details(network, project_id)
    database_ip = _database_ipv4(database_container, network)
    tables = _run(["nft", "list", "tables"])
    if tables.returncode != 0:
        raise GuardError("firewall-policy-unverified")
    if re.search(rf"(?m)^table\s+inet\s+{TABLE}\s*$", tables.stdout):
        raise GuardError("firewall-table-exists")
    if marker.exists() or marker.with_name(marker.name + ".tmp").exists():
        raise GuardError("marker-exists")

    listener, stopped, thread, port = _start_host_listener(gateway)
    try:
        if not _run_host_probe(network, gateway, port, image):
            raise GuardError("host-route-unverified")
        if not _run_host_probe(
            network, gateway, port, image, database_container=database_container
        ):
            raise GuardError("host-route-unverified")

        record = {
            "database_ipv4": database_ip,
            "interface": interface,
            "network": network,
            "phase": "installing",
            "table": TABLE,
        }
        _write_marker(marker, record)
        result = _run(["nft", "-f", "-"], input_text=_ruleset(interface, database_ip))
        if result.returncode != 0:
            raise GuardError("firewall-install-failed")
        _verify_firewall(interface, database_ip)
        record["phase"] = "active"
        _write_marker(marker, record)

        if _run_host_probe(network, gateway, port, image):
            raise GuardError("host-route-reachable-after-guard")
        if _run_host_probe(
            network, gateway, port, image, database_container=database_container
        ):
            raise GuardError("host-route-reachable-after-guard")
        _run_published_port_probe(image)
        _run_dns_probe(network, image)
        _run_dns_probe(network, image, database_container=database_container)
    finally:
        stopped.set()
        listener.close()
        thread.join(timeout=1)


def bootstrap(marker):
    """Install a narrow ingress deny before Supabase publishes PostgreSQL."""
    marker = _bootstrap_marker_path(marker)
    if not shutil.which("nft"):
        raise GuardError("firewall-unavailable")
    tables = _run(["nft", "list", "tables"])
    if tables.returncode != 0:
        raise GuardError("bootstrap-firewall-policy-unverified")
    if re.search(rf"(?m)^table\s+inet\s+{BOOTSTRAP_TABLE}\s*$", tables.stdout):
        raise GuardError("bootstrap-firewall-table-exists")
    if marker.exists() or marker.with_name(marker.name + ".tmp").exists():
        raise GuardError("bootstrap-marker-exists")

    record = {"phase": "installing", "table": BOOTSTRAP_TABLE}
    _write_marker(marker, record)
    result = _run(["nft", "-f", "-"], input_text=_bootstrap_ruleset())
    if result.returncode != 0:
        raise GuardError("bootstrap-firewall-install-failed")
    _verify_bootstrap_firewall()
    record["phase"] = "active"
    _write_marker(marker, record)


def verify_bootstrap(marker, image):
    marker = _bootstrap_marker_path(marker)
    record = _read_bootstrap_marker(marker)
    if record["phase"] != "active":
        raise GuardError("bootstrap-marker-state-invalid")
    if image != PINNED_IMAGE:
        raise GuardError("client-image-mismatch")
    _verify_bootstrap_firewall()
    gateway = _default_bridge_gateway()
    listener, stopped, thread, port = _start_host_listener(gateway)
    try:
        if not _run_host_probe("bridge", gateway, port, image):
            raise GuardError("host-route-unverified")
        _run_published_port_probe(image)
    finally:
        stopped.set()
        listener.close()
        thread.join(timeout=1)


def _delete_bootstrap_guard(marker, record):
    tables = _run(["nft", "list", "tables"])
    if tables.returncode != 0:
        raise GuardError("bootstrap-cleanup-firewall-unverified")
    has_table = (
        re.search(rf"(?m)^table\s+inet\s+{BOOTSTRAP_TABLE}\s*$", tables.stdout)
        is not None
    )
    if has_table:
        _verify_bootstrap_firewall()
        deleted = _run(["nft", "delete", "table", "inet", BOOTSTRAP_TABLE])
        if deleted.returncode != 0:
            raise GuardError("bootstrap-cleanup-firewall-unverified")
    elif record["phase"] != "installing":
        raise GuardError("bootstrap-cleanup-firewall-unverified")
    try:
        marker.unlink()
    except OSError as error:
        raise GuardError("bootstrap-cleanup-marker-failed") from error


def handoff_bootstrap(marker, guard_marker, network, database_container, project_id):
    marker = _bootstrap_marker_path(marker)
    record = _read_bootstrap_marker(marker)
    if record["phase"] != "active":
        raise GuardError("bootstrap-marker-state-invalid")
    guard_record = _read_marker(_marker_path(guard_marker))
    _, interface = _network_details(network, project_id)
    database_ip = _database_ipv4(database_container, network)
    if (
        guard_record["phase"] != "active"
        or guard_record["network"] != network
        or guard_record["interface"] != interface
        or guard_record["database_ipv4"] != database_ip
    ):
        raise GuardError("firewall-policy-unverified")
    _verify_firewall(interface, database_ip)
    _verify_bootstrap_firewall()
    _delete_bootstrap_guard(marker, record)
    print("restore-runner-bootstrap-ingress-handoff=verified")


def remove_bootstrap(marker, project_id):
    marker = _bootstrap_marker_path(marker)
    if not marker.exists():
        _reject_temporary_marker(marker, "bootstrap-marker-state-invalid")
        tables = _run(["nft", "list", "tables"])
        if tables.returncode != 0 or re.search(
            rf"(?m)^table\s+inet\s+{BOOTSTRAP_TABLE}\s*$", tables.stdout
        ):
            raise GuardError("bootstrap-cleanup-firewall-unverified")
        print("restore-runner-bootstrap-ingress-cleanup=not-installed")
        return
    record = _read_bootstrap_marker(marker)
    if not isinstance(project_id, str) or NETWORK_RE.fullmatch(project_id) is None:
        raise GuardError("bootstrap-marker-state-invalid")

    for command in (
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            f"label=com.supabase.cli.project={project_id}",
        ],
        [
            "docker",
            "volume",
            "ls",
            "-q",
            "--filter",
            f"label=com.supabase.cli.project={project_id}",
        ],
        [
            "docker",
            "network",
            "ls",
            "-q",
            "--filter",
            f"label=com.supabase.cli.project={project_id}",
        ],
    ):
        result = _run(command)
        if result.returncode != 0:
            raise GuardError("bootstrap-resources-remain")
        if result.stdout.strip():
            raise GuardError("bootstrap-resources-remain")

    _delete_bootstrap_guard(marker, record)
    print("restore-runner-bootstrap-ingress-cleanup=pass")


def remove(network, marker):
    marker = _marker_path(marker)
    if not marker.exists():
        _reject_temporary_marker(marker, "marker-state-invalid")
        tables = _run(["nft", "list", "tables"])
        if tables.returncode != 0 or re.search(
            rf"(?m)^table\s+inet\s+{TABLE}\s*$", tables.stdout
        ):
            raise GuardError("cleanup-firewall-unverified")
        print("restore-runner-host-guard-cleanup=not-installed")
        return
    record = _read_marker(marker)
    if record["network"] != network:
        raise GuardError("marker-invalid")
    networks = _run(["docker", "network", "ls", "--format", "{{.Name}}"])
    if networks.returncode != 0:
        raise GuardError("cleanup-network-unverified")
    if network in networks.stdout.splitlines():
        raise GuardError("cleanup-network-still-present")
    tables = _run(["nft", "list", "tables"])
    if tables.returncode != 0:
        raise GuardError("cleanup-firewall-unverified")
    has_table = re.search(rf"(?m)^table\s+inet\s+{TABLE}\s*$", tables.stdout) is not None
    if has_table:
        _verify_firewall(record["interface"], record["database_ipv4"])
        deleted = _run(["nft", "delete", "table", "inet", TABLE])
        if deleted.returncode != 0:
            raise GuardError("cleanup-firewall-unverified")
    elif record["phase"] != "installing":
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
    bootstrap_command = subparsers.add_parser("bootstrap")
    bootstrap_command.add_argument("--marker", required=True)
    verify_bootstrap_command = subparsers.add_parser("verify-bootstrap")
    verify_bootstrap_command.add_argument("--psql-image", default=PINNED_IMAGE)
    verify_bootstrap_command.add_argument("--marker", required=True)
    handoff_bootstrap_command = subparsers.add_parser("handoff-bootstrap")
    handoff_bootstrap_command.add_argument("--bootstrap-marker", required=True)
    handoff_bootstrap_command.add_argument("--guard-marker", required=True)
    handoff_bootstrap_command.add_argument("--docker-network", required=True)
    handoff_bootstrap_command.add_argument("--database-container", required=True)
    handoff_bootstrap_command.add_argument("--project-id", required=True)
    remove_bootstrap_command = subparsers.add_parser("remove-bootstrap")
    remove_bootstrap_command.add_argument("--project-id", required=True)
    remove_bootstrap_command.add_argument("--marker", required=True)
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
        elif args.command == "bootstrap":
            bootstrap(args.marker)
        elif args.command == "verify-bootstrap":
            verify_bootstrap(args.marker, args.psql_image)
        elif args.command == "handoff-bootstrap":
            handoff_bootstrap(
                args.bootstrap_marker,
                args.guard_marker,
                args.docker_network,
                args.database_container,
                args.project_id,
            )
        elif args.command == "remove-bootstrap":
            remove_bootstrap(args.marker, args.project_id)
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
    elif args.command == "bootstrap":
        print("restore-runner-bootstrap-ingress=installed")
    elif args.command == "verify-bootstrap":
        print("restore-runner-bootstrap-ingress=verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
