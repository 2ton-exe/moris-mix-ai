"""Synthetic archive tests for the owner restore verifier."""

from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from verify_restore_archive import ArchiveVerificationError, verify_and_extract


COMPONENTS = {
    "roles.sql": b"-- synthetic roles\n",
    "schema.sql": b"-- synthetic schema\n",
    "data.sql": b"COPY public.synthetic (id) FROM stdin;\n1\n\\.\n",
    "history-schema.sql": b"-- synthetic history schema\n",
    "history-data.sql": b"-- synthetic history data\n",
}
STAMP = "2026-11-22T00:00:00Z"
IDENTITY = {
    "archive_sha256": "",
    "archive_size_bytes": 0,
    "workflow_run_id": 123,
    "workflow_run_attempt": 1,
    "source_revision": "a" * 40,
    "source_project_ref": "synthetic-project",
    "source_repository": "2ton-exe/moris-mix-ai",
    "object_key": "postgres/synthetic/archive.tar.gz",
    "consistency_check": "passed",
}


class RestoreArchiveVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "owner-private"
        self.root.mkdir(mode=0o700)
        self.archive = self.root / "backup.tar.gz"
        self.evidence = self.root / "evidence.json"
        self.target = self.root / "restore-verified-sql"

    def _write_bundle(self, *, unsafe_member=None, wrong_component_hash=False, timestamp=STAMP):
        hashes = {
            name: hashlib.sha256(raw).hexdigest()
            for name, raw in COMPONENTS.items()
        }
        if wrong_component_hash:
            hashes["data.sql"] = "0" * 64
        manifest = "".join(f"{hashes[name]}  {name}\n" for name in sorted(COMPONENTS))
        metadata = {
            "source_revision": IDENTITY["source_revision"],
            "source_project_ref": "synthetic-project",
            "workflow_run_id": 123,
            "workflow_run_attempt": 1,
            "generated_at_utc": timestamp,
        }
        members = {
            **COMPONENTS,
            "component-checksums.sha256": manifest.encode("ascii"),
            "backup-metadata.json": json.dumps(metadata).encode("utf-8"),
        }
        if unsafe_member:
            members[unsafe_member] = b"synthetic\n"
        with tarfile.open(self.archive, "w:gz") as bundle:
            for name, raw in members.items():
                info = tarfile.TarInfo("./" + name)
                info.size = len(raw)
                bundle.addfile(info, BytesIO(raw))
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        identity = dict(IDENTITY)
        identity["archive_sha256"] = digest
        identity["archive_size_bytes"] = self.archive.stat().st_size
        identity["generated_at_utc"] = timestamp
        self.evidence.write_text(json.dumps(identity), encoding="utf-8")
        if os.name == "posix":
            self.root.chmod(0o700)
            self.archive.chmod(0o600)
            self.evidence.chmod(0o600)
        env = {
            "BACKUP_SHA256": digest,
            "BACKUP_SIZE": str(self.archive.stat().st_size),
            "BACKUP_RUN_ID": "123",
            "BACKUP_ATTEMPT": "1",
            "BACKUP_SOURCE_SHA": IDENTITY["source_revision"],
            "BACKUP_SOURCE_PROJECT": "synthetic-project",
            "BACKUP_PREFIX": "postgres/synthetic",
            "ARCHIVE_NAME": "archive.tar.gz",
            "GITHUB_REPOSITORY": IDENTITY["source_repository"],
        }
        return env

    def test_verifies_archive_and_extracts_only_bounded_private_files(self):
        env = self._write_bundle()
        with patch.dict(os.environ, env, clear=False):
            verify_and_extract(self.archive, self.evidence, self.target)
        self.assertEqual(
            {path.name for path in self.target.iterdir()},
            set(COMPONENTS) | {"component-checksums.sha256"},
        )
        self.assertEqual((self.target / "data.sql").read_bytes(), COMPONENTS["data.sql"])
        receipt = json.loads((self.root / "verified.json").read_text(encoding="ascii"))
        self.assertEqual(receipt["data_sha256"], hashlib.sha256(COMPONENTS["data.sql"]).hexdigest())
        if os.name == "posix":
            self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.target / "data.sql").stat().st_mode & 0o777, 0o600)

    def test_rejects_bad_archive_identity_without_extracting(self):
        env = self._write_bundle()
        env["BACKUP_SHA256"] = "0" * 64
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(ArchiveVerificationError, "archive-sha256"):
                verify_and_extract(self.archive, self.evidence, self.target)
        self.assertFalse(self.target.exists())

    def test_rejects_unexpected_tar_member(self):
        env = self._write_bundle(unsafe_member="../private.txt")
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(ArchiveVerificationError, "archive-member-name"):
                verify_and_extract(self.archive, self.evidence, self.target)
        self.assertFalse(self.target.exists())

    def test_rejects_component_checksum_mismatch(self):
        env = self._write_bundle(wrong_component_hash=True)
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(ArchiveVerificationError, "component-sha256"):
                verify_and_extract(self.archive, self.evidence, self.target)

    def test_rejects_invalid_timestamp(self):
        env = self._write_bundle(timestamp="2026-11-22T00:00:00+00:00")
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaisesRegex(ArchiveVerificationError, "evidence-timestamp"):
                verify_and_extract(self.archive, self.evidence, self.target)


if __name__ == "__main__":
    unittest.main()
