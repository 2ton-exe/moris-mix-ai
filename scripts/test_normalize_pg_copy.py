"""Synthetic, offline regression tests for the private-backup ledger comparator."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("normalize-pg-copy.py")


def fixture(*, key="Test123", version="17.11", comments="sample", rows=("20261101\tA", "20261013\tB"), sql="SELECT pg_catalog.setval('migration_seq', 2, true);", table="supabase_migrations.schema_migrations"):
    return (f"-- PostgreSQL database dump\n-- {comments}\n\n"
            f"\\restrict {key}\n\n-- Dumped from database version {version}\n"
            f"-- Dumped by pg_dump version {version}\n\nSET client_encoding = 'UTF8';\n"
            f"COPY {table} (version, name) FROM stdin;\n"
            + "".join(f"{row}\n" for row in rows)
            + "\\.\n" + sql + "\n\n-- PostgreSQL database dump complete\n"
            + f"\\unrestrict {key}\n")


def normalize(source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT)], input=source, text=True,
                          capture_output=True, check=False)


class NormalizeCopyTests(unittest.TestCase):
    def test_nondeterministic_metadata_and_row_order_do_not_change_comparison(self):
        before = fixture(key="RandomKey111", comments="dump started at 08:01", rows=("20261101\tA", "20261013\tB"))
        after = fixture(key="DifferentKey222", version="17.12", comments="dump started at 08:03", rows=("20261013\tB", "20261101\tA"))
        a, b = normalize(before), normalize(after)
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(b.returncode, 0, b.stderr)
        self.assertEqual(a.stdout, b.stdout)
        self.assertIn("COPY supabase_migrations.schema_migrations", a.stdout)
        self.assertNotIn("RandomKey111", a.stdout)
        self.assertNotIn("dump started", a.stdout)

    def test_changed_migration_row_fails_comparison(self):
        self.assertNotEqual(normalize(fixture()).stdout,
                            normalize(fixture(rows=("20261101\tALTERED", "20261013\tB"))).stdout)

    def test_added_or_removed_migration_row_fails_comparison(self):
        base = normalize(fixture()).stdout
        for rows in [("20261101\tA",), ("20261101\tA", "20261013\tB", "new\tC")]:
            with self.subTest(rows=rows):
                self.assertNotEqual(base, normalize(fixture(rows=rows)).stdout)

    def test_sql_outside_copy_is_not_ignored(self):
        self.assertNotEqual(normalize(fixture()).stdout,
                            normalize(fixture(sql="SELECT pg_catalog.setval('migration_seq', 99, true);")).stdout)

    def test_copy_header_change_fails_comparison(self):
        self.assertNotEqual(normalize(fixture()).stdout,
                            normalize(fixture(table="public.unexpected_table")).stdout)

    def test_comment_shaped_copy_rows_are_data_and_are_preserved(self):
        a = normalize(fixture(rows=("--not-a-comment", "20261101\tA")))
        b = normalize(fixture(rows=("20261101\tA", "--changed-row")))
        self.assertEqual(a.returncode, 0)
        self.assertIn("--not-a-comment", a.stdout)
        self.assertNotEqual(a.stdout, b.stdout)

    def test_duplicate_migration_rows_are_not_deduplicated(self):
        a = normalize(fixture(rows=("A", "A", "B")))
        b = normalize(fixture(rows=("A", "B")))
        self.assertNotEqual(a.stdout, b.stdout)

    def test_unterminated_copy_fails_closed(self):
        result = normalize("COPY public.x FROM stdin;\n1\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unterminated", result.stderr)

    def test_missing_copy_fails_closed(self):
        result = normalize("-- empty dump\nSET client_encoding = 'UTF8';\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing", result.stderr)

    def test_malformed_copy_header_fails_closed(self):
        result = normalize("COPY public.x;\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("malformed", result.stderr)

    def test_mismatched_guard_fails_closed(self):
        result = normalize(fixture().replace("\\unrestrict Test123", "\\unrestrict OtherKey"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("mismatched", result.stderr)

    def test_missing_unrestrict_fails_closed(self):
        result = normalize(fixture().replace("\\unrestrict Test123", ""))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unclosed", result.stderr)

    def test_unexpected_copy_terminator_fails_closed(self):
        result = normalize("\\.\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected", result.stderr)

    def test_unknown_executable_statement_is_preserved(self):
        result = normalize(fixture(sql="DO $$ BEGIN RAISE EXCEPTION 'unsafe'; END $$;"))
        self.assertEqual(result.returncode, 0)
        self.assertIn("DO $$ BEGIN RAISE EXCEPTION 'unsafe'; END $$;", result.stdout)

    def test_semantic_difference_not_suppressed_by_comment_change(self):
        a = normalize(fixture(comments="different", sql="SELECT 1;"))
        b = normalize(fixture(comments="other", sql="SELECT 2;"))
        self.assertNotEqual(a.stdout, b.stdout)


if __name__ == "__main__":
    unittest.main()
