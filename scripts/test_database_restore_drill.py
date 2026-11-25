"""Offline tests for Stage B's embedded verifiers and restore diagnostics."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

from classify_restore_component import (
    COMPONENTS,
    DATA_ERROR_CATEGORIES,
    MAX_LOG_BYTES,
    MAX_ROLE_LINE_BYTES,
    MAX_ROLE_SCAN_LINES,
    component_hint,
    diagnostic_hints,
    diagnostic_hints_from_files,
    hint_from_file,
    statement_class_from_file,
)

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/database-restore-stage-b.yml"
SQL = ("roles.sql", "schema.sql", "data.sql", "history-schema.sql", "history-data.sql")


def bash_path(path):
    """Return a temporary path in the namespace used by Windows Bash."""
    resolved = Path(path).resolve()
    if os.name != "nt":
        return resolved.as_posix()
    drive = resolved.drive[:1].lower()
    tail = resolved.as_posix()[2:]
    bash_exe = (shutil.which("bash") or "").replace("\\", "/").lower()
    mount = "/mnt" if "/windowsapps/" in bash_exe else ""
    return f"{mount}/{drive}{tail}"


def programs():
    """Compile Python heredocs from the workflow, not duplicated test-side logic."""
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    collected = []
    index = 0
    while index < len(lines):
        if re.search(r"<<'PY'$", lines[index]):
            script = []
            index += 1
            while index < len(lines) and lines[index] != "          PY":
                if lines[index] and not lines[index].startswith("          "):
                    raise AssertionError("Unexpected Python heredoc indentation")
                script.append(lines[index][10:])
                index += 1
            if index >= len(lines):
                raise AssertionError("Unterminated Python heredoc")
            source = "\n".join(script) + "\n"
            compile(source, str(WORKFLOW), "exec")
            collected.append(source)
        index += 1
    if len(collected) != 5:
        raise AssertionError(f"Expected five embedded Python programs, got {len(collected)}")
    markers = {
        "verify_archive": "hashlib.sha256(arc.read_bytes())",
        "configure_db": "tomllib.loads(updated)",
        "verify_port_binding": "bindings=json.loads(sys.argv[1])",
        "verify_runner_ingress": "socket.create_connection(('::1', 54322)",
        "verify_counts": "Restored row counts do not match backup",
    }
    mapped = {}
    for source in collected:
        matches = [name for name, marker in markers.items() if marker in source]
        if len(matches) != 1:
            raise AssertionError("Could not identify one embedded workflow verifier")
        mapped[matches[0]] = source
    if set(mapped) != set(markers):
        raise AssertionError("An expected embedded workflow verifier is missing")
    return tuple(mapped[name] for name in markers)


def make_archive(root, extra=None, invalid_checksum=False):
    """Build a synthetic tarball with the exact supported manifest."""
    members = {name: f"-- synthetic {name}\n".encode() for name in SQL}
    checks = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n"
        for name, data in members.items()
    )
    if invalid_checksum:
        checks = "0" * 64 + checks[64:]
    members["component-checksums.sha256"] = checks.encode()
    members["backup-metadata.json"] = json.dumps({
        "generated_at_utc": "2026-11-06T13:42:24Z",
        "source_project_ref": "test", "source_revision": "a" * 40,
        "workflow_run_id": "123", "workflow_run_attempt": "1",
    }).encode()
    if extra:
        members[extra] = b"rejected"
    archive = root / "synthetic.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, payload in members.items():
            item = tarfile.TarInfo("./" + name)
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    evidence = root / "evidence.json"
    evidence.write_text(json.dumps({
        "archive_sha256": digest, "archive_size_bytes": archive.stat().st_size,
        "workflow_run_id": "123", "workflow_run_attempt": "1",
        "source_revision": "a" * 40, "source_project_ref": "test",
        "source_repository": "example/example", "object_key": "test/key.tar.gz",
        "consistency_check": "passed", "generated_at_utc": "2026-11-06T13:42:24Z",
    }))
    env = dict(os.environ, BACKUP_SHA256=digest,
               BACKUP_SIZE=str(archive.stat().st_size),
               BACKUP_RUN_ID="123", BACKUP_ATTEMPT="1",
               BACKUP_SOURCE_SHA="a" * 40, BACKUP_SOURCE_PROJECT="test",
               GITHUB_REPOSITORY="example/example",
               BACKUP_PREFIX="test", ARCHIVE_NAME="key.tar.gz")
    return archive, evidence, env


class StageBOfflineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Compile the actual workflow's Python rather than a test duplicate."""
        (cls.verify_archive, cls.configure_db, cls.verify_port_binding,
         cls.verify_runner_ingress, cls.verify_counts) = programs()

    def run_embedded_python(self, source, *args):
        return subprocess.run([sys.executable, "-", *map(str, args)], input=source,
                              text=True, capture_output=True, check=False)

    def test_public_summary_names_host_egress_limit_without_candidate_identifiers(self):
        summary = WORKFLOW.read_text(encoding="utf-8").split(
            "      - name: Record safe restore result", 1)[1]
        self.assertIn(
            "Approved recovery candidate identity: withheld from public output", summary
        )
        self.assertIn(
            "Runner-host outbound TCP/DNS: observed separately and not restricted by this workflow",
            summary,
        )
        self.assertIn(
            "private data is introduced after the internal network and runner-ingress guard pass",
            summary,
        )
        for private_field in (
            "BACKUP_PREFIX", "ARCHIVE_NAME", "EVIDENCE_NAME", "BACKUP_SHA256",
            "BACKUP_RUN_ID", "BACKUP_SOURCE_SHA", "BACKUP_SOURCE_PROJECT", "object_key",
        ):
            self.assertNotIn(private_field, summary)

    def test_synthetic_startup_probe_emits_only_allowlisted_runtime_states(self):
        script_path = (
            Path(__file__).resolve().parents[1] / "scripts/test_database_restore_synthetic.sh"
        )
        script = script_path.read_text(encoding="utf-8")
        probe = script.split("synthetic_startup_probe() {", 1)[1].split("\n}", 1)[0]
        function = "synthetic_startup_probe() {\n" + probe + "\n}\n"
        docker = """#!/usr/bin/env bash
case "$1" in
  ps)
    if [[ " $* " == *"label=com.supabase.cli.project=$RESTORE_PROJECT_ID"* &&
          " $* " == *"name=^/supabase_db_$RESTORE_PROJECT_ID$"* ]]; then
      printf '%s\\n' "${DB_CONTAINERS:-}"
    else
      printf '%s\\n' "${PROJECT_CONTAINERS:-}"
    fi ;;
  inspect) printf '%s\\n' "${DB_STATE:-running}" ;;
  exec*)
    if [[ "${PG_READY:-yes}" != yes ]]; then
      printf '%s\\n' 'SYNTHETIC_PRIVATE_EXEC_ERROR' >&2
      exit 93
    fi ;;
  *) printf '%s\\n' 'SYNTHETIC_PRIVATE_DOCKER_ERROR' >&2; exit 92 ;;
esac
"""
        with tempfile.TemporaryDirectory() as td:
            docker_path = Path(td) / "docker"
            docker_path.write_text(docker, encoding="utf-8")
            docker_path.chmod(0o755)
            env = dict(
                os.environ,
                PATH=f"{td}{os.pathsep}{os.environ['PATH']}",
                RESTORE_PROJECT_ID="synthetic-project",
                RESTORE_DOCKER_NETWORK="synthetic-network",
                PROJECT_CONTAINERS="111111111111\n222222222222",
                DB_CONTAINERS="0123456789ab",
            )
            ready = subprocess.run(["bash", "-c", function + "synthetic_startup_probe"],
                                   env=env, text=True, capture_output=True, check=False)
            self.assertEqual(ready.returncode, 0, ready.stderr)
            self.assertEqual(
                ready.stdout,
                "synthetic-startup-probe container=one state=running pg_ready=verified\n",
            )
            self.assertEqual(ready.stderr, "")
            env.update(DB_CONTAINERS="SYNTHETIC_PRIVATE_CONTAINER_ID")
            ambiguous = subprocess.run(["bash", "-c", function + "synthetic_startup_probe"],
                                       env=env, text=True, capture_output=True, check=False)
            self.assertEqual(ambiguous.returncode, 0, ambiguous.stderr)
            self.assertEqual(
                ambiguous.stdout,
                "synthetic-startup-probe container=ambiguous state=unknown pg_ready=unverified\n",
            )
            self.assertEqual(ambiguous.stderr, "")
            self.assertNotIn("SYNTHETIC_PRIVATE_", ambiguous.stdout + ambiguous.stderr)
            env.update(DB_CONTAINERS="0123456789ab", DB_STATE="SYNTHETIC_PRIVATE_STATE",
                       PG_READY="no")
            private_state = subprocess.run(
                ["bash", "-c", function + "synthetic_startup_probe"],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(private_state.returncode, 0, private_state.stderr)
            self.assertEqual(
                private_state.stdout,
                "synthetic-startup-probe container=one state=unknown pg_ready=unverified\n",
            )
            self.assertEqual(private_state.stderr, "")
            self.assertNotIn("SYNTHETIC_PRIVATE_", private_state.stdout + private_state.stderr)

    def test_synthetic_startup_refusal_is_sanitized_to_a_fixed_cause(self):
        script_path = (
            Path(__file__).resolve().parents[1] / "scripts/test_database_restore_synthetic.sh"
        )
        script = script_path.read_text(encoding="utf-8")
        probe = script.split("synthetic_startup_failure_class() {", 1)[1].split("\n}", 1)[0]
        function = "synthetic_startup_failure_class() {\n" + probe + "\n}\n"
        with tempfile.TemporaryDirectory() as td:
            log = Path(td) / "synthetic-startup.log"
            log.write_text(
                "connect ECONNREFUSED 127.0.0.1:54322 SYNTHETIC_PRIVATE_SENTINEL\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                ["bash", "-c", function + 'synthetic_startup_failure_class "$1"', "bash", str(log)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "database-start-loopback-healthcheck\n")
            self.assertNotIn("SYNTHETIC_PRIVATE_SENTINEL", result.stdout + result.stderr)
            log.write_text("unrecognized synthetic diagnostic\n", encoding="utf-8")
            unknown = subprocess.run(
                ["bash", "-c", function + 'synthetic_startup_failure_class "$1"', "bash", str(log)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(unknown.returncode, 0, unknown.stderr)
            self.assertEqual(unknown.stdout, "unknown\n")
            self.assertNotIn("unrecognized synthetic diagnostic", unknown.stdout + unknown.stderr)

    def test_empty_database_is_isolated_before_private_download_and_cleanup_fails_closed(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        firewall_setup = workflow.index("Install nftables for temporary runner isolation guard")
        private_download = workflow.index("Download selected private R2 backup and evidence")
        self.assertLess(firewall_setup, private_download)
        self.assertIn("command -v nft >/dev/null || sudo apt-get install -y nftables", workflow)
        start_position = workflow.index("      - name: Start clean, isolated Supabase PostgreSQL 17")
        download_position = workflow.index("      - name: Download selected private R2 backup and evidence")
        verify_position = workflow.index("      - name: Verify selected archive, source identity, and component checksums")
        restore_position = workflow.index("      - name: Restore SQL transactionally using patched PostgreSQL 17 client")
        self.assertLess(firewall_setup, start_position)
        self.assertLess(start_position, download_position)
        self.assertLess(download_position, verify_position)
        self.assertLess(verify_position, restore_position)
        start = workflow.split(
            "      - name: Start clean, isolated Supabase PostgreSQL 17", 1
        )[1].split("      - name: Download selected private R2 backup and evidence", 1)[0]
        self.assertIn("supabase --debug db start", start)
        self.assertIn("docker network connect --alias db", start)
        self.assertIn("docker network disconnect", start)
        self.assertNotIn("AWS_ACCESS_KEY_ID", start)
        self.assertNotIn("R2_RESTORE_ENDPOINT", start)
        self.assertLess(start.index("supabase --debug db start"), start.index("docker network create"))
        self.assertLess(start.index("docker network create"), start.index('> "$RUNNER_TEMP/restore-network-owned"'))
        self.assertLess(start.index("docker network disconnect"), start.index("restore_runner_network_guard.py apply"))
        self.assertIn("runner-host-connectivity tcp=", start)
        self.assertIn("ports[0].get('HostIp') in ('', '0.0.0.0', '127.0.0.1')", start)
        self.assertNotIn("host_binding_ipv4", start)
        self.assertLess(
            start.index("restore_runner_network_guard.py apply"),
            start.index("Restore client network permits outbound connectivity"),
        )
        self.assertIn("socket.create_connection(('::1', 54322)", start)
        self.assertIn("runner-ingress-guarded", start)
        runner_guard = (WORKFLOW.parent.parent.parent / "scripts/restore_runner_network_guard.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("nslookup db", runner_guard)
        self.assertIn("nslookup example.com", runner_guard)
        self.assertIn('"external-dns-resolves"', runner_guard)
        self.assertIn("verify_restore_foreign_keys.sql", workflow)
        self.assertIn("Seven application foreign-key mappings and references verified.", workflow)
        synthetic = (WORKFLOW.parent / "../.." / "scripts/test_database_restore_synthetic.sh").resolve()
        self.assertIn("synthetic-application-foreign-keys=pass", synthetic.read_text(encoding="utf-8"))
        cleanup = workflow.split(
            "      - name: Stop isolated database and delete private files", 1
        )[1]
        self.assertIn("if: always()", cleanup)
        self.assertNotIn("--network-id", cleanup.split("if ! rm -rf", 1)[0])
        self.assertLess(cleanup.index("docker network rm"), cleanup.index("restore_runner_network_guard.py remove"))
        self.assertIn('[[ "$(cat "$RUNNER_TEMP/restore-network-owned")" == "$RESTORE_DOCKER_NETWORK" ]]', cleanup)
        self.assertIn('failure" -eq 0 && -e "$RUNNER_TEMP/restore-runner-network-guard.json"', cleanup)
        self.assertIn('docker ps -aq --filter "label=com.supabase.cli.project=$RESTORE_PROJECT_ID"', cleanup)
        self.assertIn('docker volume ls -q --filter "label=com.supabase.cli.project=$RESTORE_PROJECT_ID"', cleanup)
        self.assertIn('docker network ls -q --filter "label=com.supabase.cli.project=$RESTORE_PROJECT_ID"', cleanup)
        self.assertIn("Disposable PostgreSQL containers, volumes, or networks remain after cleanup", cleanup)
        self.assertIn("runner teardown will recycle the VM", cleanup)

    def test_synthetic_workflow_runs_runner_guard_offline_and_live_start_tests(self):
        synthetic = (WORKFLOW.parent / "database-restore-synthetic.yml").read_text(encoding="utf-8")
        self.assertIn("scripts/restore_runner_network_guard.py", synthetic)
        self.assertIn("scripts/test_database_restore_runner_network_guard.py", synthetic)
        self.assertIn("scripts/verify_restore_foreign_keys.sql", synthetic)
        self.assertIn("Install nftables for temporary runner isolation guard", synthetic)
        self.assertIn("python3 -m unittest discover -s scripts -p 'test_database_restore_*.py'", synthetic)
        self.assertIn("bash scripts/test_database_restore_synthetic.sh", synthetic)
        synthetic_script = (WORKFLOW.parent / "../.." / "scripts/test_database_restore_synthetic.sh").resolve().read_text(
            encoding="utf-8"
        )
        self.assertIn("synthetic-project-cleanup=pass", synthetic_script)
        self.assertIn('docker volume ls -q --filter "label=com.supabase.cli.project=$RESTORE_PROJECT_ID"', synthetic_script)

    def test_database_config_is_pinned_to_postgres_17_and_unique_project(self):
        import tomllib

        with tempfile.TemporaryDirectory() as td:
            config = Path(td) / "config.toml"
            config.write_text('project_id = "supabase"\n[db]\nmajor_version = 15\n')
            result = self.run_embedded_python(self.configure_db, config, "mori276-test")
            self.assertEqual(result.returncode, 0, result.stderr)
            parsed = tomllib.loads(config.read_text())
            self.assertEqual(parsed["project_id"], "mori276-test")
            self.assertEqual(parsed["db"]["major_version"], 17)

    def test_database_port_mapping_is_guarded_before_private_data(self):
        allowed = (
            json.dumps({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "54322"}]}),
            json.dumps({"5432/tcp": [{"HostIp": "", "HostPort": "54322"}]}),
            json.dumps({"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "54322"}]}),
        )
        denied = (
            json.dumps({"5432/tcp": [{"HostIp": "::", "HostPort": "54322"}]}),
            json.dumps({"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "54323"}]}),
            json.dumps({"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "54322"}],
                        "8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8080"}]}),
        )
        for value in allowed:
            with self.subTest(allowed=value):
                self.assertEqual(self.run_embedded_python(self.verify_port_binding, value).returncode, 0)
        for value in denied:
            with self.subTest(binding=value):
                result = self.run_embedded_python(self.verify_port_binding, value)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn(value, result.stderr)

    def run_archive_check(self, archive, evidence, env, dest):
        """Run the verifier with a disposable synthetic archive."""
        return subprocess.run([sys.executable, "-", str(archive), str(evidence),
                               str(dest)], input=self.verify_archive, text=True,
                              capture_output=True, env=env, check=False)

    def test_valid_archive(self):
        """An allowlisted, internally consistent fixture must be accepted."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive, evidence, env = make_archive(root)
            target = root / "verified"
            response = self.run_archive_check(archive, evidence, env, target)
            self.assertEqual(response.returncode, 0, response.stderr)
            self.assertEqual({p.name for p in target.iterdir()}, set(SQL))

    def test_reject_corrupt_component(self):
        """The verifier must reject an invalid SQL component digest."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive, evidence, env = make_archive(root, invalid_checksum=True)
            response = self.run_archive_check(archive, evidence, env, root / "verified")
            self.assertNotEqual(response.returncode, 0)
            self.assertFalse((root / "verified").exists())

    def test_reject_unexpected_tar_member(self):
        """Unexpected files must be rejected without extraction."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive, evidence, env = make_archive(root, extra="../unexpected")
            response = self.run_archive_check(archive, evidence, env, root / "verified")
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("unexpected archive entry or size", response.stderr)
            self.assertFalse((root / "verified").exists())

    def test_reject_mismatched_backup_sha(self):
        """A pinned archive digest mismatch must fail before SQL extraction."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive, evidence, env = make_archive(root)
            env["BACKUP_SHA256"] = "f" * 64
            response = self.run_archive_check(archive, evidence, env, root / "verified")
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("SHA-256 mismatch", response.stderr)

    def test_reject_changed_source_identity(self):
        """R2 evidence for another source revision must be rejected."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive, evidence, env = make_archive(root)
            contents = json.loads(evidence.read_text())
            contents["source_revision"] = "b" * 40
            evidence.write_text(json.dumps(contents))
            response = self.run_archive_check(archive, evidence, env, root / "verified")
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("evidence identity source_revision", response.stderr)

    def test_count_and_migration_match(self):
        """Confirm counts and migration versions, rejecting independent mismatches."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            data, history = root / "data.sql", root / "history.sql"
            data.write_text("COPY public.recipes (id) FROM stdin;\na\nb\n\\.\n")
            history.write_text("COPY supabase_migrations.schema_migrations (version, name) FROM stdin;\n20261013000000\tinitial\n\\.\n")
            digest = hashlib.md5(b"20261013000000").hexdigest()
            matches = f"0|2|0|0|0|1|{digest}"
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history), matches],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertEqual(response.returncode, 0, response.stderr)

            mismatch = f"0|1|0|0|0|1|{digest}"
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history), mismatch],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("Restored row counts do not match backup", response.stderr)

            wrong_digest = f"0|2|0|0|0|1|{'f' * 32}"
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history), wrong_digest],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("Restored migration version set does not match backup", response.stderr)

            history.write_text(
                "COPY supabase_migrations.schema_migrations (version, name) FROM stdin;\n"
                "20261013000000\tinitial\n"
                "20261013000000\tduplicate\n"
                "\\.\n"
            )
            duplicate_digest = hashlib.md5(
                b"20261013000000,20261013000000").hexdigest()
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history),
                 f"0|2|0|0|0|2|{duplicate_digest}"],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertNotEqual(response.returncode, 0)
            self.assertIn("Restored migration version set does not match backup", response.stderr)


    def test_copy_counts_use_physical_newlines_with_unicode_separators(self):
        """Unicode line separators inside a COPY field must count as one row."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            data, history = root / "data.sql", root / "history.sql"
            data.write_text(
                "COPY public.recipes (id, title) FROM stdin;\n"
                "1\talpha\u2028beta\u2029gamma\u0085delta\n"
                "\\.\n", encoding="utf-8")
            history.write_text(
                "COPY supabase_migrations.schema_migrations (version, name) FROM stdin;\n"
                "20261013000000\tinitial\u2028migration\n"
                "\\.\n", encoding="utf-8")
            digest = hashlib.md5(b"20261013000000").hexdigest()
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history),
                 f"0|1|0|0|0|1|{digest}"],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertEqual(response.returncode, 0, response.stderr)
            self.assertIn("Five application table counts", response.stdout)

            mismatch = subprocess.run(
                [sys.executable, "-", str(data), str(history),
                 f"0|2|0|0|0|1|{digest}"],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn("Restored row counts do not match backup", mismatch.stderr)

    def test_quoted_copy_identifiers_and_versions(self):
        """Accept quoted schema, table, and migration column identifiers."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            data, history = root / "data.sql", root / "history.sql"
            data.write_text(
                'COPY "public"."recipes" ("id") FROM stdin;\n'
                'a\nb\n\\.\n'
            )
            history.write_text(
                'COPY "supabase_migrations"."schema_migrations" ("version", "name") FROM stdin;\n'
                '20261013000000\tinitial\n\\.\n'
            )
            digest = hashlib.md5(b"20261013000000").hexdigest()
            response = subprocess.run(
                [sys.executable, "-", str(data), str(history),
                 f"0|2|0|0|0|1|{digest}"],
                input=self.verify_counts, text=True, capture_output=True, check=False)
            self.assertEqual(response.returncode, 0, response.stderr)



