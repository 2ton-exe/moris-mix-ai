"""Credential-free regression tests for the protected role-replay diagnostic."""
from pathlib import Path
import tempfile
import unittest

from restore_role_probe import (
    DOCUMENTED_GRANT, bounded_lines, counts, result,
)

ERROR1 = b"psql:/backup/roles.sql:1: ERROR:  42501\n"
ERROR2 = b"psql:/backup/roles.sql:2: ERROR:  42501\n"
PARAMETER_SQL = b'GRANT SET ON PARAMETER "synthetic.setting" TO "synthetic_role";'
UNATTRIBUTED_FAILURE = (
    "replay=failed category=unknown verb=unknown doc_grant=unknown "
    "prefix_pass=unknown membership=unknown grant_type=other-or-unknown"
)


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
                         "verb=grant doc_grant=true prefix_pass=true membership=match "
                         "grant_type=role-membership-grant")

    def test_prefix_failure_is_distinct(self):
        self.put(b"/* unsupported multiline block */\n" + DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown "
                         "grant_type=other-or-unknown")

    def test_multiline_failure_is_not_attributed(self):
        self.put(b"GRANT role_one\nTO role_two;\n")
        self.assertEqual(result(ERROR2, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown "
                         "grant_type=other-or-unknown")

    def test_comment_or_meta_line_is_not_attributed(self):
        self.put(b"-- GRANT x TO y;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=unknown doc_grant=unknown prefix_pass=false membership=unknown "
                         "grant_type=other-or-unknown")

    def test_other_role_statement(self):
        self.put(b"ALTER ROLE example SET search_path TO public, auth;\n")
        self.assertEqual(result(ERROR1, self.roles, 3),
                         "replay=failed category=insufficient-privilege "
                         "verb=alter-role doc_grant=false prefix_pass=true membership=not-applicable "
                         "grant_type=other-or-unknown")

    def test_non_sql_error_and_success(self):
        self.put(DOCUMENTED_GRANT + b"\n")
        self.assertEqual(result(b"secret PRIVATE SQL\n", self.roles, 3), UNATTRIBUTED_FAILURE)
        self.assertEqual(result(b"", self.roles, 0),
                         "replay=passed category=unknown verb=unknown "
                         "doc_grant=unknown prefix_pass=unknown membership=unknown "
                         "grant_type=other-or-unknown")

    def test_unsupported_sqlstates_do_not_read_or_classify_the_statement(self):
        from unittest.mock import patch

        cases = (
            (b"42601", b"GRANT example TO WHERE;"),
            (b"22021", b'GRANT SET ON PARAMETER "synthetic.\xff" TO "synthetic_role";'),
            (b"57014", DOCUMENTED_GRANT),
        )
        for sqlstate, sql in cases:
            with self.subTest(sqlstate=sqlstate):
                self.put(sql + b"\n")
                stderr = ERROR1.replace(b"42501", sqlstate)
                with patch("restore_role_probe.bounded_lines") as read_roles:
                    self.assertEqual(result(stderr, self.roles, 3), UNATTRIBUTED_FAILURE)
                    read_roles.assert_not_called()

    def test_recognized_sqlstates_still_classify_valid_grants(self):
        for sqlstate, category in ((b"42501", "insufficient-privilege"),
                                   (b"42704", "undefined-object"),
                                   (b"42710", "duplicate-object")):
            for sql, documented, membership, kind in (
                    (PARAMETER_SQL, "false", "unclassified", "parameter-grant"),
                    (DOCUMENTED_GRANT, "true", "match", "role-membership-grant")):
                with self.subTest(sqlstate=sqlstate, kind=kind):
                    self.put(sql + b"\n")
                    stderr = ERROR1.replace(b"42501", sqlstate)
                    self.assertEqual(
                        result(stderr, self.roles, 3),
                        f"replay=failed category={category} verb=grant doc_grant={documented} "
                        f"prefix_pass=true membership={membership} grant_type={kind}")

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
                  b"doc_grant=true prefix_pass=true membership=match "
                  b"grant_type=role-membership-grant\n")
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
                          b"doc_grant=unknown prefix_pass=unknown membership=unknown "
                          b"grant_type=other-or-unknown\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=grant "
                          b"doc_grant=true prefix_pass=false membership=unknown "
                          b"grant_type=other-or-unknown\n"),
            (result_path, b"replay=failed category=insufficient-privilege verb=alter-role "
                          b"doc_grant=true prefix_pass=true membership=not-applicable "
                          b"grant_type=other-or-unknown\n"),
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
            b"doc_grant=unknown prefix_pass=unknown membership=unknown "
            b"grant_type=other-or-unknown\n")
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
            b"verb=unknown doc_grant=unknown prefix_pass=false membership=unknown "
            b"grant_type=other-or-unknown\n")
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

    def test_workflow_always_cleans_up_private_replay_files(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/database-restore-role-diagnostic.yml").read_text()
        cleanup = workflow.split("- name: Stop isolated database and delete private files\n")[1]
        self.assertTrue(cleanup.startswith("        if: always()\n"))
        self.assertIn("supabase stop", cleanup)
        for name in ("private-probe-result.out", "private-probe-result.err",
                     "private-restore-result.log", "private-restore-stderr.log"):
            self.assertIn(f'"$RUNNER_TEMP/{name}"', cleanup)


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
                printf 'psql:/backup/roles.sql:1: ERROR:  %s\n' "$REVIEW_SQLSTATE" >&2
              fi
              return "$REVIEW_REPLAY_EXIT"
              ;;
            *) return 99 ;;
          esac
        }
        '''
        cases = (
            (0, False, DOCUMENTED_GRANT, "unknown", "other-or-unknown", "42501"),
            (0, True, DOCUMENTED_GRANT, "unknown", "other-or-unknown", "42501"),
            (3, False, DOCUMENTED_GRANT, "match", "role-membership-grant", "42501"),
            (3, True, DOCUMENTED_GRANT, "match", "role-membership-grant", "42501"),
            (3, False, PARAMETER_SQL, "unclassified", "parameter-grant", "42501"),
            (3, False, PARAMETER_SQL, "unknown", "other-or-unknown", "22021"),
        )
        for index, case in enumerate(cases):
            replay_exit, unavailable, sql, membership, grant_type, sqlstate = case
            with self.subTest(replay_exit=replay_exit, unavailable=unavailable,
                              grant_type=grant_type):
                root = self.root / f"replay-{index}"
                root.mkdir()
                verified = root / "restore-verified-sql"
                verified.mkdir()
                (verified / "roles.sql").write_bytes(sql + b"\n")
                (verified / "schema.sql").write_bytes(
                    (b"x" * 5000 + b"\n") if unavailable
                    else b"-- synthetic schema\n")
                summary = root / "summary.md"
                env = os.environ.copy()
                env.update({"RUNNER_TEMP": str(root),
                            "GITHUB_STEP_SUMMARY": str(summary),
                            "PSQL_IMAGE": "synthetic-image",
                            "REVIEW_SQLSTATE": sqlstate,
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
                self.assertNotIn("synthetic.setting", public)
                self.assertNotIn("synthetic_role", public)
                self.assertIn("counts=unavailable" if unavailable else
                              f"doc_grant={int(sql == DOCUMENTED_GRANT)}", public)
                self.assertIn("replay=failed" if replay_exit == 3 else
                              "replay=passed", public)
                self.assertEqual("Role-only SQL replay failed" in public,
                                 replay_exit == 3)
                expected = f"membership={membership} grant_type={grant_type}"
                if sqlstate == "22021":
                    expected = UNATTRIBUTED_FAILURE
                self.assertIn(expected, run.stdout.decode())
                self.assertIn(expected, summary.read_text())


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
                grant_type = "role-membership-grant" if shape == "match" else "other-or-unknown"
                self.assertEqual(
                    observed,
                    "replay=failed category=insufficient-privilege verb=grant "
                    f"doc_grant=false prefix_pass=true membership={shape} "
                    f"grant_type={grant_type}")
                for identifier in ("role_a", "role_b", "orders", "app", "dest"):
                    self.assertNotIn(identifier, observed)

    def test_grant_keyword_case_and_whitespace_do_not_mean_non_grant(self):
        cases = [
            (b'grant role_a TO role_b;\n', "grant", "unclassified"),
            (b'GrAnT role_a TO role_b;\n', "grant", "unclassified"),
            (b'GRANT\trole_a TO role_b;\n', "grant", "unclassified"),
            (b'GRANT\frole_a TO role_b;\n', "grant", "unclassified"),
            (b'GRANT\vrole_a TO role_b;\n', "grant", "unclassified"),
            (b'GRANT"role_a" TO role_b;\n', "grant", "unclassified"),
            (b'GrAnT"role_a" TO role_b;\n', "grant", "unclassified"),
            (b'GRANTED role_a TO role_b;\n', "other", "not-applicable"),
            (b'GRANTOR role_a TO role_b;\n', "other", "not-applicable"),
            (b'GRANT_role_a TO role_b;\n', "other", "not-applicable"),
            (b'GRANT$role_a TO role_b;\n', "other", "not-applicable"),
        ]
        for sql, verb, membership in cases:
            with self.subTest(sql=sql):
                self.put(sql)
                observed = result(ERROR1, self.roles, 3)
                self.assertIn(
                    f"verb={verb} doc_grant=false prefix_pass=true "
                    f"membership={membership}", observed)

    def test_parameter_grant_forms_are_classified_without_identifiers(self):
        cases = (
            PARAMETER_SQL,
            b'GRANT ALTER SYSTEM ON PARAMETER synthetic.setting TO CURRENT_ROLE;',
            b'GRANT ALL ON PARAMETER "synthetic.setting" TO PUBLIC;',
            b'GRANT ALL PRIVILEGES ON PARAMETER "synthetic" . "setting" '
            b'TO GROUP "synthetic_role" WITH GRANT OPTION;',
            b'grant set, alter system on parameter synthetic.setting, "synthetic.setting" '
            b'to session_user, "synthetic""role" with grant option granted by current_user;',
            b'\fGrAnT\vSeT ON PaRaMeTeR"synthetic.setting"TO"synthetic_role"'
            b'GRANTED BY"synthetic_grantor" ;\t',
        )
        for sql in cases:
            with self.subTest(sql=sql):
                self.put(sql + b"\n")
                self.assertEqual(
                    result(ERROR1, self.roles, 3),
                    "replay=failed category=insufficient-privilege verb=grant "
                    "doc_grant=false prefix_pass=true membership=unclassified "
                    "grant_type=parameter-grant")

    def test_parameter_grant_rejects_unsupported_and_malformed_syntax(self):
        cases = (
            b'GRANT SELECT ON PARAMETER x TO y;',
            b'GRANT ALL, SET ON PARAMETER x TO y;',
            b'GRANT SET ON TABLE x TO y;',
            b'GRANT SET ON PARAMETER x.,z TO y;',
            b'GRANT SET ON PARAMETER x, TO y;',
            b'GRANT SET ON PARAMETER SELECT TO y;',
            b'GRANT SET ON PARAMETER x.join TO y;',
            b'GRANT SET ON PARAMETER x TO WHERE;',
            b'GRANT SET ON PARAMETER x TO "";',
            b'GRANT SET ON PARAMETER "unclosed TO y;',
            b'GRANT SET ON PARAMETER x TO y,;',
            b'GRANT SET ON PARAMETER x TO y WITH ADMIN OPTION;',
            b'GRANT SET ON PARAMETER x TO PUBLIC WITH GRANT OPTION;',
            b'GRANT SET ON PARAMETER x TO y GRANTED BY PUBLIC;',
            b'GRANT SET ON PARAMETER x TO y GRANTED BY z WITH GRANT OPTION;',
            b'GRANT SET ON PARAMETER x TO y WITH GRANT OPTION GRANTED BY;',
            PARAMETER_SQL + b' -- trailing comment',
            PARAMETER_SQL + b' SELECT 1;',
            b'SELECT 1; ' + PARAMETER_SQL,
            b'\\echo ' + PARAMETER_SQL,
            b'GRANT SET ON /* unsupported comment */ PARAMETER x TO y;',
        )
        for sql in cases:
            with self.subTest(sql=sql):
                self.put(sql + b"\n")
                self.assertTrue(result(ERROR1, self.roles, 3).endswith(
                    "grant_type=other-or-unknown"))

    def test_group_accepts_rolespec_but_preserves_public_grant_option_guard(self):
        supported_roles = (
            b"PUBLIC", b"PuBLiC", b'"public"', b"Current_Role",
            b"CURRENT_USER", b"SESSION_USER", b"public_reader",
            b'"Public"', b'"PUBLIC"', b'"current_role"',
            b'"CURRENT_USER"', b'"session_user"', b'"public""team"',
        )
        for role in supported_roles:
            with self.subTest(role=role, grant_option=False):
                self.put(b"GRANT SET ON PARAMETER x TO GROUP " + role + b";\n")
                self.assertTrue(result(ERROR1, self.roles, 3).endswith(
                    "grant_type=parameter-grant"))

        for role in (b"PUBLIC", b"PuBLiC", b'"public"'):
            with self.subTest(role=role, grant_option=True):
                self.put(b"GRANT SET ON PARAMETER x TO GROUP " + role
                         + b" WITH GRANT OPTION;\n")
                self.assertTrue(result(ERROR1, self.roles, 3).endswith(
                    "grant_type=other-or-unknown"))

        for role in (b'"none"', b"WHERE", b"GROUP"):
            with self.subTest(role=role, malformed=True):
                self.put(b"GRANT SET ON PARAMETER x TO GROUP " + role + b";\n")
                self.assertTrue(result(ERROR1, self.roles, 3).endswith(
                    "grant_type=other-or-unknown"))

    def test_parameter_grant_public_role_is_case_sensitive_when_quoted(self):
        cases = (
            (b'TO PuBLiC', "parameter-grant"),
            (b'TO "public"', "parameter-grant"),
            (b'TO GROUP "public"', "parameter-grant"),
            (b'TO GROUP "Public" WITH GRANT OPTION', "parameter-grant"),
            (b'TO y, "public" GRANTED BY "Public"', "parameter-grant"),
            (b'TO "Public" WITH GRANT OPTION GRANTED BY "PUBLIC"', "parameter-grant"),
            (b'TO GROUP "PUBLIC" WITH GRANT OPTION', "parameter-grant"),
            (b'TO public_reader, "public,team" WITH GRANT OPTION', "parameter-grant"),
            (b'TO GROUP "public""team" WITH GRANT OPTION GRANTED BY "public""team"',
             "parameter-grant"),
            (b'TO "public" WITH GRANT OPTION', "other-or-unknown"),
            (b'TO GROUP "public" WITH GRANT OPTION', "other-or-unknown"),
            (b'TO GROUP PUBLIC, y WITH GRANT OPTION', "other-or-unknown"),
            (b'TO y, GROUP "public" WITH GRANT OPTION', "other-or-unknown"),
            (b'TO y, "public" WITH GRANT OPTION', "other-or-unknown"),
            (b'TO "public", y WITH GRANT OPTION', "other-or-unknown"),
            (b'TO "Public", PuBLiC WITH GRANT OPTION', "other-or-unknown"),
            (b'TO y GRANTED BY "public"', "other-or-unknown"),
            (b'TO "public" GRANTED BY PuBLiC', "other-or-unknown"),
        )
        for clause, grant_type in cases:
            with self.subTest(clause=clause):
                self.put(b"GRANT SET ON PARAMETER x " + clause + b";\n")
                self.assertEqual(
                    result(ERROR1, self.roles, 3),
                    "replay=failed category=insufficient-privilege verb=grant "
                    "doc_grant=false prefix_pass=true membership=unclassified "
                    f"grant_type={grant_type}")

    def test_grant_type_only_uses_the_attributed_line(self):
        cases = (
            (b"ALTER ROLE x SET statement_timeout TO '1s';\n" + PARAMETER_SQL, ERROR1),
            (b"GRANT SET ON\nPARAMETER x TO y;", ERROR2),
            (b"/* preceding ambiguous line */\n" + PARAMETER_SQL, ERROR2),
            (PARAMETER_SQL, ERROR1 + ERROR1),
            (PARAMETER_SQL, ERROR2),
            (PARAMETER_SQL, ERROR1.replace(b"roles.sql", b"schema.sql")),
            (PARAMETER_SQL + b"\x00", ERROR1),
        )
        for sql, stderr in cases:
            with self.subTest(sql=sql, stderr=stderr):
                self.put(sql + b"\n")
                self.assertTrue(result(stderr, self.roles, 3).endswith(
                    "grant_type=other-or-unknown"))
        self.put(b"-- complete line\n" + PARAMETER_SQL + b"\n")
        self.assertTrue(result(ERROR2, self.roles, 3).endswith("grant_type=parameter-grant"))

    def test_parameter_grant_obeys_the_existing_line_bound(self):
        prefix = b'GRANT SET ON PARAMETER x TO "'
        suffix = b'";'
        line = prefix + b"x" * (4096 - len(prefix) - len(suffix)) + suffix
        self.assertEqual(len(line), 4096)
        self.put(line + b"\n")
        self.assertTrue(result(ERROR1, self.roles, 3).endswith("grant_type=parameter-grant"))
        self.put(b" " + line + b"\n")
        self.assertTrue(result(ERROR1, self.roles, 3).endswith("grant_type=other-or-unknown"))

    def test_publish_accepts_noncanonical_grant_as_unclassified(self):
        from restore_role_probe import publish
        c, f, r, out = (self.root / name for name in
                        ("counts.out", "flags.out", "result.out", "summary.txt"))
        c.write_bytes(
            b"doc_grant=0 grantor_candidates=0 owner_table=0 owner_function=0 owner_other=0\n")
        f.write_bytes(b"0|1|1|1|1\n")
        r.write_bytes(
            b"replay=failed category=insufficient-privilege verb=grant "
            b"doc_grant=false prefix_pass=true membership=unclassified "
            b"grant_type=other-or-unknown\n")
        publish(c, f, r, 3, out)
        self.assertIn("membership=unclassified", out.read_text())

    def test_publish_rejects_contradictory_membership_labels(self):
        from restore_role_probe import publish
        c, f, r, out = (self.root / name for name in
                        ("counts.out", "flags.out", "result.out", "summary.txt"))
        c.write_bytes(
            b"doc_grant=0 grantor_candidates=0 owner_table=0 owner_function=0 owner_other=0\n")
        f.write_bytes(b"0|1|1|1|1\n")
        invalid = [
            (3, b"replay=failed category=insufficient-privilege verb=grant "
             b"doc_grant=true prefix_pass=true membership=unclassified "
             b"grant_type=other-or-unknown\n"),
            (3, b"replay=failed category=insufficient-privilege verb=grant "
             b"doc_grant=unknown prefix_pass=true membership=match "
             b"grant_type=role-membership-grant\n"),
            (3, b"replay=failed category=insufficient-privilege verb=grant "
             b"doc_grant=false prefix_pass=true membership=not-applicable "
             b"grant_type=other-or-unknown\n"),
            (3, b"replay=failed category=insufficient-privilege verb=alter-role "
             b"doc_grant=false prefix_pass=true membership=match "
             b"grant_type=role-membership-grant\n"),
            (3, b"replay=failed category=unknown verb=unknown "
             b"doc_grant=unknown prefix_pass=false membership=match "
             b"grant_type=role-membership-grant\n"),
            (0, b"replay=passed category=unknown verb=unknown "
             b"doc_grant=unknown prefix_pass=unknown membership=match "
             b"grant_type=role-membership-grant\n"),
        ]
        from contextlib import redirect_stdout
        from io import StringIO
        for rc, record in invalid:
            with self.subTest(rc=rc, record=record):
                r.write_bytes(record)
                stdout = StringIO()
                with redirect_stdout(stdout), self.assertRaises(ValueError):
                    publish(c, f, r, rc, out)
                self.assertEqual(stdout.getvalue(), "")
                self.assertFalse(out.exists())

    def test_publish_binds_grant_type_to_the_replay_and_attribution(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from restore_role_probe import publish

        c, f, r, out = (self.root / name for name in
                        ("counts.out", "flags.out", "result.out", "summary.txt"))
        c.write_bytes(b"counts=unavailable\n")
        f.write_bytes(b"0|1|1|1|1\n")
        self.put(PARAMETER_SQL + b"\n")
        parameter = result(ERROR1, self.roles, 3).encode("ascii") + b"\n"
        r.write_bytes(parameter)
        stdout = StringIO()
        with redirect_stdout(stdout):
            publish(c, f, r, 3, out)
        self.assertIn("grant_type=parameter-grant", stdout.getvalue())
        self.assertIn("grant_type=parameter-grant", out.read_text())
        for private_value in ("synthetic.setting", "synthetic_role"):
            self.assertNotIn(private_value, stdout.getvalue() + out.read_text())
        summary = out.read_bytes()

        self.put(DOCUMENTED_GRANT + b"\n")
        membership = result(ERROR1, self.roles, 3).encode("ascii") + b"\n"
        success = result(b"", self.roles, 0).encode("ascii") + b"\n"
        no_attribution = result(ERROR2, self.roles, 3).encode("ascii") + b"\n"
        self.put(b"CREATE ROLE example;\n")
        non_grant = result(ERROR1, self.roles, 3).encode("ascii") + b"\n"
        rejected = (
            (3, parameter.replace(b"parameter-grant", b"role-membership-grant")),
            (3, membership.replace(b"role-membership-grant", b"parameter-grant")),
            (3, membership.replace(b"role-membership-grant", b"other-or-unknown")),
            (3, no_attribution.replace(b"other-or-unknown", b"parameter-grant")),
            (3, non_grant.replace(b"other-or-unknown", b"parameter-grant")),
            (0, success.replace(b"other-or-unknown", b"parameter-grant")),
            (0, parameter),
            (3, parameter.replace(b"parameter-grant", b"synthetic.setting")),
            (3, parameter.replace(b" grant_type=parameter-grant", b"")),
            (3, parameter + b"\x00"),
            (3, parameter + b"\n"),
        )
        for rc, record in rejected:
            with self.subTest(rc=rc, record=record):
                r.write_bytes(record)
                stdout = StringIO()
                with redirect_stdout(stdout), self.assertRaises(ValueError):
                    publish(c, f, r, rc, out)
                self.assertEqual(stdout.getvalue(), "")
                self.assertEqual(out.read_bytes(), summary)

    def test_publish_only_accepts_unattributed_failure_for_unknown_category(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from restore_role_probe import publish

        c, f, r, out = (self.root / name for name in
                        ("counts.out", "flags.out", "result.out", "summary.txt"))
        c.write_bytes(b"counts=unavailable\n")
        f.write_bytes(b"0|1|1|1|1\n")
        unknown = UNATTRIBUTED_FAILURE.encode("ascii") + b"\n"
        r.write_bytes(unknown)
        stdout = StringIO()
        with redirect_stdout(stdout):
            publish(c, f, r, 3, out)
        self.assertIn(UNATTRIBUTED_FAILURE, stdout.getvalue())
        self.assertIn(UNATTRIBUTED_FAILURE, out.read_text())
        summary = out.read_bytes()

        rejected = [unknown.replace(b"prefix_pass=unknown", b"prefix_pass=false"),
                    unknown.replace(b"grant_type=other-or-unknown", b"grant_type=private.sql")]
        for sql in (PARAMETER_SQL, DOCUMENTED_GRANT, b"CREATE ROLE example;"):
            self.put(sql + b"\n")
            record = result(ERROR1, self.roles, 3).encode("ascii") + b"\n"
            rejected.append(record.replace(b"category=insufficient-privilege", b"category=unknown"))
        for record in rejected:
            with self.subTest(record=record):
                r.write_bytes(record)
                stdout = StringIO()
                with redirect_stdout(stdout), self.assertRaises(ValueError):
                    publish(c, f, r, 3, out)
                self.assertEqual(stdout.getvalue(), "")
                self.assertEqual(out.read_bytes(), summary)



if __name__ == "__main__":
    unittest.main()
