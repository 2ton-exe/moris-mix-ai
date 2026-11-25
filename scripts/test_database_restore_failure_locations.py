"""Synthetic Stage B failure-location oracles for issue #276."""

from contextlib import redirect_stdout
from io import StringIO
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


# Each fragment is controlled test data. Line ranges are computed from the
# known fixture layout instead of trying to recognize SQL from a restore dump.
DECOYS = """\
-- COPY ignored_comment (payload) FROM stdin;
/*
SELECT pg_catalog.setval('ignored_comment', 1, true);
*/
SELECT 'COPY ignored_string (payload) FROM stdin;';
SELECT $decoy$
COPY ignored_dollar_string (payload) FROM stdin;
SELECT pg_catalog.setval('ignored_dollar_string', 1, true);
$decoy$;
COPY phase276.copy_target (payload) FROM stdin;
COPY ignored_copy_row (payload) FROM stdin;
SELECT pg_catalog.setval('ignored_copy_row', 1, true);
psql:/backup/data.sql:1: ERROR:  42P01
\\.
"""

PREFIX = DECOYS + """\
INSERT INTO phase276_baseline.rows VALUES (1);
SELECT 'SYNTHETIC_276_PRIVATE_REACHED';
"""


def bash_path(path):
    """Return a temporary path in the namespace used by Windows Bash."""
    resolved = Path(path).resolve()
    if os.name != "nt":
        return resolved.as_posix()
    drive = resolved.drive[:1].lower()
    tail = resolved.as_posix()[2:]
    bash_exe = (shutil.which("bash") or "").replace("\\", "/").lower()
    mount = "/mnt" if "/windowsapps/" in bash_exe else ""
    return f"{mount}/{drive}{tail}"

ROW_COPY = "COPY phase276.copy_target (payload) FROM stdin;\n"
CASES = {
    "missing-copy-target": (
        "COPY phase276.missing_target (payload) FROM stdin;\nsynthetic\n\\.\n",
        "copy-header",
    ),
    "copy-header-expression": (
        "COPY phase276.copy_target (payload) FROM stdin WHERE missing_alias.payload IS NULL;\n"
        "synthetic\n\\.\n",
        "copy-header",
    ),
    "row-dependency-short": (ROW_COPY + "synthetic\nfail-row\n\\.\n", "copy-body"),
    # Give the client multiple input buffers after the failing row. The emitted
    # position may depend on when the client observes the server's failure.
    "row-dependency-streamed": (
        ROW_COPY + "fail-row\n" + ("synthetic-" + "x" * 1024 + "\n") * 256 + "\\.\n",
        "copy-body",
    ),
    "missing-sequence": (
        "SELECT pg_catalog.setval('phase276_baseline.seq', 23, true);\n"
        "SELECT pg_catalog.setval('phase276.transient_seq', 29, true);\n"
        "SELECT pg_catalog.setval(\n"
        "    'phase276.missing_seq', 31, true);\n",
        "statement-end",
    ),
    "unsupported-sql": (
        "SELECT payload\nFROM phase276.missing_other;\n",
        "statement-end",
    ),
    "ambiguous-record": (
        "\\warn 'psql:/backup/data.sql:1: ERROR:  42P01'\n"
        "SELECT payload FROM phase276.missing_other;\n",
        "ambiguous",
    ),
}
SUFFIX = "SELECT 'SYNTHETIC_276_PRIVATE_UNREACHED';\n"
ERROR_RECORD = re.compile(rb"psql:/backup/data\.sql:([1-9][0-9]{0,8}): ERROR:  42P01\n")
PUBLIC_PREFIX = b"".join(
    f"Restore diagnostic: phase={phase} status=passed\n".encode("ascii")
    for phase in ("client", "files", "connection")
)


def observed_location(case, stderr, *, prefix=PREFIX):
    """Check a diagnostic against one known fixture layout."""
    sql, expected = CASES[case]
    first = prefix.count("\n") + 1
    last = first + sql.count("\n") - 1
    if expected == "ambiguous":
        records = (
            "psql:/backup/data.sql:1: ERROR:  42P01\n"
            f"psql:/backup/data.sql:{last}: ERROR:  42P01\n"
        )
        return "ambiguous" if stderr == records.encode("ascii") else None

    match = ERROR_RECORD.fullmatch(stderr)
    if match is None:
        return None
    line = int(match[1])
    if expected == "copy-header" and line == first:
        return "copy-header"
    if expected == "copy-body":
        if first < line < last:
            return "copy-data"
        if line == last:
            return "copy-terminator"
    if expected == "statement-end" and line == last:
        return "statement-end"
    return None


