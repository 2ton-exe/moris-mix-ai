"""Credential-free regression tests for the protected role-replay diagnostic."""
from pathlib import Path
import tempfile
import unittest

from restore_role_probe import (
    DOCUMENTED_GRANT, bounded_lines, counts, result,
)

ERROR1 = b"psql:/backup/roles.sql:1: ERROR:  42501\n"
ERROR2 = b"psql:/backup/roles.sql:2: ERROR:  42501\n"


class RestoreRoleProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.roles = self.root / "roles.sql"
        self.schema = self.root / "schema.sql"

    def put(self, role_lines, schema_lines=b"-- no schema owners\n"):
        self.roles.write_bytes(role_lines)
        self.schema.write_bytes(schema_lines)

    def test_exact_documented_grant_and_ownership_counts(self):
        self.put(DOCUMENTED_GRANT + b"\n",
                 b'ALTER TABLE public.a OWNER TO "supabase_admin";\n'
                 b'ALTER FUNCTION public.b() OWNER TO "supabase_admin";\n'
                 b'ALTER SEQUENCE public.c OWNER TO "supabase_admin";\n')
        self.assertEqual(counts(self.roles, self.schema),
                         "doc_grant=1 owner_table=1 owner_function=1 owner_other=1")

    def test_ignores_comment_and_unrelated_owner(self):
        self.put(b"-- " + DOCUMENTED_GRANT + b"\n",
                 b'-- ALTER TABLE public.x OWNER TO "supabase_admin";\n'
                 b'ALTER TABLE public.x OWNER TO "another_owner";\n')
        self.assertEqual(counts(self.roles, self.schema),
                         "doc_grant=0 owner_table=0 owner_function=0 owner_other=0")

    def test_exact_documented_grant_failure(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=grant doc_grant=true prefix_pass=true")

    def test_prefix_failure_is_distinct(self):
        self.put(b"/* unsupported multiline block */\n" + DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false")

    def test_multiline_failure_is_not_attributed(self):
        self.put(b"GRANT role_one\nTO role_two;\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false")

    def test_comment_or_meta_line_is_not_attributed(self):
        self.put(b"-- GRANT x TO y;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false")

    def test_other_role_statement(self):
        self.put(b"ALTER ROLE example SET search_path TO public, auth;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=alter-role doc_grant=false prefix_pass=true")

    def test_non_sql_error_and_success(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        unknown = ("replay=failed category=unknown verb=unknown "
                   "doc_grant=unknown prefix_pass=unknown")
        self.assertEqual(result(b"secret PRIVATE SQL\n", self.roles, 3), unknown)
        self.assertEqual(result(b"", self.roles, 0),
                         "replay=passed category=unknown verb=unknown "
                         "doc_grant=unknown prefix_pass=unknown")

    def test_spoofed_multiple_error_is_rejected(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        output = result(ERROR1 + ERROR1, self.roles, 3)
        self.assertIn("verb=unknown", output)
        self.assertNotIn("doc_grant=true", output)

    def test_component_mismatch_does_not_expose_line(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        output = result(b"psql:/backup/data.sql:1: ERROR:  42501\n", self.roles, 3)
        self.assertIn("verb=unknown", output)

    def test_oversize_line_fails_closed(self):
        self.put(b"A" * 4097)
        with self.assertRaises(ValueError):
            bounded_lines(self.roles)

    def test_unavailable_line_does_not_guess_verb(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        output = result(ERROR2, self.roles, 3)
        self.assertIn("verb=unknown", output)

    def test_counts_cannot_include_custom_identifier_values(self):
        self.put(b'GRANT "private_name" TO "another_name";\n',
                 b'ALTER TABLE secret.customer OWNER TO "supabase_admin";\n')
        output = counts(self.roles, self.schema)
        self.assertEqual(output,
                         "doc_grant=0 owner_table=1 owner_function=0 owner_other=0")
        self.assertNotIn("secret", output)
        self.assertNotIn("customer", output)


    def test_publish_accepts_only_exact_bytes_and_consistent_states(self):
        from restore_role_probe import publish
        counts_path = self.root / "private-counts.out"
        flags_path = self.root / "private-flags.out"
        result_path = self.root / "private-result.out"
        summary = self.root / "summary.txt"
        count = b"doc_grant=1 owner_table=2 owner_function=3 owner_other=0\n"
        flags = b"0|1|0|0|1\n"
        failed = (b"replay=failed category=insufficient-privilege verb=grant "
                  b"doc_grant=true prefix_pass=true\n")
        for path, record in ((counts_path, count), (flags_path, flags),
                             (result_path, failed)):
            path.write_bytes(record)
        publish(counts_path, flags_path, result_path, 3, summary)
        safe = summary.read_text()
        self.assertIn("doc_grant=1 owner_table=2", safe)
        self.assertIn("Untrusted role replay labels", safe)

        bad_cases = [
            (counts_path, count + b"\n"),
            (counts_path, count + b"\x00"),
            (counts_path, b"doc_grant=1000000 owner_table=2 owner_function=3 owner_other=0\n"),
            (flags_path, flags + b"\x00"),
            (flags_path, flags + b"\n"),
            (result_path, failed + b"\n"),
            (result_path, failed + b"\x00"),
            (result_path, b"replay=passed category=unknown verb=unknown "
                          b"doc_grant=unknown prefix_pass=unknown\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=grant "
                          b"doc_grant=true prefix_pass=false\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=alter-role "
                          b"doc_grant=true prefix_pass=true\n"),
        ]
        for path, record in bad_cases:
            with self.subTest(path=path.name, data=record[:24]):
                previous = path.read_bytes()
                path.write_bytes(record)
                before = summary.read_bytes()
                with self.assertRaises(ValueError):
                    publish(counts_path, flags_path, result_path, 3, summary)
                self.assertEqual(summary.read_bytes(), before)
                path.write_bytes(previous)

    def test_publish_success_must_match_zero_exit_status(self):
        from restore_role_probe import publish
        counts_path = self.root / "counts.out"
        flags_path = self.root / "flags.out"
        result_path = self.root / "result.out"
        summary = self.root / "summary.out"
        counts_path.write_bytes(
            b"doc_grant=0 owner_table=0 owner_function=0 owner_other=0\n")
        flags_path.write_bytes(b"0|1|0|0|1\n")
        result_path.write_bytes(
            b"replay=passed category=unknown verb=unknown "
            b"doc_grant=unknown prefix_pass=unknown\n")
        publish(counts_path, flags_path, result_path, 0, summary)
        with self.assertRaises(ValueError):
            publish(counts_path, flags_path, result_path, 3, summary)



if __name__ == "__main__":
    unittest.main()
