"""Synthetic private-file, target-guard, classification, and redaction tests."""

import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

from owner_restore_diagnostic import (
    COMPONENTS,
    _catalog_query,
    _private_root,
    main,
    prepare,
    target_guard_query,
)


BEFORE = {
    "server_version_num": 170011,
    "database": "postgres",
    "system_identifier": "1234567890123456789",
    "auth_users_present": True,
    "public_recipes_absent": True,
    "public_profiles_absent": True,
}


class OwnerRestoreDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "owner-private"
        self.root.mkdir(mode=0o700)
        self.sql_dir = self.root / "restore-verified-sql"
        self.sql_dir.mkdir(mode=0o700)
        if os.name == "posix":
            self.root.chmod(0o700)
            self.sql_dir.chmod(0o700)
        self.stderr = self.root / "data.stderr"
        self.before_path = self.root / "target-before.json"
        self.after_path = self.root / "catalog-after.json"

    def _write_private(self, path, data):
        path.write_bytes(data)
        if os.name == "posix":
            path.chmod(0o600)

    def _set_verified_data(self, data):
        for name in COMPONENTS:
            raw = data if name == "data.sql" else f"-- synthetic {name}\n".encode("ascii")
            self._write_private(self.sql_dir / name, raw)
        hashes = {
            name: hashlib.sha256((self.sql_dir / name).read_bytes()).hexdigest()
            for name in COMPONENTS
        }
        manifest = "".join(f"{hashes[name]}  {name}\n" for name in COMPONENTS)
        self._write_private(self.sql_dir / "component-checksums.sha256", manifest.encode("ascii"))
        receipt = {
            "archive_sha256": "a" * 64,
            "archive_size_bytes": 1234,
            "data_sha256": hashes["data.sql"],
        }
        self._write_private(self.root / "verified.json", (json.dumps(receipt) + "\n").encode("ascii"))

    def _prepare_case(self, data, line, state, extra=b""):
        self._set_verified_data(data)
        record = f"psql:/backup/data.sql:{line}: ERROR:  {state}: synthetic failure\n".encode("ascii")
        self._write_private(self.stderr, record + extra)
        prepare(self.root, self.sql_dir, self.stderr)
        candidate = json.loads((self.root / "candidate.json").read_text(encoding="ascii"))
        if os.name == "posix":
            self.assertEqual((self.root / "catalog-after.sql").stat().st_mode & 0o777, 0o600)
        return candidate

    def _finish(self, candidate, *, relation_present, relkind="r", missing_columns=None,
                sequence_present=False, system_identifier=None, before=None):
        before = dict(BEFORE if before is None else before)
        self._write_private(self.before_path, (json.dumps(before) + "\n").encode("utf-8"))
        context = candidate.get("context")
        parsed = context.get("candidate") if isinstance(context, dict) else None
        if parsed and parsed.get("kind") in ("copy", "sequence"):
            relation = parsed["relation"]["regclass"]
            after_candidate = {
                "kind": parsed["kind"],
                "requested_relation": relation,
                "relation_present": relation_present,
                "schema": parsed["relation"]["schema"] if relation_present else None,
                "name": parsed["relation"]["name"] if relation_present else None,
                "relkind": relkind if relation_present else None,
                "sequence_present": sequence_present if relation_present else None,
                "missing_columns": list(missing_columns or []),
            }
        else:
            after_candidate = None
        after = {
            "server_version_num": 170011,
            "database": "postgres",
            "system_identifier": system_identifier or before["system_identifier"],
            "auth_users_present": True,
            "candidate": after_candidate,
        }
        self._write_private(self.after_path, (json.dumps(after) + "\n").encode("utf-8"))
        (self.root / "inspection.txt").unlink(missing_ok=True)
        output = StringIO()
        with redirect_stdout(output):
            status = main([
                "finalize", "--private-dir", str(self.root),
                "--target-before", str(self.before_path),
                "--catalog-after", str(self.after_path),
            ])
        self.assertEqual(status, 0)
        self.assertEqual(output.getvalue().splitlines(), [output.getvalue().strip()])
        self.assertIn(output.getvalue().strip(), {
            "header-target-absent", "header-dependency", "copy-stream-or-terminator",
            "sequence", "other/unknown",
        })
        return output.getvalue()

    def test_absent_relation_does_not_report_columns_as_missing(self):
        query = _catalog_query({
            "kind": "copy",
            "relation": {
                "regclass": "public.synthetic_missing",
                "schema": "public",
                "name": "synthetic_missing",
            },
            "columns": ["id"],
        })
        self.assertIn("WHERE candidate.oid IS NOT NULL", query)

    def test_missing_copy_target_only_emits_fixed_label(self):
        row = b"synthetic-private-copy-row"
        diagnostic = b"DETAIL: synthetic private detail\nLOCATION: synthetic private location\n"
        candidate = self._prepare_case(
            b"COPY public.synthetic_missing (id) FROM stdin;\n" + row + b"\n\\.\n",
            1,
            "42P01",
            diagnostic,
        )
        output = self._finish(candidate, relation_present=False)
        self.assertEqual(output, "header-target-absent\n")
        report = (self.root / "inspection.txt").read_text(encoding="utf-8")
        self.assertIn("COPY public.synthetic_missing (id) FROM stdin;", report)
        self.assertNotIn(row.decode("ascii"), report)
        self.assertNotIn("synthetic private detail", report)
        self.assertNotIn("synthetic_missing", output)
        self.assertIn(diagnostic, self.stderr.read_bytes())
        if os.name == "posix":
            self.assertEqual((self.root / "inspection.txt").stat().st_mode & 0o777, 0o600)

    def test_missing_header_column_requires_catalog_corroboration(self):
        candidate = self._prepare_case(
            b"COPY public.synthetic_table (missing_col) FROM stdin;\n\\.\n", 1, "42703"
        )
        self.assertEqual(
            self._finish(candidate, relation_present=True, missing_columns=["missing_col"]),
            "header-dependency\n",
        )
        self.assertEqual(
            self._finish(candidate, relation_present=True, missing_columns=["unrelated"]),
            "other/unknown\n",
        )

    def test_copy_line_numbers_use_lf_only_inside_copy_data(self):
        candidate = self._prepare_case(
            b"COPY public.synthetic_table (id) FROM stdin;\nrow\x0bwith-control\n\\.\n",
            3,
            "23514",
        )
        context = candidate["context"]
        self.assertEqual(context["location"], "copy-terminator")
        self.assertNotIn("row", context["statement"].lower())
        self.assertEqual(
            self._finish(candidate, relation_present=True, relkind="r"),
            "copy-stream-or-terminator\n",
        )

    def test_pg_dump_restrict_guards_do_not_shift_statement_attribution(self):
        candidate = self._prepare_case(
            b"\\restrict SyntheticGuard\n"
            b"COPY public.synthetic_missing (id) FROM stdin;\nrow\n\\.\n"
            b"\\unrestrict SyntheticGuard\n",
            2,
            "42P01",
        )
        self.assertEqual(self._finish(candidate, relation_present=False), "header-target-absent\n")

    def test_wrong_or_changed_catalog_target_stays_unknown(self):
        candidate = self._prepare_case(
            b"COPY public.synthetic_missing (id) FROM stdin;\n\\.\n", 1, "42P01"
        )
        self.assertEqual(
            self._finish(candidate, relation_present=False, system_identifier="999999999999999"),
            "other/unknown\n",
        )
        self.assertEqual(
            self._finish(
                candidate,
                relation_present=False,
                before=dict(BEFORE, public_recipes_absent=False),
            ),
            "other/unknown\n",
        )

    def test_sequence_label_requires_matching_catalog_sequence(self):
        candidate = self._prepare_case(
            b"SELECT pg_catalog.setval('public.synthetic_seq', 7, true);\n", 1, "42P01"
        )
        self.assertEqual(self._finish(candidate, relation_present=False), "sequence\n")
        self.assertEqual(
            self._finish(candidate, relation_present=True, relkind="r", sequence_present=False),
            "other/unknown\n",
        )

    def test_ambiguous_error_records_and_unsupported_sql_stay_unknown(self):
        data = b"SELECT payload FROM public.synthetic_table;\n"
        self._set_verified_data(data)
        self._write_private(
            self.stderr,
            b"psql:/backup/data.sql:1: ERROR:  42P01\n"
            b"psql:/backup/data.sql:1: ERROR:  42P01\n",
        )
        prepare(self.root, self.sql_dir, self.stderr)
        candidate = json.loads((self.root / "candidate.json").read_text(encoding="ascii"))
        self.assertIsNone(candidate["error"])
        self.assertEqual(self._finish(candidate, relation_present=False), "other/unknown\n")

    def test_private_root_must_not_overlap_repository(self):
        with self.assertRaisesRegex(ValueError, "overlaps the repository"):
            _private_root(Path(__file__).resolve().parents[1])
        self.assertIn("pg_control_system()", target_guard_query())


if __name__ == "__main__":
    unittest.main()