def check_replay(case, root):
    raw = (root / "private-restore-stderr.log").read_bytes()
    location = observed_location(case, raw)
    if location is None:
        raise SystemExit(f"Synthetic 42P01 case {case}: unexpected private record or location")

    stdout = (root / "private-restore-result.log").read_bytes().split()
    if b"SYNTHETIC_276_PRIVATE_REACHED" not in stdout or b"SYNTHETIC_276_PRIVATE_UNREACHED" in stdout:
        raise SystemExit(f"Synthetic 42P01 case {case}: unexpected execution boundary")

    check_public_output(case, root, location)
    print(f"Synthetic 42P01 case {case}: location={location} exit=3 public-output=pass")


def check_public_output(case, root, location):
    component, category = ("unknown", "unknown") if location == "ambiguous" else ("data.sql", "undefined-table")
    expected = PUBLIC_PREFIX + (
        f"::error::Restore diagnostic: phase=restore category=sql-script exit_code=3 "
        f"component_hint={component} untrusted_error_category_hint={category} "
        "untrusted_statement_class_hint=unknown; private output suppressed\n"
    ).encode("ascii")
    if (root / "step.out").read_bytes() != expected or (root / "step.err").read_bytes():
        raise SystemExit(f"Synthetic 42P01 case {case}: public output differed from the fixed allowlist")

