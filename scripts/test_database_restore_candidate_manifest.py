from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from restore_candidate_manifest import FIELDS, resolve_candidate, verify_manifest_pin, write_shell_environment


def candidate_record(seed: str) -> dict[str, str | int]:
    return {
        "object_prefix": f"postgres/2026/11/25/synthetic-{seed}",
        "archive_name": f"synthetic-{seed}.tar.gz",
        "evidence_name": f"synthetic-{seed}.json",
        "archive_sha256": "a" * 64,
        "archive_size_bytes": 128,
        "workflow_run_id": "12345",
        "workflow_run_attempt": "1",
        "source_revision": "b" * 40,
        "source_project_ref": "c" * 20,
    }


class RestoreCandidateManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = {"backup-7": candidate_record("seven")}

    def test_only_backup_7_is_supported_by_the_ordinary_workflow(self) -> None:
        raw = json.dumps(self.manifest)
        self.assertEqual(set(resolve_candidate("backup-7", raw)), set(FIELDS))
        for name in ("backup-4", "backup-8", "../backup-7"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                resolve_candidate(name, raw)
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", json.dumps({
                **self.manifest,
                "backup-4": candidate_record("four"),
            }))

    def test_independent_manifest_pin_is_required_and_covers_exact_utf8_bytes(self) -> None:
        raw = json.dumps(self.manifest, separators=(",", ":"))
        pin = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        verify_manifest_pin(raw, pin)
        with self.assertRaises(ValueError):
            verify_manifest_pin(raw + " ", pin)
        with self.assertRaises(ValueError):
            verify_manifest_pin(raw, "not-a-pin")

    def test_missing_or_extra_candidate_and_fields_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", json.dumps({"backup-4": candidate_record("four")}))
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", json.dumps({**self.manifest, "other": {}}))
        malformed = json.loads(json.dumps(self.manifest))
        malformed["backup-7"]["unexpected"] = "sentinel-private-value"
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", json.dumps(malformed))
        duplicated = json.dumps({"backup-7": self.manifest["backup-7"]})
        duplicated = duplicated[:-1] + ',"backup-7":{}}'
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", duplicated)

    def test_invalid_paths_hashes_sizes_and_line_breaks_fail_closed(self) -> None:
        bad_values = (
            ("object_prefix", "postgres/../escape"),
            ("archive_name", "../archive.tar.gz"),
            ("evidence_name", "evidence.json\nexport X=1"),
            ("archive_sha256", "not-a-hash"),
            ("archive_size_bytes", "0"),
            ("workflow_run_id", "12\n34"),
            ("workflow_run_attempt", "-1"),
            ("source_revision", "f" * 39),
            ("source_project_ref", "bad/ref"),
        )
        for field, value in bad_values:
            with self.subTest(field=field):
                malformed = json.loads(json.dumps(self.manifest))
                malformed["backup-7"][field] = value
                with self.assertRaises(ValueError):
                    resolve_candidate("backup-7", json.dumps(malformed))

    def test_environment_file_is_private_and_contains_only_the_selected_candidate(self) -> None:
        if os.name != "posix":
            self.skipTest("secure dir_fd output is Linux/POSIX-only")
        values = resolve_candidate("backup-7", json.dumps(self.manifest))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.env"
            write_shell_environment(path, values)
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            contents = path.read_text(encoding="utf-8")
            self.assertIn("synthetic-seven", contents)
            self.assertNotIn("synthetic-four", contents)
            self.assertEqual(len(contents.splitlines()), len(FIELDS))

    def test_private_file_creation_rejects_existing_permissive_file_and_symlinks(self):
        if os.name != "posix":
            self.skipTest("secure dir_fd output is Linux/POSIX-only")
        values = resolve_candidate("backup-7", json.dumps(self.manifest))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            existing = root / "candidate.env"
            existing.write_bytes(b"PREEXISTING_PRIVATE_SENTINEL")
            existing.chmod(0o644)
            with self.assertRaises(FileExistsError):
                write_shell_environment(existing, values)
            self.assertEqual(existing.read_bytes(), b"PREEXISTING_PRIVATE_SENTINEL")
            self.assertEqual(stat.S_IMODE(existing.stat().st_mode), 0o644)

            target = root / "target"
            target.write_bytes(b"SYMLINK_TARGET_SENTINEL")
            alias = root / "alias"
            alias.symlink_to(target)
            with self.assertRaises(OSError):
                write_shell_environment(alias, values)
            self.assertEqual(target.read_bytes(), b"SYMLINK_TARGET_SENTINEL")

            real_parent = root / "real-parent"
            real_parent.mkdir()
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(real_parent, target_is_directory=True)
            with self.assertRaises(OSError):
                write_shell_environment(linked_parent / "candidate.env", values)
            self.assertFalse((real_parent / "candidate.env").exists())

    def test_cli_writes_only_pinned_backup_7_to_private_file(self):
        if os.name != "posix":
            self.skipTest("secure dir_fd output is Linux/POSIX-only")
        raw = json.dumps(self.manifest)
        env = os.environ.copy()
        env["RESTORE_CANDIDATES_JSON"] = raw
        env["RESTORE_CANDIDATE_MANIFEST_SHA256"] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        script = Path(__file__).with_name("restore_candidate_manifest.py")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidate.env"
            result = subprocess.run(
                [sys.executable, str(script), "backup-7", str(output)],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr, "")
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            contents = output.read_text(encoding="utf-8")
            self.assertIn("synthetic-seven", contents)
            self.assertNotIn("synthetic-four", contents)
            self.assertEqual(len(contents.splitlines()), len(FIELDS))

    def test_private_output_failure_removes_partial_file(self):
        if os.name != "posix":
            self.skipTest("secure dir_fd output is Linux/POSIX-only")
        values = resolve_candidate("backup-7", json.dumps(self.manifest))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidate.env"
            with patch("restore_candidate_manifest.os.fdopen", side_effect=OSError("synthetic failure")):
                with self.assertRaises(OSError):
                    write_shell_environment(output, values)
            self.assertFalse(output.exists())

    def test_cli_requires_pinned_exact_manifest_and_never_echoes_it(self):
        script = Path(__file__).with_name("restore_candidate_manifest.py")
        raw = json.dumps({"backup-7": {"secret": "SYNTHETIC_PRIVATE_MANIFEST_SENTINEL"}})
        env = os.environ.copy()
        env["RESTORE_CANDIDATES_JSON"] = raw
        env["RESTORE_CANDIDATE_MANIFEST_SHA256"] = "0" * 64
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidate.env"
            result = subprocess.run(
                [sys.executable, str(script), "backup-7", str(output)],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertFalse(output.exists())
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "::error::Selected restore candidate configuration is missing or invalid",
        )
        self.assertNotIn("SYNTHETIC_PRIVATE_MANIFEST_SENTINEL", result.stderr)

    def test_cli_errors_do_not_echo_private_manifest_values(self) -> None:
        script = Path(__file__).with_name("restore_candidate_manifest.py")
        env = os.environ.copy()
        raw = json.dumps({"backup-7": {"secret": "synthetic-private-sentinel"}})
        env["RESTORE_CANDIDATES_JSON"] = raw
        env["RESTORE_CANDIDATE_MANIFEST_SHA256"] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(script), "backup-7", str(Path(directory) / "candidate.env")],
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr.strip(),
            "::error::Selected restore candidate configuration is missing or invalid",
        )
        self.assertNotIn("synthetic-private-sentinel", result.stderr)


if __name__ == "__main__":
    unittest.main()
