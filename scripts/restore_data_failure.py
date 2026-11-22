"""Bounded attribution for an untrusted PostgreSQL 17 data.sql error.

Only a plain pg_dump data prefix is supported. The public CLI emits a location
label. Candidate names stay in process and are used only for a disposable
catalog probe. Neither the reported position nor the probe proves a root cause.
"""

from dataclasses import dataclass, field
from pathlib import Path
import re
import sys

from classify_restore_component import MAX_LOG_BYTES, _accepted_error


MAX_DATA_BYTES = 64 * 1024 * 1024
MAX_DATA_LINES = 1_000_000
MAX_PHYSICAL_LINE = 1024 * 1024
MAX_STATEMENT_BYTES = 4096
MAX_SETVAL_LINES = 8

# Portable ASCII subset. Reject backslash escapes and identifiers PostgreSQL
# would truncate. A quoted name may contain dots, spaces, and doubled quotes.
IDENT = rb"""(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"\x00-\x1f\x7f-\xff\\]|"")+")"""
QUALIFIED = re.compile(rb"(" + IDENT + rb")\.(" + IDENT + rb")")
COPY = re.compile(
    rb"COPY (" + QUALIFIED.pattern + rb") \(" + IDENT
    + rb"(?:, " + IDENT + rb")*\) FROM stdin;"
)
SETVAL_START = b"SELECT pg_catalog.setval("
SETVAL = re.compile(
    rb"SELECT pg_catalog\.setval\([ \t\n]*'((?:[^'\x00-\x1f\x7f-\xff\\]|'')+)'"
    rb"[ \t\n]*,[ \t\n]*-?[0-9]{1,19}[ \t\n]*,[ \t\n]*(?:true|false)"
    rb"[ \t\n]*\);"
)
RESTRICT = re.compile(rb"\\restrict [A-Za-z0-9]+")
DUMP_SETTINGS = {
    b"SET statement_timeout = 0;",
    b"SET lock_timeout = 0;",
    b"SET idle_in_transaction_session_timeout = 0;",
    b"SET transaction_timeout = 0;",
    b"SET client_encoding = 'UTF8';",
    b"SET standard_conforming_strings = on;",
    b"SELECT pg_catalog.set_config('search_path', '', false);",
    b"SET check_function_bodies = false;",
    b"SET xmloption = content;",
    b"SET client_min_messages = warning;",
    b"SET row_security = off;",
}


@dataclass(frozen=True)
class Attribution:
    location: str
    relation: tuple[bytes, bytes] = field(repr=False)
    statement_lines: tuple[int, int] = field(repr=False)
    reported_line: int = field(repr=False)


def _relation(qualified: bytes) -> tuple[bytes, bytes] | None:
    match = QUALIFIED.fullmatch(qualified)
    if match is None:
        return None
    schema, name = (
        token[1:-1].replace(b'""', b'"') if token.startswith(b'"') else token.lower()
        for token in match.groups()
    )
    if not (1 <= len(schema) <= 63 and 1 <= len(name) <= 63):
        return None
    return schema, name


def _bounded_lines(source):
    remaining = MAX_DATA_BYTES
    for number in range(1, MAX_DATA_LINES + 1):
        limit = min(remaining, MAX_PHYSICAL_LINE)
        raw = source.readline(limit + 1)
        if not raw:
            return
        if len(raw) > limit or not raw.endswith(b"\n"):
            raise ValueError
        remaining -= len(raw)
        line = raw[:-1].removesuffix(b"\r")
        if b"\r" in line or b"\0" in line:
            raise ValueError
        yield number, line


def _copy_end(lines):
    # Text COPY treats only the whole physical terminator line as the boundary.
    for number, line in lines:
        if line == b"\\.":
            return number
    return None


def _setval(lines, number, line):
    statement = line
    for offset in range(MAX_SETVAL_LINES):
        if len(statement) > MAX_STATEMENT_BYTES:
            break
        match = SETVAL.fullmatch(statement)
        if match is not None:
            return number, _relation(match[1].replace(b"''", b"'"))
        if offset + 1 == MAX_SETVAL_LINES or statement.endswith(b";"):
            break
        following = next(lines, None)
        if following is None or len(following[1]) > MAX_STATEMENT_BYTES:
            break
        number, line = following
        statement += b"\n" + line
    return None, None


def _locate(lines, failure_line: int) -> Attribution | None:
    restricted = data_started = False
    for number, line in lines:
        if number > failure_line:
            break
        if not line.strip(b" \t") or line.lstrip(b" \t").startswith(b"--"):
            continue
        if len(line) > MAX_STATEMENT_BYTES:
            break
        if not data_started and not restricted and RESTRICT.fullmatch(line):
            restricted = True
            continue
        if not data_started and line in DUMP_SETTINGS:
            continue
        data_started = True

        copy = COPY.fullmatch(line)
        if copy is not None:
            relation = _relation(copy[1])
            if relation is None:
                break
            end = _copy_end(lines)
            if end is None:
                break
            if failure_line == number:
                return Attribution("copy-header", relation, (number, number), failure_line)
            if number < failure_line <= end:
                return Attribution("copy-stream-or-terminator", relation, (number, number), failure_line)
        elif line.startswith(SETVAL_START):
            end, relation = _setval(lines, number, line)
            if end is None or relation is None or end > failure_line:
                break
            if end == failure_line:
                return Attribution("sequence-setval", relation, (number, end), failure_line)
        else:
            break
    return None


def attribution_from_files(stderr_path: Path, exit_code: int, data_sql: Path) -> Attribution | None:
    if exit_code != 3:
        return None
    try:
        with stderr_path.open("rb") as source:
            error = _accepted_error(source.read(MAX_LOG_BYTES + 1), exit_code)
        if (error is None or error.component != "data.sql" or error.sqlstate != b"42P01"
                or error.severity != b"ERROR" or error.has_other_messages
                or error.line_number > MAX_DATA_LINES):
            return None
        with data_sql.open("rb") as source:
            return _locate(_bounded_lines(source), error.line_number)
    except (OSError, ValueError):
        return None


def private_catalog_sql(attribution: Attribution) -> str:
    """Probe one candidate on an isolated reconstruction. Keep SQL private.

    Names are encoded as ASCII hex data, never interpolated as SQL identifiers.
    The caller must use a disposable target after replaying the schema prefix
    and must check for exactly one fixed result. Presence proves catalog state
    in that reconstruction, not the cause of the original failure.
    """
    schema, name = (value.hex() for value in attribution.relation)
    expected_kinds = "'S'" if attribution.location == "sequence-setval" else "'r', 'p', 'f', 'v'"
    return f"""SELECT COALESCE((
    SELECT CASE WHEN c.relkind IN ({expected_kinds}) THEN 'candidate-present'
                ELSE 'candidate-other-kind' END
    FROM pg_catalog.pg_namespace AS n
    JOIN pg_catalog.pg_class AS c ON c.relnamespace = n.oid
    WHERE n.nspname = pg_catalog.convert_from(pg_catalog.decode('{schema}', 'hex'), 'UTF8')::pg_catalog.name COLLATE pg_catalog."C"
      AND c.relname = pg_catalog.convert_from(pg_catalog.decode('{name}', 'hex'), 'UTF8')::pg_catalog.name COLLATE pg_catalog."C"
), 'candidate-absent');
"""


def main() -> None:
    result = None
    if len(sys.argv) == 4 and sys.argv[2] == "3":
        result = attribution_from_files(Path(sys.argv[1]), 3, Path(sys.argv[3]))
    print(result.location if result else "unknown")


if __name__ == "__main__":
    main()
