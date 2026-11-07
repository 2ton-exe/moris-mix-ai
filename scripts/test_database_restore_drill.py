"""Offline fail-closed tests for Stage B's embedded Python verifiers."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
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
                "COPY supabase_migrations.schema_migrations (version, name) FROM stdin;\\n"
                "20261013000000\\tinitial\\n"
                "20261013000000\\tduplicate\\n"
                "\\\\.\\n"
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



if __name__ == "__main__":
    unittest.main()