class ComponentHintTests(unittest.TestCase):
    """Invented stderr only; accepted text is never authenticated evidence."""

    def test_each_component_and_recognized_notices(self):
        for component in COMPONENTS:
            with self.subTest(component=component):
                record = b"psql:/backup/" + component + b":12: ERROR:  22012\n"
                notice = b"psql:/backup/roles.sql:1: NOTICE:  00000\n"
                self.assertEqual(component_hint(notice + record, 3),
                                 COMPONENTS[component])

    def test_ambiguous_unattributed_malformed_and_verbose_records(self):
        record = b"psql:/backup/data.sql:12: ERROR:  22012\n"
        rejected = [
            b"", b"ERROR:  42501\n", b"psql: error: connection failed\n",
            record.rstrip(b"\n"), record + b"\n", record + record,
            record + record.replace(b"data.sql", b"schema.sql"),
            record.replace(b"/backup/data.sql", b"/other/data.sql"),
            record.replace(b"/backup/data.sql", b"/backup/../data.sql"),
            record.replace(b"data.sql", b"data.sql.extra"),
            record.replace(b":12:", b":0:"),
            record.replace(b":12:", b":-1:"),
            record.replace(b":12:", b":18446744073709551616:"),
            record.replace(b":12:", b":"),
            record.replace(b"ERROR", b"error"),
            record.replace(b"22012", b"division by zero"),
            record.replace(b"22012", b"22012 trailing text"),
            record.replace(b"22012", b"\xff\x00bad"),
            record.replace(b"\n", b"\r\n"),
            b"\x1b[31m" + record,
            record + b"DETAIL:  SYNTHETIC_PRIVATE_RECORD\n",
            b"psql:/backup/schema.sql:1: NOTICE:  invented multiline text\n" + record,
            b"psql:/backup/roles.sql:1: NOTICE:  00000\n",
            b"x" * 513 + b"\n",
            record * (MAX_LOG_BYTES // len(record) + 1),
        ]
        for index, payload in enumerate(rejected):
            with self.subTest(case=index):
                self.assertEqual(component_hint(payload, 3), "unknown")
        for code in (0, 1, 2, 42, 125, 137):
            self.assertEqual(component_hint(record, code), "unknown")

    def test_bounded_read_and_unreadable_log(self):
        class Source(io.BytesIO):
            def read(self, size=-1):
                self.requested_size = size
                return super().read(size)

        source = Source(b"x" * (MAX_LOG_BYTES + 10))

        class Input:
            def open(self, mode):
                self.mode = mode
                return source

        path = Input()
        self.assertEqual(hint_from_file(path, 3), "unknown")
        self.assertEqual(source.requested_size, MAX_LOG_BYTES + 1)
        self.assertEqual(path.mode, "rb")
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(hint_from_file(Path(td) / "missing", 3), "unknown")
            self.assertEqual(hint_from_file(Path(td), 3), "unknown")

    def test_cli_emits_only_an_enum_for_private_or_invalid_input(self):
        classifier = Path(__file__).with_name("classify_restore_component.py")
        with tempfile.TemporaryDirectory() as td:
            log = Path(td) / "stderr.log"
            for payload, expected in [
                (b"psql:/backup/data.sql:1: ERROR:  22012\n", "data.sql"),
                (b"::error::SYNTHETIC_PRIVATE_SQL credential=invented\n", "unknown"),
                (b"x" * (MAX_LOG_BYTES + 1), "unknown"),
            ]:
                log.write_bytes(payload)
                result = subprocess.run(
                    [sys.executable, "-B", str(classifier), str(log), "3"],
                    text=True, capture_output=True, check=False)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, expected + "\n")
                self.assertEqual(result.stderr, "")

    def test_identical_forged_record_cannot_be_authenticated(self):
        forged = b"psql:/backup/data.sql:1: ERROR:  22012\n"
        # Deliberately document the limitation; do not claim spoof-proof parsing.
        self.assertEqual(component_hint(forged, 3), "data.sql")

    def test_data_category_is_component_scoped_and_does_not_open_sql(self):
        class UnusedRolesFile:
            def open(self, mode):
                raise AssertionError("data diagnostics must not read SQL")

        unused = UnusedRolesFile()
        record = b"psql:/backup/data.sql:987654321: ERROR:  "
        cases = [
            (b"22P02", "invalid-text-representation"),
            (b"22P04", "bad-copy-file-format"),
            (b"23503", "foreign-key-violation"),
            (b"23505", "unique-violation"),
            (b"22021", "character-not-in-repertoire"),
            (b"42P01", "undefined-table"),
            (b"42704", "unknown"),
            (b"ZZZZZ", "unknown"),
        ]
        for sqlstate, category in cases:
            with self.subTest(sqlstate=sqlstate):
                self.assertEqual(diagnostic_hints(record + sqlstate + b"\n", 3, unused),
                                 ("data.sql", category, "unknown"))
        for component in (b"schema.sql", b"history-schema.sql", b"history-data.sql"):
            stderr = record.replace(b"data.sql", component) + b"23505\n"
            self.assertEqual(diagnostic_hints(stderr, 3, unused),
                             (component.decode("ascii"), "unknown", "unknown"))

    def test_data_category_requires_one_error_and_allows_notices_and_warnings(self):
        record = b"psql:/backup/data.sql:987654321: ERROR:  23505\n"
        notice = b"psql:/backup/roles.sql:2: NOTICE:  00000\n"
        warning = b"psql:/backup/data.sql:3: WARNING:  01000\n"
        expected_category = ("data.sql", "unique-violation", "unknown")
        cases = [
            (record, 3, expected_category),
            (record, 2, ("unknown", "unknown", "unknown")),
            (notice + record, 3, expected_category),
            (record + notice, 3, expected_category),
            (warning + record, 3, expected_category),
            (record + warning, 3, expected_category),
            (notice + record + warning, 3, expected_category),
            (notice + warning, 3, ("unknown", "unknown", "unknown")),
            (notice.replace(b"NOTICE", b"INFO") + record, 3, ("data.sql", "unknown", "unknown")),
            (notice + record.replace(b"ERROR", b"FATAL"), 3, ("data.sql", "unknown", "unknown")),
            (record.replace(b"ERROR", b"PANIC") + warning, 3, ("data.sql", "unknown", "unknown")),
            (record + record.replace(b"ERROR", b"FATAL"), 3, ("unknown", "unknown", "unknown")),
            (record + record, 3, ("unknown", "unknown", "unknown")),
            (record + record.replace(b"data.sql", b"roles.sql"), 3,
             ("unknown", "unknown", "unknown")),
            (record.rstrip(b"\n"), 3, ("unknown", "unknown", "unknown")),
            (record.replace(b"23505\n", b"23505 SYNTHETIC_PRIVATE_ROW\n"), 3,
             ("unknown", "unknown", "unknown")),
            (b"NOTICE:  SYNTHETIC_PRIVATE_FAKE_ERROR\n" + record, 3,
             ("unknown", "unknown", "unknown")),
            (record + b"DETAIL:  SYNTHETIC_PRIVATE_IDENTIFIER\n", 3,
             ("unknown", "unknown", "unknown")),
        ]
        # Exact framing is a heuristic. A single byte-for-byte forgery would
        # satisfy the same check, so the resulting category is always untrusted.
        for payload, code, expected in cases:
            with self.subTest(payload=payload, code=code):
                self.assertEqual(diagnostic_hints(payload, code, Path("unused")), expected)

    def test_role_sql_category_and_statement_classes(self):
        classifier = Path(__file__).with_name("classify_restore_component.py")
        cases = [
            (b"GRANT synthetic_group TO synthetic_member WITH ADMIN OPTION, INHERIT TRUE, SET TRUE;\n",
             b"42501", ("roles.sql", "insufficient-privilege", "role-membership-grant")),
            (b"ALTER ROLE synthetic_member SET statement_timeout TO '15s';\n",
             b"42704", ("roles.sql", "undefined-object", "alter-role-set")),
            (b"ALTER ROLE synthetic_member IN DATABASE synthetic_db SET statement_timeout TO '15s';\n",
             b"42704", ("roles.sql", "undefined-object", "alter-role-set")),
            (b"GRANT synthetic_group TO synthetic_member;\n",
             b"42710", ("roles.sql", "duplicate-object", "role-membership-grant")),
            (b"ALTER ROLE synthetic_member SET statement_timeout TO '15s';\n",
             b"ZZZZZ", ("roles.sql", "unknown", "alter-role-set")),
        ]
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            stderr, roles = root / "private.stderr", root / "roles.sql"
            for payload, sqlstate, expected in cases:
                with self.subTest(sqlstate=sqlstate):
                    roles.write_bytes(payload)
                    stderr.write_bytes(
                        b"psql:/backup/roles.sql:1: ERROR:  " + sqlstate + b"\n")
                    self.assertEqual(diagnostic_hints(stderr.read_bytes(), 3, roles), expected)
                    cli = subprocess.run(
                        [sys.executable, "-B", str(classifier), "--details",
                         str(stderr), "3", str(roles)],
                        text=True, capture_output=True, check=False)
                    self.assertEqual(cli.returncode, 0)
                    self.assertEqual(cli.stdout, " ".join(expected) + "\n")
                    self.assertEqual(cli.stderr, "")

    def test_role_creation_and_attributes_are_fixed_private_hints(self):
        cases = [
            (b'CREATE ROLE "SYNTHETIC_PRIVATE_ROLE";', 'create-role'),
            (b'CREATE ROLE synthetic WITH NOLOGIN NOSUPERUSER;', 'create-role'),
            (b'ALTER ROLE synthetic WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB LOGIN NOREPLICATION NOBYPASSRLS;', 'alter-role-attributes'),
            (b'ALTER ROLE synthetic SUPERUSER;', 'alter-role-attributes'),
            (b'CREATE ROLE synthetic PASSWORD \'SYNTHETIC_PRIVATE_PASSWORD\';', 'unknown'),
            (b'ALTER ROLE synthetic CONNECTION LIMIT 2;', 'unknown'),
            (b'ALTER ROLE synthetic WITH;', 'unknown'),
            (b'CREATE ROLE synthetic; SELECT 1;', 'unknown'),
            (b'-- CREATE ROLE synthetic;', 'unknown'),
        ]
        for statement, expected in cases:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as td:
                roles = Path(td) / 'roles.sql'
                roles.write_bytes(statement + b'\n')
                record = b'psql:/backup/roles.sql:1: ERROR:  42501\n'
                self.assertEqual(diagnostic_hints(record, 3, roles),
                                 ('roles.sql', 'insufficient-privilege', expected))
                # A recognized-looking line inside a multiline prefix stays unknown.
                roles.write_bytes(b"SELECT 'open\n" + statement + b'\n')
                self.assertEqual(statement_class_from_file(roles, 2), 'unknown')

    def test_role_lookup_rejects_ambiguous_invalid_and_unsupported_lines(self):
        accepted = b"psql:/backup/roles.sql:2: ERROR:  42501\n"
        with tempfile.TemporaryDirectory() as td:
            roles = Path(td) / "roles.sql"
            roles.write_bytes(b"CREATE ROLE synthetic_member;\nGRANT synthetic_group TO synthetic_member;\n")
            self.assertEqual(diagnostic_hints(accepted + accepted, 3, roles),
                             ("unknown", "unknown", "unknown"))

            # A perfectly matching forged record remains indistinguishable.
            self.assertEqual(diagnostic_hints(accepted, 3, roles),
                             ("roles.sql", "insufficient-privilege", "role-membership-grant"))

            other_component = b"psql:/backup/data.sql:1: ERROR:  42704\n"
            self.assertEqual(diagnostic_hints(other_component, 3, roles),
                             ("data.sql", "unknown", "unknown"))

            invalid_refs = [
                b"psql:/backup/roles.sql:0: ERROR:  42501\n",
                f"psql:/backup/roles.sql:{MAX_ROLE_SCAN_LINES + 1}: ERROR:  42501\n".encode(),
                b"psql:/backup/roles.sql:3: ERROR:  42501\n",
            ]
            for stderr in invalid_refs:
                with self.subTest(stderr=stderr):
                    component, category, statement = diagnostic_hints(stderr, 3, roles)
                    self.assertEqual((component, category), ("unknown", "unknown")
                                     if b":0:" in stderr else ("roles.sql", "insufficient-privilege"))
                    self.assertEqual(statement, "unknown")

            misleading = [
                (1, b"-- GRANT synthetic_group TO synthetic_member;\n"),
                (1, b"SELECT 'GRANT synthetic_group TO synthetic_member;';\n"),
                (2, b"COPY synthetic_roles FROM stdin;\n"
                    b"GRANT synthetic_group TO synthetic_member;\n\\.\n"),
                (2, b"SELECT 1; COPY synthetic_roles FROM stdin;\n"
                    b"GRANT synthetic_group TO synthetic_member;\n\\.\n"),
                (2, b"/* open comment\nGRANT synthetic_group TO synthetic_member;\n*/\n"),
                (2, b"ALTER ROLE synthetic_member SET application_name TO 'unterminated\n"
                    b"GRANT synthetic_group TO synthetic_member;\n"),
                (2, b"ALTER ROLE synthetic_member SET\n"
                    b"statement_timeout TO '15s';\n"),
            ]
            for line_number, payload in misleading:
                with self.subTest(payload=payload):
                    roles.write_bytes(payload)
                    self.assertLessEqual(line_number, len(payload.splitlines()))
                    record = f"psql:/backup/roles.sql:{line_number}: ERROR:  42501\n".encode()
                    self.assertEqual(diagnostic_hints(record, 3, roles),
                                     ("roles.sql", "insufficient-privilege", "unknown"))

    def test_semicolon_inside_trailing_comment_is_not_statement_boundary(self):
        record = b"psql:/backup/roles.sql:2: ERROR:  42501\n"
        with tempfile.TemporaryDirectory() as td:
            roles = Path(td) / "roles.sql"
            roles.write_bytes(
                b"SELECT 1 -- this semicolon is inside a comment;\n"
                b'GRANT "g" TO "m";\n'
            )
            self.assertEqual(diagnostic_hints(record, 3, roles),
                             ("roles.sql", "insufficient-privilege", "unknown"))

            # A genuine standalone grant after a complete statement still matches.
            roles.write_bytes(b"SELECT ';'; -- trailing ;\nGRANT \"g\" TO \"m\";\n")
            self.assertEqual(diagnostic_hints(record, 3, roles),
                             ("roles.sql", "insufficient-privilege", "role-membership-grant"))

    def test_role_scan_is_bounded_and_cli_never_emits_private_sentinels(self):
        classifier = Path(__file__).with_name("classify_restore_component.py")
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            stderr, roles = root / "private.stderr", root / "roles.sql"
            stderr.write_bytes(b"psql:/backup/roles.sql:1: ERROR:  42501\n")
            roles.write_bytes(b"SYNTHETIC_PRIVATE_SQL " + b"x" * MAX_ROLE_LINE_BYTES)
            cli = subprocess.run(
                [sys.executable, "-B", str(classifier), "--details",
                 str(stderr), "3", str(roles)],
                text=True, capture_output=True, check=False)
            self.assertEqual((cli.returncode, cli.stdout, cli.stderr),
                             (0, "roles.sql insufficient-privilege unknown\n", ""))
            self.assertNotIn("SYNTHETIC_PRIVATE", cli.stdout + cli.stderr)

            roles.write_bytes(b"CREATE ROLE synthetic_member;\n")
            stderr.write_bytes(b"psql:/backup/roles.sql:2: ERROR:  42501\n")
            cli = subprocess.run(
                [sys.executable, "-B", str(classifier), "--details",
                 str(stderr), "3", str(roles)],
                text=True, capture_output=True, check=False)
            self.assertEqual(cli.stdout, "roles.sql insufficient-privilege unknown\n")

            roles.write_bytes(b"GRANT synthetic_group TO synthetic_member;\n")
            stderr.write_bytes(b"SYNTHETIC_PRIVATE_SENTINEL " + b"x" * (MAX_LOG_BYTES + 1))
            cli = subprocess.run(
                [sys.executable, "-B", str(classifier), "--details",
                 str(stderr), "3", str(roles)],
                text=True, capture_output=True, check=False)
            self.assertEqual((cli.stdout, cli.stderr), ("unknown unknown unknown\n", ""))
            self.assertNotIn("SYNTHETIC_PRIVATE", cli.stdout + cli.stderr)

            stderr.write_bytes(b"psql:/backup/roles.sql:1: ERROR:  42501\n")
            cli = subprocess.run(
                [sys.executable, "-B", str(classifier), "--details",
                 str(stderr), "3", str(root / "unreadable" / "roles.sql")],
                text=True, capture_output=True, check=False)
            self.assertEqual(cli.stdout, "roles.sql insufficient-privilege unknown\n")

    def test_detailed_classifier_reads_both_private_files_with_bounds(self):
        class BoundedSource(io.BytesIO):
            def read(self, size=-1):
                self.requested = size
                return super().read(size)

        stderr_source = BoundedSource(b"SYNTHETIC_PRIVATE " * (MAX_LOG_BYTES + 1))

        class PrivatePath:
            def open(self, mode):
                self.mode = mode
                return stderr_source

        path = PrivatePath()
        self.assertEqual(diagnostic_hints_from_files(path, 3, Path("unused")),
                         ("unknown", "unknown", "unknown"))
        self.assertEqual((path.mode, stderr_source.requested), ("rb", MAX_LOG_BYTES + 1))

        class BoundedLines:
            def __init__(self):
                self.requested = []
                self.source = io.BytesIO(b"x" * (MAX_ROLE_LINE_BYTES + 100))

            def readline(self, size=-1):
                self.requested.append(size)
                return self.source.readline(size)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.source.close()

        bounded_lines = BoundedLines()

        class RolePath:
            def open(self, mode):
                self.mode = mode
                return bounded_lines

        role_path = RolePath()
        self.assertEqual(statement_class_from_file(role_path, 1), "unknown")
        self.assertEqual((role_path.mode, bounded_lines.requested),
                         ("rb", [MAX_ROLE_LINE_BYTES + 1]))

    def test_non_script_exit_does_not_read_a_log(self):
        class Input:
            def open(self, mode):
                raise AssertionError("A non-script failure must not read stderr")

        self.assertEqual(hint_from_file(Input(), 1), "unknown")


