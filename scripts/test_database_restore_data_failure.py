"""Phase 1B offline tests and fixture adapter for the pinned synthetic replay."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import restore_data_failure as diagnostic
from test_database_restore_failure_locations import CASES, SUFFIX, check_public_output, observed_location


CANONICAL_PREFIX = """\
-- COPY ignored_comment (payload) FROM stdin;
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
COPY phase276.copy_target (payload) FROM stdin;
COPY ignored_copy_row (payload) FROM stdin;
SELECT pg_catalog.setval('ignored_copy_row', 1, true);
psql:/backup/data.sql:1: ERROR:  42P01
\\.
COPY phase276_baseline.rows (id) FROM stdin;
1
\\.
"""
PHASE_1B_EXPECTATIONS = {
    "missing-copy-target": ("copy-header", "candidate-absent"),
    "copy-header-expression": ("unknown", "not-probed"),
    "row-dependency-short": ("copy-stream-or-terminator", "candidate-present"),
    "row-dependency-streamed": ("copy-stream-or-terminator", "candidate-present"),
    "missing-sequence": ("sequence-setval", "candidate-absent"),
    "unsupported-sql": ("unknown", "not-probed"),
    "ambiguous-record": ("unknown", "not-probed"),
}


def record(line):
    return f"psql:/backup/data.sql:{line}: ERROR:  42P01\n".encode("ascii")


class DataFailureTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.stderr = Path(temp.name) / "stderr"
        self.sql = Path(temp.name) / "data.sql"

    def locate(self, sql, line):
        self.sql.write_bytes(sql)
        self.stderr.write_bytes(record(line))
        return diagnostic.attribution_from_files(self.stderr, 3, self.sql)

    def test_quoted_copy_and_stream_boundaries(self):
        sql = (b'-- COPY decoy.bad (id) FROM stdin;\n'
               b'COPY "Secret.Schema"."Name""With Dot" (id) FROM stdin;\n'
               b'COPY unrelated.row (id) FROM stdin;\n'
               b'\\\\.\n'
               b'\\.\n')
        name = (b'Secret.Schema', b'Name"With Dot')
        self.assertEqual(self.locate(sql, 2), diagnostic.Attribution("copy-header", name, (2, 2), 2))
        for line in (3, 4, 5):
            expected = diagnostic.Attribution("copy-stream-or-terminator", name, (2, 2), line)
            self.assertEqual(self.locate(sql, line), expected)
        self.assertIsNone(self.locate(sql, 1))
        self.assertIsNone(self.locate(sql, 6))
        self.assertIsNone(self.locate(sql[:-3], 3))

    def test_qualified_multiline_setval_after_copy(self):
        sql = (b'\\restrict SyntheticDumpGuard\nSET standard_conforming_strings = on;\n'
               b'COPY public.first (id) FROM stdin;\n1\n\\.\n'
               b"SELECT pg_catalog.setval(\n 'Example.\"Secret''Sequence\"',\n -30, false\n);\n")
        self.assertEqual(self.locate(sql, 9),
                         diagnostic.Attribution("sequence-setval", (b'example', b"Secret'Sequence"), (6, 9), 9))
        self.assertIsNone(self.locate(sql, 7))
        self.assertIsNone(self.locate(sql, 8))

    def test_reject_unsupported_syntax_and_prefix_decoys(self):
        copy = b"COPY public.target (id) FROM stdin;\n1\n\\.\n"
        for sql, line in (
            (b"/*\n" + copy + b"*/\n", 2),
            (b"SELECT 'decoy\n" + copy + b"';\n", 2),
            (b"SELECT $tag$\n" + copy + b"$tag$;\n", 2),
            (b"\\warn 'synthetic'\n" + copy, 2),
            (b"SET standard_conforming_strings = off;\n" + copy, 2),
            (b"SET search_path TO public;\n" + copy, 2),
            (b"COPY public.target (id) FROM stdin WHERE bad.id IS NULL;\n1\n\\.\n", 1),
            (b"COPY target (id) FROM stdin;\n1\n\\.\n", 1),
            (b"COPY public.target (id) FROM stdin WITH (FORMAT csv);\n1\n\\.\n", 2),
            (b"COPY public." + b"x" * 64 + b" (id) FROM stdin;\n1\n\\.\n", 1),
            (b"COPY public.target (id) FROM\nstdin;\n1\n\\.\n", 2),
            (b"SELECT pg_catalog.setval('unqualified', 23, true);\n", 1),
            (b"SELECT pg_catalog.setval(E'public.seq', 23, true);\n", 1),
            (b"SELECT pg_catalog.setval('public.seq'::regclass, 23, true);\n", 1),
            (b"SELECT pg_catalog.setval('public.seq', 23, true); SELECT 1;\n", 1),
            (b"SELECT pg_catalog.setval(\n" + b"\n" * 7 + b"'public.seq', 23, true);\n", 9),
        ):
            with self.subTest(line=line, synthetic_sql=sql):
                self.assertIsNone(self.locate(sql, line))

    def test_reject_ambiguous_or_malformed_framing_before_opening_sql(self):
        real = record(1)
        for stderr in (b"", real + real, real[:-1], real.replace(b"42P01", b"42P10"),
                       real.replace(b"ERROR", b"FATAL"), real.replace(b"data.sql", b"schema.sql"),
                       real.replace(b"backup", b"other"), real.replace(b":1:", b":0:"),
                       real.replace(b":1:", b":1000001:"), real + b"synthetic-payload\n",
                       real + b"psql:/backup/data.sql:1: INFO:  00000\n",
                       b"x" * (diagnostic.MAX_LOG_BYTES + 1)):
            self.stderr.write_bytes(stderr)
            with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
                self.assertIsNone(diagnostic.attribution_from_files(self.stderr, 3, self.sql))
                opened.assert_called_once_with(self.stderr, "rb")
        with patch.object(Path, "open") as opened:
            self.assertIsNone(diagnostic.attribution_from_files(self.stderr, 2, self.sql))
            opened.assert_not_called()

    def test_notice_and_crlf_data_are_supported_but_not_nul_or_truncation(self):
        self.sql.write_bytes(b"COPY public.test (id) FROM stdin;\r\n1\r\n\\.\r\n")
        self.stderr.write_bytes(b"psql:/backup/data.sql:1: NOTICE:  00000\n" + record(3))
        expected = diagnostic.Attribution("copy-stream-or-terminator", (b"public", b"test"), (1, 1), 3)
        self.assertEqual(diagnostic.attribution_from_files(self.stderr, 3, self.sql), expected)
        for sql in (b"COPY public.test (id) FROM stdin;\n1\n\\.",
                    b"COPY public.test (id) FROM stdin;\n1\0\n\\.\n"):
            self.assertIsNone(self.locate(sql, 2))

    def test_bounded_lookahead_rejects_copy_without_confirmed_terminator(self):
        header = b"COPY public.test (id) FROM stdin;\n"
        sql = header + b"1" * len(header) + b"\n\\.\n"
        for key, limit in (("MAX_DATA_BYTES", len(sql) - 1), ("MAX_PHYSICAL_LINE", len(header)),
                           ("MAX_DATA_LINES", 2)):
            with self.subTest(bound=key), patch.object(diagnostic, key, limit):
                self.assertIsNone(self.locate(sql, 1))

    def test_catalog_sql_encodes_one_candidate_as_data(self):
        name = (b"SELECT; --", b"'unexpected\"name")
        attributed = diagnostic.Attribution("sequence-setval", name, (1, 4), 4)
        sql = diagnostic.private_catalog_sql(attributed)
        self.assertNotIn(name[0].decode(), sql)
        self.assertNotIn(name[1].decode(), sql)
        for item in name:
            self.assertIn(f"decode('{item.hex()}', 'hex')", sql)
        self.assertIn("c.relkind IN ('S')", sql)
        self.assertIn("candidate-other-kind", sql)
        self.assertNotIn(name[0].decode(), repr(attributed))

    def test_all_live_fixture_layouts_match_the_helper(self):
        self.assertEqual(set(CASES), set(PHASE_1B_EXPECTATIONS))
        first = CANONICAL_PREFIX.count("\n") + 1
        for case, (sql, boundary) in CASES.items():
            with self.subTest(case=case):
                last = first + sql.count("\n") - 1
                error_line = first if boundary == "copy-header" else last
                self.sql.write_bytes((CANONICAL_PREFIX + sql + SUFFIX).encode("ascii"))
                stderr = (record(1) if boundary == "ambiguous" else b"") + record(error_line)
                self.stderr.write_bytes(stderr)
                self.assertIsNotNone(observed_location(case, stderr, prefix=CANONICAL_PREFIX))
                result = diagnostic.attribution_from_files(self.stderr, 3, self.sql)
                self.assertEqual(
                    result.location if result else "unknown", PHASE_1B_EXPECTATIONS[case][0],
                )

    def test_cli_prints_only_the_fixed_location_or_unknown(self):
        self.locate(b'COPY "Private"."Synthetic Name" (id) FROM stdin;\nsecret\n\\.\n', 3)
        args = [sys.executable, diagnostic.__file__, str(self.stderr), "3", str(self.sql)]
        run = subprocess.run(args, capture_output=True, text=True, check=True)
        self.assertEqual((run.stdout, run.stderr), ("copy-stream-or-terminator\n", ""))
        self.stderr.write_bytes(record(3) + b"private sentinel\n")
        run = subprocess.run(args, capture_output=True, text=True, check=True)
        self.assertEqual((run.stdout, run.stderr), ("unknown\n", ""))


def synthetic_fixture(action: str, case: str, root: Path) -> None:
    fixture = root / "restore-verified-sql"
    data = fixture / "data.sql"
    if action == "write":
        data.write_text(CANONICAL_PREFIX + CASES[case][0] + SUFFIX, encoding="ascii", newline="\n")
        return
    if action != "check":
        raise SystemExit("Unknown synthetic fixture action")

    stderr = root / "private-restore-stderr.log"
    observed = observed_location(case, stderr.read_bytes(), prefix=CANONICAL_PREFIX)
    if observed is None:
        raise SystemExit("Synthetic Phase 1B failure was outside its intended boundary")
    check_public_output(case, root, observed)
    expected_location, expected_catalog = PHASE_1B_EXPECTATIONS[case]
    attribution = diagnostic.attribution_from_files(stderr, 3, data)
    location = attribution.location if attribution else "unknown"
    if location != expected_location:
        raise SystemExit("Synthetic Phase 1B attribution returned the wrong label")
    if attribution:
        with (fixture / "phase276-catalog.sql").open("x", encoding="ascii", newline="\n") as query:
            query.write(diagnostic.private_catalog_sql(attribution))
    print(expected_catalog)


if __name__ == "__main__":
    action, case, directory = sys.argv[1:]
    synthetic_fixture(action, case, Path(directory))