class FailureLocationOracleTests(unittest.TestCase):
    def test_copy_data_and_terminator_are_both_in_the_row_failure_region(self):
        first = PREFIX.count("\n") + 1
        case = "row-dependency-short"
        for line, expected in ((first, None), (first + 1, "copy-data"),
                               (first + 3, "copy-terminator"), (first + 4, None)):
            with self.subTest(line=line):
                record = f"psql:/backup/data.sql:{line}: ERROR:  42P01\n".encode("ascii")
                self.assertEqual(observed_location(case, record), expected)

    def test_rejects_malformed_or_ambiguous_records(self):
        first = PREFIX.count("\n") + 1
        good = f"psql:/backup/data.sql:{first}: ERROR:  42P01\n".encode("ascii")
        self.assertEqual(observed_location("missing-copy-target", good), "copy-header")
        for record in (
            b"",
            good + good,
            b"private-payload\n" + good,
            good.replace(b": ERROR:", b": NOTICE:"),
            good.replace(b"42P01\n", b"42P01 private-payload\n"),
            good.replace(b"data.sql", b"schema.sql"),
            good.replace(str(first).encode("ascii"), b"0"),
            good.replace(str(first).encode("ascii"), b"999999999999999999999"),
        ):
            self.assertIsNone(observed_location("missing-copy-target", record))

    def test_replay_assertion_rejects_private_output_on_either_public_stream(self):
        case = "missing-copy-target"
        line = PREFIX.count("\n") + 1
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "private-restore-stderr.log").write_bytes(
                f"psql:/backup/data.sql:{line}: ERROR:  42P01\n".encode("ascii")
            )
            (root / "private-restore-result.log").write_bytes(b" SYNTHETIC_276_PRIVATE_REACHED \n")
            safe = PUBLIC_PREFIX + (
                b"::error::Restore diagnostic: phase=restore category=sql-script exit_code=3 "
                b"component_hint=data.sql untrusted_error_category_hint=undefined-table "
                b"untrusted_statement_class_hint=unknown; private output suppressed\n"
            )
            public_streams = {root / "step.out": safe, root / "step.err": b""}
            for path, payload in public_streams.items():
                path.write_bytes(payload)
            with redirect_stdout(StringIO()) as output:
                check_replay(case, root)
            self.assertEqual(output.getvalue(), (
                "Synthetic 42P01 case missing-copy-target: location=copy-header exit=3 public-output=pass\n"
            ))
            for path, payload in public_streams.items():
                with self.subTest(stream=path.name):
                    path.write_bytes(payload + b"SYNTHETIC_276_PRIVATE_REACHED\n")
                    with self.assertRaisesRegex(SystemExit, "public output differed"):
                        check_replay(case, root)
                    path.write_bytes(payload)

    def test_cleanup_preserves_failure_when_shutdown_passes_or_fails(self):
        for stop_status in (0, 72):
            with self.subTest(stop_status=stop_status), tempfile.TemporaryDirectory() as tmp:
                run = subprocess.run(
                    ["bash", "-c", r"""
supabase() {
  case "$1" in
    init)
      mkdir -p "$3/supabase"
      printf 'project_id = "supabase"\n[db]\nmajor_version = 15\n' > "$3/supabase/config.toml"
      return 0
      ;;
    stop)
      touch "$SYNTHETIC_TEST_LOG_DIR/stop-called"
      return "$SYNTHETIC_STOP_STATUS"
  esac
  [[ "$1" == --debug ]] || return 98
  shift
  if [[ "$1" == db ]]; then
    printf 'Image pull progress for synthetic project\n'
    return 73
  fi
  return 99
}
export -f supabase
docker() {
  if [[ "$1" == ps && "$2" == -aq ]]; then return 0; fi
  if [[ "$1" == volume && "$2" == ls ]]; then return 0; fi
  if [[ "$1" == network && "$2" == ls ]]; then
    if [[ " $* " == *" -q "* ]]; then return 0; fi
    if [[ -e "$RUNNER_TEMP/network-created" ]]; then
      printf '%s\n' 'restore-synthetic-test'
    fi
    return 0
  fi
  if [[ "$1" == network && "$2" == inspect ]]; then
    if [[ ! -e "$RUNNER_TEMP/network-created" ]]; then return 1; fi
    if [[ "$#" == 3 ]]; then return 0; fi
    printf 'bridge|true|false|mori276-synthetic|mori276-synthetic\n'
    return 0
  fi
  if [[ "$1" == network && "$2" == create ]]; then
    touch "$RUNNER_TEMP/network-created"
    return 0
  fi
  if [[ "$1" == network && "$2" == rm ]]; then
    rm -f "$RUNNER_TEMP/network-created"
    return 0
  fi
  return 99
}
export -f docker
bash scripts/test_database_restore_synthetic.sh
"""],
                    cwd=Path(__file__).resolve().parents[1],
                    env={**os.environ, "RUNNER_TEMP": bash_path(tmp),
                         "PSQL_IMAGE": "unused-offline", "SYNTHETIC_STOP_STATUS": str(stop_status),
                         "RESTORE_PROJECT_ID": "mori276-synthetic",
                         "RESTORE_DOCKER_NETWORK": "restore-synthetic-test",
                         "SYNTHETIC_TEST_LOG_DIR": bash_path(tmp)},
                    capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(run.returncode, 73, f"stdout={run.stdout!r}; stderr={run.stderr!r}")
                self.assertEqual(run.stderr, "")
                shutdown = ("synthetic-database-shutdown=pass" if stop_status == 0 else
                            "::warning::Disposable Supabase shutdown failed; runner teardown will recycle it.")
                self.assertEqual(run.stdout.splitlines(), [
                    "Synthetic startup failure stage: database-start",
                    "synthetic-startup-probe container=unknown state=unknown pg_ready=unverified",
                    "::error::Synthetic protected target setup failed; class=database-start-other", shutdown,
                    "synthetic-project-cleanup=pass", "restore-runner-bootstrap-ingress-cleanup=pass",
                    "synthetic-network-cleanup=pass",
                    "synthetic-fixture-cleanup=pass"
                ])
                self.assertEqual({p.name for p in Path(tmp).iterdir()}, {"stop-called"})


if __name__ == "__main__":
    action, case, directory = sys.argv[1:]
    root = Path(directory)
    if action == "write":
        (root / "restore-verified-sql" / "data.sql").write_text(
            PREFIX + CASES[case][0] + SUFFIX, encoding="ascii", newline="\n",
        )
    elif action == "check":
        check_replay(case, root)
    else:
        raise SystemExit("Expected write or check")