class RestoreDiagnosticTests(unittest.TestCase):
    """Execute actual workflow Bash with synthetic Docker results, offline."""

    @classmethod
    def setUpClass(cls):
        cls.bash = shutil.which("bash")
        if not cls.bash and os.name == "nt":
            candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
            if candidate.exists():
                cls.bash = str(candidate)
        if not cls.bash:
            raise unittest.SkipTest("Bash required for workflow diagnostic tests")
        workflow = WORKFLOW.read_text(encoding="utf-8")
        step = workflow.split("      - name: Restore SQL transactionally", 1)[1]
        body = step.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
        cls.script = "\n".join(line[10:] for line in body.splitlines()) + "\n"
        cleanup = workflow.split("      - name: Stop isolated database and delete private files", 1)[1]
        body = cleanup.split("        run: |\n", 1)[1]
        cls.cleanup_script = "\n".join(line[10:] for line in body.splitlines()) + "\n"

    def run_diagnostic(self, phase="none", code=0, missing_file=False,
                       temp_prefix="tmp", stderr=None, helper_mode="normal",
                       roles_sql=None, helper_output=None):
        # No Docker daemon, network, or SQL execution. Both streams deliberately
        # contain synthetic private markers, including annotation-like content.
        stub = r'''
docker() {
  if [[ "${1:-}" == network && "${2:-}" == inspect ]]; then
    printf 'bridge|true|false|%s|%s\n' \
      "$RESTORE_PROJECT_ID" "$RESTORE_PROJECT_ID"
    return 0
  fi
  if [[ "${1:-}" == ps ]]; then
    printf 'synthetic-db-id\n'
    return 0
  fi
  if [[ "${1:-}" == inspect ]]; then
    printf '%s\n' "$RESTORE_DOCKER_NETWORK"
    return 0
  fi
  local phase=restore arg
  for arg in "$@"; do
    case "$arg" in
      --version) phase=client ;;
      sh) phase=files ;;
      'SELECT 1') phase=connection ;;
    esac
  done
  printf '%s\0' "$phase" "$@" END >> "$RUNNER_TEMP/trace"
  printf 'SYNTHETIC_PRIVATE_SQL credential=synthetic row=synthetic\n'
  printf 'psql:/backup/roles.sql:1: ERROR:  22012\n'
  printf '%s' "$DIAG_STDERR" >&2
  if [[ "$phase" == "$FAIL_PHASE" ]]; then return "$FAIL_CODE"; fi
  if [[ "$phase" == files ]]; then
    # Exercise the actual mounted-file probe against synthetic local files.
    # Insert a quoted variable reference, never the filesystem path as code.
    local backup_reference='"$RUNNER_TEMP/restore-verified-sql"'
    sh -c "${arg//\/backup/$backup_reference}"
    return $?
  fi
  return 0
}
python3() {
  case "$HELPER_MODE" in
    crash) printf 'SYNTHETIC_PRIVATE_EXCEPTION\n' >&2; return 77 ;;
    invalid) printf '::error::SYNTHETIC_PRIVATE_HELPER_OUTPUT\n'; return 0 ;;
    override) printf '%s\n' "$HELPER_OUTPUT"; return 0 ;;
    *) "$TEST_PYTHON" -B "$@" ;;
  esac
}
'''
        with tempfile.TemporaryDirectory(prefix=temp_prefix) as td:
            root = Path(td)
            backup = root / "restore-verified-sql"
            backup.mkdir()
            for name in SQL:
                if not (missing_file and name == "data.sql"):
                    path = backup / name
                    if name == "roles.sql" and roles_sql is not None:
                        path.write_bytes(roles_sql)
                    else:
                        path.write_text("SYNTHETIC_PRIVATE_DUMP")
            env = dict(os.environ, RUNNER_TEMP=bash_path(root),
                       PSQL_IMAGE="synthetic-pinned-image", FAIL_PHASE=phase,
                       FAIL_CODE=str(code), TEST_PYTHON=sys.executable,
                       RESTORE_DOCKER_NETWORK="synthetic-restore-network",
                       RESTORE_PROJECT_ID="moris-restore-local",
                       HELPER_MODE=helper_mode, HELPER_OUTPUT=helper_output or "",
                       DIAG_STDERR=stderr if stderr is not None
                       else "::error::SYNTHETIC_PRIVATE_STDERR SELECT secret FROM synthetic;\n")
            result = subprocess.run([self.bash, "--noprofile", "--norc"],
                                    input=(stub + self.script).encode("utf-8"),
                                    capture_output=True, env=env, check=False)
            result.stdout = result.stdout.decode("utf-8", errors="replace")
            result.stderr = result.stderr.decode("utf-8", errors="replace")
            private_log = root / "private-restore-result.log"
            private_stderr = root / "private-restore-stderr.log"
            self.assertTrue(private_log.is_file(),
                            f"restore step exited {result.returncode}; "
                            f"stdout={result.stdout!r}; stderr={result.stderr!r}")
            self.assertIn("SYNTHETIC_PRIVATE_SQL", private_log.read_text())
            self.assertNotIn("SYNTHETIC_PRIVATE_STDERR", private_log.read_text())
            self.assertEqual(private_stderr.read_text(), env["DIAG_STDERR"])
            if os.name != "nt":
                self.assertEqual(private_log.stat().st_mode & 0o777, 0o600)
                self.assertEqual(private_stderr.stat().st_mode & 0o777, 0o600)
            trace = (root / "trace").read_text().split("\0END\0")[:-1]
            calls = [record.split("\0") for record in trace]
            self.assertEqual({path.name for path in backup.iterdir()},
                             set(SQL) - ({"data.sql"} if missing_file else set()))
            for path in backup.iterdir():
                if path.name == "roles.sql" and roles_sql is not None:
                    self.assertEqual(path.read_bytes(), roles_sql)
                else:
                    self.assertEqual(path.read_text(), "SYNTHETIC_PRIVATE_DUMP")
        self.assertNotIn("SYNTHETIC_PRIVATE", result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        return result, calls

    def test_success_and_preserved_restore_arguments(self):
        result, calls = self.run_diagnostic()
        self.assertEqual(result.returncode, 0)
        self.assertEqual([call[0] for call in calls],
                         ["client", "files", "connection", "restore"])
        self.assertEqual(result.stdout, "".join(
            f"Restore diagnostic: phase={phase} status=passed\n"
            for phase in ("client", "files", "connection", "restore")) +
            "Transactional isolated SQL restore passed.\n")
        for call in calls:
            self.assertEqual(call[1:5],
                             ["run", "--rm", "--network", "synthetic-restore-network"])
            self.assertIn("--read-only", call)
            self.assertIn("no-new-privileges", call)
            self.assertIn("ALL", call)
            self.assertIn("synthetic-pinned-image", call)
            self.assertTrue(any(arg.endswith("target=/backup,readonly") for arg in call))
        restore = calls[-1]
        admin_db = "postgresql://supabase_admin:postgres@db:5432/postgres"
        self.assertEqual(calls[-2][-2:], ["-d", admin_db])
        command = restore[restore.index("psql"):]
        guard = command[command.index("-c") + 1]
        self.assertIn("current_user <> 'supabase_admin'", guard)
        self.assertIn("session_user <> 'supabase_admin'", guard)
        self.assertIn("WHERE rolname = current_user AND rolsuper", guard)
        self.assertIn("RAISE insufficient_privilege", guard)
        self.assertEqual(command, [
            "psql", "-X", "-q", "--no-password", "--single-transaction",
            "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate",
            "-c", guard,
            "-f", "/backup/roles.sql", "-f", "/backup/schema.sql",
            "-f", "/backup/history-schema.sql",
            "-c", "SET session_replication_role = replica",
            "-f", "/backup/data.sql", "-f", "/backup/history-data.sql",
            "-d", admin_db])

    def test_bash_syntax(self):
        result = subprocess.run([self.bash, "--noprofile", "--norc", "-n"],
                                input=self.script.encode("utf-8"), capture_output=True,
                                check=False)
        self.assertEqual(result.returncode, 0,
                         result.stderr.decode("utf-8", errors="replace"))

    def test_failure_categories_and_actual_exit_codes(self):
        cases = [("client", 1, "container-client"),
                 ("files", 1, "mounted-files"),
                 ("connection", 1, "client-fatal"),
                 ("connection", 2, "connection"),
                 ("restore", 1, "client-or-sql-action"),
                 ("restore", 2, "connection"),
                 ("restore", 3, "sql-script"),
                 ("restore", 42, "unclassified"),
                 ("restore", 137, "unclassified")]
        cases += [(phase, code, "container-client")
                  for phase in ("client", "files", "connection", "restore")
                  for code in (125, 126, 127)]
        cases += [(phase, code, "unclassified")
                  for phase in ("client", "files", "connection", "restore")
                  for code in (137, 143)
                  if (phase, code) != ("restore", 137)]
        phases = ["client", "files", "connection", "restore"]
        for phase, code, category in cases:
            with self.subTest(phase=phase, code=code):
                result, calls = self.run_diagnostic(phase, code)
                self.assertEqual(result.returncode, code)
                preceding = phases[:phases.index(phase)]
                self.assertEqual([call[0] for call in calls], preceding + [phase])
                self.assertEqual(result.stdout, "".join(
                    f"Restore diagnostic: phase={p} status=passed\n" for p in preceding) +
                    f"::error::Restore diagnostic: phase={phase} category={category} "
                    f"exit_code={code} component_hint=unknown "
                    "untrusted_error_category_hint=unknown "
                    "untrusted_statement_class_hint=unknown; private output suppressed\n")

    def test_actual_classifier_ignores_stdout_and_preserves_exit_three(self):
        for component in COMPONENTS.values():
            with self.subTest(component=component):
                result, _ = self.run_diagnostic(
                    "restore", 3,
                    stderr=f"psql:/backup/{component}:12: ERROR:  22012\n")
                self.assertEqual(result.returncode, 3)
                self.assertIn(f"exit_code=3 component_hint={component} ", result.stdout)
                self.assertIn("untrusted_error_category_hint=unknown", result.stdout)
                self.assertIn("untrusted_statement_class_hint=unknown", result.stdout)

    def test_data_categories_survive_both_allowlists_without_private_output(self):
        for sqlstate, category in DATA_ERROR_CATEGORIES.items():
            with self.subTest(sqlstate=sqlstate):
                state = sqlstate.decode("ascii")
                result, _ = self.run_diagnostic(
                    "restore", 3, stderr=f"psql:/backup/data.sql:987654321: ERROR:  {state}\n")
                self.assertEqual(result.returncode, 3)
                self.assertEqual(
                    result.stdout.splitlines()[-1],
                    "::error::Restore diagnostic: phase=restore category=sql-script "
                    "exit_code=3 component_hint=data.sql "
                    f"untrusted_error_category_hint={category} "
                    "untrusted_statement_class_hint=unknown; private output suppressed")
                self.assertNotIn("987654321", result.stdout)
                self.assertNotIn(state, result.stdout)
                self.assertNotIn("psql:/backup/", result.stdout)

    def test_workflow_preserves_data_category_with_canonical_notices_and_warnings(self):
        record = "psql:/backup/data.sql:987654321: ERROR:  22P02\n"
        notice = "psql:/backup/schema.sql:987654322: NOTICE:  00000\n"
        warning = "psql:/backup/data.sql:987654323: WARNING:  01000\n"
        for stderr in (notice + record + warning, warning + record + notice):
            with self.subTest(stderr=stderr):
                result, _ = self.run_diagnostic("restore", 3, stderr=stderr)
                self.assertEqual(result.returncode, 3)
                self.assertEqual(
                    result.stdout,
                    "Restore diagnostic: phase=client status=passed\n"
                    "Restore diagnostic: phase=files status=passed\n"
                    "Restore diagnostic: phase=connection status=passed\n"
                    "::error::Restore diagnostic: phase=restore category=sql-script "
                    "exit_code=3 component_hint=data.sql "
                    "untrusted_error_category_hint=invalid-text-representation "
                    "untrusted_statement_class_hint=unknown; private output suppressed\n")

    def test_workflow_redacts_malformed_and_forged_looking_data_records(self):
        record = "psql:/backup/data.sql:987654321: ERROR:  22P02\n"
        for stderr in (
            record + record,
            record.rstrip("\n") + " SYNTHETIC_PRIVATE_ROW\n",
            "NOTICE:  SYNTHETIC_PRIVATE_FORGERY\n" + record,
        ):
            with self.subTest(stderr=stderr):
                result, _ = self.run_diagnostic("restore", 3, stderr=stderr)
                self.assertEqual(result.returncode, 3)
                self.assertEqual(
                    result.stdout.splitlines()[-1],
                    "::error::Restore diagnostic: phase=restore category=sql-script "
                    "exit_code=3 component_hint=unknown untrusted_error_category_hint=unknown "
                    "untrusted_statement_class_hint=unknown; private output suppressed")

    def test_workflow_rejects_helper_labels_for_the_wrong_component(self):
        cases = [
            ("schema.sql unique-violation unknown", "schema.sql", "unknown"),
            ("roles.sql unique-violation unknown", "roles.sql", "unknown"),
            ("data.sql duplicate-object role-membership-grant", "data.sql", "unknown"),
            ("data.sql unique-violation role-membership-grant", "data.sql", "unique-violation"),
        ]
        for output, component, category in cases:
            with self.subTest(output=output):
                result, _ = self.run_diagnostic(
                    "restore", 3, helper_mode="override", helper_output=output)
                self.assertEqual(result.returncode, 3)
                self.assertEqual(
                    result.stdout.splitlines()[-1],
                    "::error::Restore diagnostic: phase=restore category=sql-script "
                    f"exit_code=3 component_hint={component} untrusted_error_category_hint={category} "
                    "untrusted_statement_class_hint=unknown; private output suppressed")

    def test_restore_error_emits_recognized_roles_hints_only(self):
        result, _ = self.run_diagnostic(
            "restore", 3,
            stderr="psql:/backup/roles.sql:2: ERROR:  42501\n",
            roles_sql=b"CREATE ROLE synthetic_member;\n"
                      b"GRANT synthetic_group TO synthetic_member;\n")
        self.assertEqual(result.returncode, 3)
        self.assertIn("component_hint=roles.sql ", result.stdout)
        self.assertIn("untrusted_error_category_hint=insufficient-privilege", result.stdout)
        self.assertIn("untrusted_statement_class_hint=role-membership-grant", result.stdout)
        self.assertNotIn("SYNTHETIC_PRIVATE", result.stdout + result.stderr)

    def test_workflow_accepts_new_role_classes_without_private_output(self):
        for statement, expected in [
            (b'CREATE ROLE "SYNTHETIC_PRIVATE_ROLE";', 'create-role'),
            (b'ALTER ROLE "SYNTHETIC_PRIVATE_ROLE" WITH SUPERUSER;', 'alter-role-attributes'),
        ]:
            with self.subTest(expected=expected):
                result, _ = self.run_diagnostic(
                    'restore', 3, stderr='psql:/backup/roles.sql:1: ERROR:  42501\n',
                    roles_sql=statement + b'\n')
                self.assertEqual(result.returncode, 3)
                self.assertIn('untrusted_statement_class_hint=' + expected, result.stdout)
                self.assertNotIn('SYNTHETIC_PRIVATE', result.stdout + result.stderr)

    def test_classifier_failure_or_unexpected_output_is_unknown(self):
        for mode in ("crash", "invalid"):
            result, _ = self.run_diagnostic("restore", 3, helper_mode=mode)
            self.assertEqual(result.returncode, 3)
            self.assertIn("component_hint=unknown ", result.stdout)
            self.assertIn("untrusted_error_category_hint=unknown", result.stdout)
            self.assertNotIn("SYNTHETIC_PRIVATE", result.stdout + result.stderr)

    def test_other_phases_and_exit_codes_never_attribute_a_file(self):
        for phase, code in (("client", 3), ("connection", 3),
                            ("restore", 1), ("restore", 2)):
            result, _ = self.run_diagnostic(
                phase, code, stderr="psql:/backup/data.sql:1: ERROR:  22012\n")
            self.assertEqual(result.returncode, code)
            self.assertIn("component_hint=unknown ", result.stdout)

    def test_both_private_logs_remain_in_always_cleanup(self):
        cleanup = WORKFLOW.read_text(encoding="utf-8").split(
            "      - name: Stop isolated database and delete private files", 1)[1]
        self.assertIn("if: always()", cleanup)
        self.assertIn('"$RUNNER_TEMP/private-restore-result.log"', cleanup)
        self.assertIn('"$RUNNER_TEMP/private-restore-stderr.log"', cleanup)

    def test_actual_cleanup_fails_closed_and_attempts_independent_obligations(self):
        cases = (
            ("network-present", 0, 0, 0, 0, 0, 1, True, True),
            ("network-absent", 0, 0, 0, 0, 0, 0, False, True),
            ("docker-list-fails", 1, 0, 0, 0, 1, 0, False, True),
            ("network-remove-fails", 0, 1, 0, 0, 1, 1, True, True),
            ("database-stop-fails", 0, 0, 72, 0, 1, 1, True, True),
            ("private-file-remove-fails", 0, 0, 0, 1, 1, 1, True, True),
            ("unowned-network", 0, 0, 0, 0, 1, 0, True, False),
            ("project-resources-remain", 0, 0, 0, 0, 1, 0, False, True),
            ("project-resource-list-fails", 0, 0, 0, 0, 1, 0, False, True),
        )
        for name, list_status, remove_status, stop_status, rm_status, expected, remove_calls, present, owned in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                workdir = root / "moris-restore-local"
                (workdir / "supabase").mkdir(parents=True)
                (workdir / "supabase/config.toml").write_text("synthetic\n")
                for filename in (
                    "restore-verified-sql", "restore-selected.tar.gz", "restore-selected.json",
                    "private-restore-result.log", "private-restore-stderr.log",
                    "private-verify-result.log", "private-db-start.log",
                    "restore-download-archive.log", "restore-download-evidence.log",
                    "restore-candidate.env",
                ):
                    path = root / filename
                    if filename == "restore-verified-sql":
                        path.mkdir()
                        (path / "synthetic.txt").write_text("SYNTHETIC_PRIVATE_SENTINEL")
                    else:
                        path.write_text("SYNTHETIC_PRIVATE_SENTINEL")
                if owned:
                    (root / "restore-network-owned").write_text("restore-synthetic-cleanup\n")
                stub = r'''\
supabase() {
  [[ "$1" == stop ]] || return 99
  printf 'stop\n' >> "$SYNTHETIC_TEST_LOG_DIR/actions"
  return "$SYNTHETIC_STOP_STATUS"
}
docker() {
  if [[ "$1" == ps && "$2" == -aq ]]; then
    [[ "$SYNTHETIC_PROJECT_RESOURCE_STATUS" == 0 ]] || return "$SYNTHETIC_PROJECT_RESOURCE_STATUS"
    printf '%s\n' "$SYNTHETIC_PROJECT_CONTAINERS"
    return 0
  fi
  if [[ "$1" == volume && "$2" == ls ]]; then
    [[ "$SYNTHETIC_PROJECT_RESOURCE_STATUS" == 0 ]] || return "$SYNTHETIC_PROJECT_RESOURCE_STATUS"
    printf '%s\n' "$SYNTHETIC_PROJECT_VOLUMES"
    return 0
  fi
  if [[ "$1" == network && "$2" == ls ]]; then
    if [[ " $* " == *" -q "* ]]; then
      [[ "$SYNTHETIC_PROJECT_RESOURCE_STATUS" == 0 ]] || return "$SYNTHETIC_PROJECT_RESOURCE_STATUS"
      printf '%s\n' "$SYNTHETIC_PROJECT_NETWORKS"
      return 0
    fi
    [[ "$SYNTHETIC_DOCKER_LIST_STATUS" == 0 ]] || return "$SYNTHETIC_DOCKER_LIST_STATUS"
    printf '%s\n' "$SYNTHETIC_DOCKER_NETWORK_LIST"
    return 0
  fi
  if [[ "$1" == network && "$2" == rm ]]; then
    printf 'network-rm\n' >> "$SYNTHETIC_TEST_LOG_DIR/actions"
    return "$SYNTHETIC_DOCKER_REMOVE_STATUS"
  fi
  return 99
}
rm() {
  [[ "$SYNTHETIC_RM_STATUS" == 0 ]] || return "$SYNTHETIC_RM_STATUS"
  command rm "$@"
}
'''
                network_list = "restore-synthetic-cleanup" if present else "restore-synthetic-cleanup-other"
                env = dict(os.environ, RUNNER_TEMP=bash_path(root),
                           RESTORE_PROJECT_ID="moris-restore-local",
                           RESTORE_DOCKER_NETWORK="restore-synthetic-cleanup",
                           SYNTHETIC_TEST_LOG_DIR=bash_path(root),
                           SYNTHETIC_DOCKER_NETWORK_LIST=network_list,
                           SYNTHETIC_DOCKER_LIST_STATUS=str(list_status),
                           SYNTHETIC_DOCKER_REMOVE_STATUS=str(remove_status),
                           SYNTHETIC_STOP_STATUS=str(stop_status),
                           SYNTHETIC_RM_STATUS=str(rm_status),
                           SYNTHETIC_PROJECT_RESOURCE_STATUS=(
                               "1" if name == "project-resource-list-fails" else "0"
                           ),
                           SYNTHETIC_PROJECT_CONTAINERS=(
                               "synthetic-container-id"
                               if name == "project-resources-remain" else ""
                           ),
                           SYNTHETIC_PROJECT_VOLUMES="",
                           SYNTHETIC_PROJECT_NETWORKS="")
                result = subprocess.run(
                    [self.bash, "--noprofile", "--norc"],
                    input=(stub + self.cleanup_script).encode("utf-8"),
                    capture_output=True, env=env, check=False,
                )
                stdout = result.stdout.decode("utf-8", errors="replace")
                stderr = result.stderr.decode("utf-8", errors="replace")
                self.assertEqual(result.returncode, expected, f"stdout={stdout!r}; stderr={stderr!r}")
                self.assertEqual(stderr, "")
                expected_output = (
                    "Isolated database, volumes, network guard, and private runner files cleaned.\n"
                    if expected == 0 else
                    "::error::Restore cleanup could not be confirmed; runner teardown will recycle the VM\n"
                )
                if name == "project-resources-remain":
                    expected_output = (
                        "::error::Disposable PostgreSQL containers, volumes, or networks remain after cleanup\n"
                        + expected_output
                    )
                self.assertEqual(stdout, expected_output)
                self.assertNotIn("SYNTHETIC_PRIVATE", stdout + stderr)
                if name == "project-resources-remain":
                    self.assertNotIn("synthetic-container-id", stdout + stderr)
                actions = (root / "actions").read_text().splitlines() if (root / "actions").exists() else []
                self.assertIn("stop", actions)
                self.assertEqual(actions.count("network-rm"), remove_calls)
                if expected == 0:
                    self.assertFalse((root / "restore-selected.tar.gz").exists())
                    self.assertFalse(workdir.exists())
                    self.assertFalse((root / "restore-network-owned").exists())
                elif rm_status == 0:
                    self.assertFalse((root / "restore-selected.tar.gz").exists())
                if name == "unowned-network":
                    self.assertFalse((root / "restore-network-owned").exists())
                    self.assertNotIn("network-rm", actions)

    def test_missing_mounted_file_stops_before_connection_or_restore(self):
        result, calls = self.run_diagnostic(missing_file=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual([call[0] for call in calls], ["client", "files"])
        self.assertIn("phase=files category=mounted-files exit_code=1", result.stdout)

    def test_space_containing_path_passes_file_checks(self):
        result, calls = self.run_diagnostic(temp_prefix="stage-b restore ")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(any("stage-b restore " in arg for arg in calls[0]))
        self.assertEqual([call[0] for call in calls],
                         ["client", "files", "connection", "restore"])
        self.assertIn("phase=files status=passed", result.stdout)

    def test_space_containing_path_rejects_missing_file(self):
        result, calls = self.run_diagnostic(missing_file=True,
                                            temp_prefix="stage-b restore ")
        self.assertEqual(result.returncode, 1)
        self.assertTrue(any("stage-b restore " in arg for arg in calls[0]))
        self.assertEqual([call[0] for call in calls], ["client", "files"])
        self.assertIn("phase=files category=mounted-files exit_code=1", result.stdout)


if __name__ == "__main__":
    unittest.main()
