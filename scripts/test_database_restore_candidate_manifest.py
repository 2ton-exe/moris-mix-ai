from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from restore_candidate_manifest import FIELDS, resolve_candidate, write_shell_environment


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
        self.manifest = {
            "backup-4": candidate_record("four"),
            "backup-7": candidate_record("seven"),
        }

    def test_only_the_two_reviewed_candidate_labels_are_supported(self) -> None:
        for name in ("backup-4", "backup-7"):
            with self.subTest(name=name):
                self.assertEqual(
                    set(resolve_candidate(name, json.dumps(self.manifest))), set(FIELDS)
                )
        with self.assertRaises(ValueError):
            resolve_candidate("backup-8", json.dumps(self.manifest))
        with self.assertRaises(ValueError):
            resolve_candidate("../backup-7", json.dumps(self.manifest))

    def test_missing_or_extra_candidate_and_fields_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            resolve_candidate("backup-7", json.dumps({"backup-4": self.manifest["backup-4"]}))
        with self.assertRaises(ValueError):
            resolve_candidate("backup-4", json.dumps({**self.manifest, "other": {}}))
        malformed = json.loads(json.dumps(self.manifest))
        malformed["backup-4"]["unexpected"] = "sentinel-private-value"
        with self.assertRaises(ValueError):
            resolve_candidate("backup-4", json.dumps(malformed))
        duplicated = json.dumps({"backup-4": self.manifest["backup-4"]})
        duplicated = duplicated[:-1] + ',"backup-4":{}}'
        with self.assertRaises(ValueError):
            resolve_candidate("backup-4", duplicated)

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
                malformed["backup-4"][field] = value
                with self.assertRaises(ValueError):
                    resolve_candidate("backup-4", json.dumps(malformed))

    def test_environment_file_is_private_and_contains_only_the_selected_candidate(self) -> None:
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

    def test_cli_errors_do_not_echo_private_manifest_values(self) -> None:
        script = Path(__file__).with_name("restore_candidate_manifest.py")
        env = os.environ.copy()
        env["RESTORE_CANDIDATES_JSON"] = json.dumps({"backup-7": {"secret": "synthetic-private-sentinel"}})
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
