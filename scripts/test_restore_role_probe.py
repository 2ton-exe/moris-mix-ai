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
                         "doc_grant=1 grantor_candidates=1 owner_table=1 owner_function=1 owner_other=1")

    def test_ignores_comment_and_unrelated_owner(self):
        self.put(b"-- " + DOCUMENTED_GRANT + b"\n",
                 b'-- ALTER TABLE public.x OWNER TO "supabase_admin";\n'
                 b'ALTER TABLE public.x OWNER TO "another_owner";\n')
        self.assertEqual(counts(self.roles, self.schema),
                         "doc_grant=0 grantor_candidates=0 owner_table=0 owner_function=0 owner_other=0")

    def test_exact_documented_grant_failure(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=grant doc_grant=true prefix_pass=true membership=match")

    def test_prefix_failure_is_distinct(self):
        self.put(b"/* unsupported multiline block */\n" + DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown")

    def test_multiline_failure_is_not_attributed(self):
        self.put(b"GRANT role_one\nTO role_two;\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown")

    def test_comment_or_meta_line_is_not_attributed(self):
        self.put(b"-- GRANT x TO y;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown")

    def test_other_role_statement(self):
        self.put(b"ALTER ROLE example SET search_path TO public, auth;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=alter-role doc_grant=false prefix_pass=true membership=not-applicable")

    def test_non_sql_error_and_success(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        unknown = ("replay=failed category=unknown verb=unknown "
                   "doc_grant=unknown prefix_pass=unknown membership=unknown")
        self.assertEqual(result(b"secret PRIVATE SQL\n", self.roles, 3), unknown)
        self.assertEqual(result(b"", self.roles, 0),
                         "replay=passed category=unknown verb=unknown "
                         "doc_grant=unknown prefix_pass=unknown membership=unknown")

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
                         "doc_grant=0 grantor_candidates=0 owner_table=1 owner_function=0 owner_other=0")
        self.assertNotIn("secret", output)
        self.assertNotIn("customer", output)


    def test_publish_accepts_only_exact_bytes_and_consistent_states(self):
        from restore_role_probe import publish
        counts_path = self.root / "private-counts.out"
        flags_path = self.root / "private-flags.out"
        result_path = self.root / "private-result.out"
        summary = self.root / "summary.txt"
        count = b"doc_grant=1 grantor_candidates=2 owner_table=2 owner_function=3 owner_other=0\n"
        flags = b"0|1|0|0|1\n"
        failed = (b"replay=failed category=insufficient-privilege verb=grant "
                  b"doc_grant=true prefix_pass=true membership=match\n")
        for path, record in ((counts_path, count), (flags_path, flags),
                             (result_path, failed)):
            path.write_bytes(record)
        publish(counts_path, flags_path, result_path, 3, summary)
        safe = summary.read_text()
        self.assertIn("doc_grant=1 grantor_candidates=2 owner_table=2", safe)
        self.assertIn("Untrusted role replay labels", safe)

        bad_cases = [
            (counts_path, count + b"\n"),
            (counts_path, count + b"\x00"),
            (counts_path, b"doc_grant=1000000 grantor_candidates=2 owner_table=2 owner_function=3 owner_other=0\n"),
            (flags_path, flags + b"\x00"),
            (flags_path, flags + b"\n"),
            (result_path, failed + b"\n"),
            (result_path, failed + b"\x00"),
            (result_path, b"replay=passed category=unknown verb=unknown "
                          b"doc_grant=unknown prefix_pass=unknown membership=unknown\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=grant "
                          b"doc_grant=true prefix_pass=false membership=unknown\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=alter-role "
                          b"doc_grant=true prefix_pass=true membership=not-applicable\n"),
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
            b"doc_grant=0 grantor_candidates=0 owner_table=0 owner_function=0 owner_other=0\n")
        flags_path.write_bytes(b"0|1|0|0|1\n")
        result_path.write_bytes(
            b"replay=passed category=unknown verb=unknown "
            b"doc_grant=unknown prefix_pass=unknown membership=unknown\n")
        publish(counts_path, flags_path, result_path, 0, summary)
        with self.assertRaises(ValueError):
            publish(counts_path, flags_path, result_path, 3, summary)



    def test_grantor_token_inside_identifier_or_comment_is_not_clause(self):
        fixtures = [
            b'GRANT "x GRANTED BY y" TO z;\n',
            b'GRANT x TO "y GRANTED BY z";\n',
            b'GRANT x TO y; -- seen GRANTED BY z\n',
            b'GRANT "x"" GRANTED BY z" TO y;\n',
        ]
        for sql in fixtures:
            with self.subTest(sql=sql):
                self.put(sql)
                self.assertEqual(
                    counts(self.roles, self.schema),
                    "doc_grant=0 grantor_candidates=0 "
                    "owner_table=0 owner_function=0 owner_other=0")

    def test_real_grantor_with_comment_marker_inside_quoted_identifier(self):
        self.put(b'GRANT "role--part" TO "member" GRANTED BY "admin"; -- note\n')
        self.assertEqual(
            counts(self.roles, self.schema),
            "doc_grant=0 grantor_candidates=1 "
            "owner_table=0 owner_function=0 owner_other=0")

    def test_real_role_grantor_with_comment_still_counts(self):
        self.put(b'GRANT a TO b GRANTED BY c; -- note\n')
        self.assertEqual(
            counts(self.roles, self.schema),
            "doc_grant=0 grantor_candidates=1 "
            "owner_table=0 owner_function=0 owner_other=0")

    def test_variant_grantor_and_unquoted_owner_are_candidates(self):
        self.put(
            b'GRANT "postgres" TO "cli_login_postgres" WITH INHERIT FALSE, '
            b'SET FALSE GRANTED BY "supabase_admin";\n',
            b'ALTER TABLE public.t OWNER TO supabase_admin;\n'
            b'ALTER FUNCTION public.f() OWNER TO supabase_admin;\n')
        # A zero exact match is not absence of other one-line grantor clauses.
        self.assertEqual(
            counts(self.roles, self.schema),
            "doc_grant=0 grantor_candidates=1 "
            "owner_table=1 owner_function=1 owner_other=0")

    def test_optional_counts_unavailable_preserves_replay_diagnostic(self):
        from restore_role_probe import publish
        c = self.root / "counts.out"
        f = self.root / "flags.out"
        r = self.root / "result.out"
        out = self.root / "summary.txt"
        c.write_bytes(b"counts=unavailable\n")
        f.write_bytes(b"0|1|0|0|1\n")
        r.write_bytes(
            b"replay=failed category=insufficient-privilege "
            b"verb=unknown doc_grant=unknown prefix_pass=false membership=unknown\n")
        publish(c, f, r, 3, out)
        self.assertIn("counts=unavailable", out.read_text())
        with self.assertRaises(ValueError):
            c.write_bytes(b"counts=unavailable\n\n")
            publish(c, f, r, 3, out)

    def test_schema_long_line_does_not_make_counts_trustworthy(self):
        self.put(DOCUMENTED_GRANT + b"\n",
                 b"ALTER TABLE x OWNER TO supabase_admin; -- " + b"x"*5000 + b"\n")
        with self.assertRaises(ValueError):
            counts(self.roles, self.schema)

    def test_workflow_marks_failed_roles_replay_red(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/database-restore-role-diagnostic.yml").read_text()
        self.assertIn('if [[ "$rc" == 3 ]]; then', workflow)
        self.assertIn('Role-only SQL replay failed (diagnostic recorded; not recovery)', workflow)
        self.assertIn("printf 'counts=unavailable\\n'", workflow)



    def test_checked_in_workflow_replay_exit_and_summary_with_stubs(self):
        """Execute the checked-in Bash replay step, not a source-text grep."""
        import os
        import subprocess
        import textwrap

        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/database-restore-role-diagnostic.yml").read_text()
        start = "      - name: Record bounded role patterns and replay diagnostics\n"
        end = "      - name: Stop isolated database and delete private files\n"
        self.assertEqual(workflow.count(start), 1)
        self.assertEqual(workflow.count(end), 1)
        step = workflow.split(start, 1)[1].split(end, 1)[0]
        self.assertIn("        run: |\n", step)
        bash = textwrap.dedent(step.split("        run: |\n", 1)[1])
        self.assertTrue(bash.startswith("set -euo pipefail\n"))

        stub = r'''
        docker() {
          case " $* " in
            *" -c SELECT rolsuper"*)
              printf 'flags\n' >> "$RUNNER_TEMP/calls"
              printf '0|1|0|0|1\n'
              ;;
            *" -f /backup/roles.sql "*)
              printf 'replay\n' >> "$RUNNER_TEMP/calls"
              printf 'PRIVATE_SYNTHETIC_MARKER\n'
              if [[ "$REVIEW_REPLAY_EXIT" == 3 ]]; then
                printf 'psql:/backup/roles.sql:1: ERROR:  42501\n' >&2
              fi
              return "$REVIEW_REPLAY_EXIT"
              ;;
            *) return 99 ;;
          esac
        }
        '''
        for replay_exit, unavailable in ((0, False), (3, False),
                                         (0, True), (3, True)):
            with self.subTest(replay_exit=replay_exit, unavailable=unavailable):
                root = self.root / f"replay-{replay_exit}-{int(unavailable)}"
                root.mkdir()
                verified = root / "restore-verified-sql"
                verified.mkdir()
                (verified / "roles.sql").write_bytes(DOCUMENTED_GRANT + b"\n")
                (verified / "schema.sql").write_bytes(
                    (b"x" * 5000 + b"\n") if unavailable
                    else b"-- synthetic schema\n")
                summary = root / "summary.md"
                env = os.environ.copy()
                env.update({"RUNNER_TEMP": str(root),
                            "GITHUB_STEP_SUMMARY": str(summary),
                            "PSQL_IMAGE": "synthetic-image",
                            "REVIEW_REPLAY_EXIT": str(replay_exit)})
                run = subprocess.run(
                    ["bash", "--noprofile", "--norc", "-eo", "pipefail"],
                    input=(stub + bash).encode(),
                    cwd=Path(__file__).resolve().parents[1], env=env,
                    capture_output=True, check=False)
                self.assertEqual(run.returncode, 0 if replay_exit == 0 else 1,
                                 (run.stdout, run.stderr))
                self.assertEqual((root / "calls").read_text().splitlines(),
                                 ["flags", "replay"])
                self.assertTrue(summary.is_file())
                public = run.stdout.decode() + summary.read_text()
                self.assertNotIn("PRIVATE_SYNTHETIC_MARKER", public)
                self.assertNotIn("psql:/backup/roles.sql", public)
                self.assertIn("counts=unavailable" if unavailable else
                              "doc_grant=1", public)
                self.assertIn("replay=failed" if replay_exit == 3 else
                              "replay=passed", public)
                self.assertEqual("Role-only SQL replay failed" in public,
                                 replay_exit == 3)
                self.assertIn("membership=match" if replay_exit == 3
                              else "membership=unknown", public)


    def test_failing_grant_membership_form_is_bounded(self):
        # This is structural evidence only; unmatched grants remain unclassified.
        cases = [
            (b'GRANT role_a TO role_b;\n', "match"),
            (b'GRANT "role A" TO "role B" WITH INHERIT FALSE, SET TRUE;\n',
             "match"),
            (b'GRANT "x--in name" TO "dest";\n', "match"),
            (b'GRANT SELECT ON TABLE public.orders TO app;\n', "unclassified"),
            (b'GRANT role_a TO role_b; -- trailing note\n', "unclassified"),
        ]
        for sql, shape in cases:
            with self.subTest(form=shape):
                self.put(sql)
                observed = result(ERROR1, self.roles, 3)
                self.assertEqual(
                    observed,
                    "replay=failed category=insufficient-privilege verb=grant "
                    f"doc_grant=false prefix_pass=true membership={shape}")
                for identifier in ("role_a", "role_b", "orders", "app", "dest"):
                    self.assertNotIn(identifier, observed)

    def test_publish_rejects_contradictory_membership_labels(self):
        from restore_role_probe import publish
        c, f, r, out = (self.root / name for name in
                        ("counts.out", "flags.out", "result.out", "summary.txt"))
        c.write_bytes(
            b"doc_grant=0 grantor_candidates=0 owner_table=0 owner_function=0 owner_other=0\n")
        f.write_bytes(b"0|1|1|1|1\n")
        invalid = [
            (3, b"replay=failed category=insufficient-privilege verb=grant "
             b"doc_grant=false prefix_pass=true membership=not-applicable\n"),
            (3, b"replay=failed category=insufficient-privilege verb=alter-role "
             b"doc_grant=false prefix_pass=true membership=match\n"),
            (3, b"replay=failed category=unknown verb=unknown "
             b"doc_grant=unknown prefix_pass=false membership=match\n"),
            (0, b"replay=passed category=unknown verb=unknown "
             b"doc_grant=unknown prefix_pass=unknown membership=match\n"),
        ]
        for rc, record in invalid:
            with self.subTest(rc=rc):
                r.write_bytes(record)
                with self.assertRaises(ValueError):
                    publish(c, f, r, rc, out)
                self.assertFalse(out.exists())



if __name__ == "__main__":
    unittest.main()
