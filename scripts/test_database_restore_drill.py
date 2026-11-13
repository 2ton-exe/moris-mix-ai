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

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/database-restore-stage-b.yml"
SQL = ("roles.sql", "schema.sql", "data.sql", "history-schema.sql", "history-data.sql")


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
    if len(collected) != 3:
        raise AssertionError(f"Expected three embedded Python programs, got {len(collected)}")
    return collected


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
        cls.verify_archive, cls.configure_db, cls.verify_counts = programs()

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

    def run_diagnostic(self, phase="none", code=0, missing_file=False,
                       temp_prefix="tmp"):
        # No Docker daemon, network, or SQL execution. Both streams deliberately
        # contain synthetic private markers, including annotation-like content.
        stub = r'''
docker() {
  local phase=restore arg
  for arg in "$@"; do
    case "$arg" in
      --version) phase=client ;;
      sh) phase=files ;;
      'SELECT 1') phase=connection ;;
    esac
  done
  printf '%s\n' "$phase" "$@" END >> "$RUNNER_TEMP/trace"
  printf 'SYNTHETIC_PRIVATE_SQL credential=synthetic row=synthetic\n'
  printf '::error::SYNTHETIC_PRIVATE_STDERR SELECT secret FROM synthetic;\n' >&2
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
'''
        with tempfile.TemporaryDirectory(prefix=temp_prefix) as td:
            root = Path(td)
            backup = root / "restore-verified-sql"
            backup.mkdir()
            for name in SQL:
                if not (missing_file and name == "data.sql"):
                    (backup / name).write_text("SYNTHETIC_PRIVATE_DUMP")
            env = dict(os.environ, RUNNER_TEMP=root.as_posix(),
                       PSQL_IMAGE="synthetic-pinned-image", FAIL_PHASE=phase,
                       FAIL_CODE=str(code))
            result = subprocess.run([self.bash, "--noprofile", "--norc"],
                                    input=stub + self.script, text=True,
                                    capture_output=True, env=env, check=False)
            private_log = root / "private-restore-result.log"
            self.assertIn("SYNTHETIC_PRIVATE_SQL", private_log.read_text())
            self.assertIn("SYNTHETIC_PRIVATE_STDERR", private_log.read_text())
            if os.name != "nt":
                self.assertEqual(private_log.stat().st_mode & 0o777, 0o600)
            trace = (root / "trace").read_text().split("END\n")[:-1]
            calls = [record.strip().splitlines() for record in trace]
            self.assertEqual({path.name for path in backup.iterdir()},
                             set(SQL) - ({"data.sql"} if missing_file else set()))
            for path in backup.iterdir():
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
            self.assertEqual(call[1:5], ["run", "--rm", "--network", "host"])
            self.assertIn("--read-only", call)
            self.assertIn("no-new-privileges", call)
            self.assertIn("ALL", call)
            self.assertIn("synthetic-pinned-image", call)
            self.assertTrue(any(arg.endswith("target=/backup,readonly") for arg in call))
        restore = calls[-1]
        self.assertEqual(restore[restore.index("psql"):], [
            "psql", "-X", "-q", "--single-transaction", "-v", "ON_ERROR_STOP=1",
            "-f", "/backup/roles.sql", "-f", "/backup/schema.sql",
            "-f", "/backup/history-schema.sql",
            "-c", "SET session_replication_role = replica",
            "-f", "/backup/data.sql", "-f", "/backup/history-data.sql",
            "-d", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"])

    def test_bash_syntax(self):
        result = subprocess.run([self.bash, "--noprofile", "--norc", "-n"],
                                input=self.script, text=True, capture_output=True,
                                check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failure_categories_and_actual_exit_codes(self):
        cases = [("client", 1, "container-client"),
                 ("files", 1, "mounted-files"),
                 ("connection", 1, "client-fatal"),
                 ("connection", 2, "connection"),
                 ("restore", 1, "client-fatal"),
                 ("restore", 2, "connection"),
                 ("restore", 3, "sql-script"),
                 ("restore", 42, "unclassified"),
                 ("restore", 137, "unclassified")]
        cases += [(phase, code, "container-client")
                  for phase in ("client", "files", "connection", "restore")
                  for code in (125, 126, 127)]
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
                    f"exit_code={code}; private output suppressed\n")

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
