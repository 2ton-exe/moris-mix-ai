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
                         "verb=grant doc_grant=true prefix_pass=false")

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


if __name__ == "__main__":
    unittest.main()
