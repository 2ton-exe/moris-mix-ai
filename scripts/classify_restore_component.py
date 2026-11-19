"""Return a bounded, untrusted psql component hint; never reproduce log text.

Only SQLSTATE-only stderr from the pinned client is supported. Text records do
not authenticate their source: perfectly forged records remain indistinguishable
from genuine ones. This hint must never authorize a correction or a retry.
"""

from pathlib import Path
import re
import sys

MAX_LOG_BYTES = 64 * 1024
MAX_LINE_BYTES = 512
MAX_ROLE_SQL_BYTES = 32 * 1024 * 1024
MAX_ROLE_LINE_BYTES = 4096
MAX_ROLE_SCAN_LINES = 1_000_000
COMPONENTS = {
    b"roles.sql": "roles.sql",
    b"schema.sql": "schema.sql",
    b"history-schema.sql": "history-schema.sql",
    b"data.sql": "data.sql",
    b"history-data.sql": "history-data.sql",
}
ERROR_CATEGORIES = {
    b"42501": "insufficient-privilege",
    b"42704": "undefined-object",
    b"42710": "duplicate-object",
}
STATEMENT_CLASSES = {"role-membership-grant", "alter-role-set", "create-role",
                     "alter-role-attributes", "unknown"}
IDENTIFIER = rb'(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"\r\n]|"")+")'
# Deliberately limited to boolean role attributes, not arbitrary SQL or secrets.
# pg_dumpall normally emits CREATE ROLE followed by ALTER ROLE ... WITH.
ROLE_ATTRIBUTE = rb'(?:NO)?(?:SUPERUSER|INHERIT|CREATEROLE|CREATEDB|LOGIN|REPLICATION|BYPASSRLS)'
ROLE_ATTRIBUTES = ROLE_ATTRIBUTE + rb'(?: ' + ROLE_ATTRIBUTE + rb')*'
CREATE_ROLE = re.compile(
    rb'CREATE ROLE ' + IDENTIFIER + rb'(?: (?:WITH )?' + ROLE_ATTRIBUTES + rb')?;'
)
ALTER_ROLE_ATTRIBUTES = re.compile(
    rb'ALTER ROLE ' + IDENTIFIER + rb' (?:WITH )?' + ROLE_ATTRIBUTES + rb';'
)
ROLE_MEMBERSHIP_GRANT = re.compile(
    rb"GRANT " + IDENTIFIER + rb" TO " + IDENTIFIER
    + rb"(?: WITH (?:ADMIN OPTION|INHERIT (?:TRUE|FALSE)|SET (?:TRUE|FALSE))"
    rb"(?:, (?:INHERIT (?:TRUE|FALSE)|SET (?:TRUE|FALSE)))*)?"
    rb"(?: GRANTED BY " + IDENTIFIER + rb")?;"
)
ALTER_ROLE_SET = re.compile(
    rb"ALTER ROLE " + IDENTIFIER
    + rb"(?: IN DATABASE " + IDENTIFIER + rb")? SET "
    + rb"(?:" + IDENTIFIER + rb"(?:\." + IDENTIFIER + rb")*)"
    + rb" TO '(?:[^'\r\n]|'')*';"
)
RESTRICT_COMMAND = re.compile(rb"\\(?:un)?restrict [A-Za-z0-9]+")
DOLLAR_QUOTE = re.compile(rb"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")
RECORD = re.compile(
    rb"psql:/backup/(?P<component>roles\.sql|schema\.sql|history-schema\.sql|data\.sql|history-data\.sql)"
    rb":(?P<line>[1-9][0-9]{0,19}): "
    rb"(?P<severity>ERROR|FATAL|PANIC|NOTICE|WARNING|INFO|LOG|DEBUG):  (?P<sqlstate>[0-9A-Z]{5})"
)


def _accepted_error(stderr: bytes, exit_code: int):
    """Return the sole fixed-path error tuple, rejecting ambiguous framing."""
    if exit_code != 3 or not stderr or len(stderr) > MAX_LOG_BYTES:
        return None
    if not stderr.endswith(b"\n"):
        return None
    errors = []
    for line in stderr.split(b"\n")[:-1]:
        if not line or len(line) > MAX_LINE_BYTES:
            return None
        match = RECORD.fullmatch(line)
        if match is None or int(match["line"]) > (1 << 64) - 1:
            return None
        if match["severity"] in (b"ERROR", b"FATAL", b"PANIC"):
            errors.append((
                COMPONENTS[match["component"]],
                int(match["line"]),
                match["sqlstate"],
            ))
    return errors[0] if len(errors) == 1 else None


def component_hint(stderr: bytes, exit_code: int) -> str:
    """Preserve the bounded, untrusted component-only hint API."""
    error = _accepted_error(stderr, exit_code)
    return error[0] if error is not None else "unknown"


def _ends_with_complete_statement(line: bytes) -> bool:
    """Accept a single terminated statement, allowing a trailing line comment."""
    quote = None
    terminated = False
    index = 0
    while index < len(line):
        byte = line[index]
        if quote is None:
            if byte == ord("-") and index + 1 < len(line) and line[index + 1] == ord("-"):
                break
            if terminated and byte not in (ord(" "), ord("\t")):
                return False
            if byte in (ord("'"), ord('"')):
                quote = byte
                terminated = False
            elif byte == ord(";"):
                terminated = True
            elif byte not in (ord(" "), ord("\t")):
                terminated = False
        elif quote == ord("'") and byte == ord("\\"):
            # Treat backslashes as escapes conservatively. A false negative is safe.
            index += 1
        elif byte == quote:
            if index + 1 < len(line) and line[index + 1] == quote:
                index += 1
            else:
                quote = None
        index += 1
    return quote is None and terminated


def _safe_prefix_line(line: bytes) -> bool:
    """Require prior SQL to be physically single-line before trusting a lookup."""
    stripped = line.lstrip()
    if not stripped or stripped.startswith(b"--"):
        return True
    if RESTRICT_COMMAND.fullmatch(line):
        return True
    if re.match(rb"(?i)(?:COPY\b|\\copy\b)", stripped):
        return False
    if b"/*" in line or b"*/" in line or DOLLAR_QUOTE.search(line):
        return False
    return _ends_with_complete_statement(line)


def statement_class_from_file(path: Path, line_number: int) -> str:
    """Classify only exact one-line pg_dumpall role forms at a bounded line."""
    if line_number < 1 or line_number > MAX_ROLE_SCAN_LINES:
        return "unknown"
    bytes_read = 0
    try:
        with path.open("rb") as source:
            for current_line in range(1, line_number + 1):
                raw = source.readline(MAX_ROLE_LINE_BYTES + 1)
                if not raw or len(raw) > MAX_ROLE_LINE_BYTES:
                    return "unknown"
                bytes_read += len(raw)
                if bytes_read > MAX_ROLE_SQL_BYTES:
                    return "unknown"
                if raw.endswith(b"\n"):
                    line = raw[:-1]
                    if line.endswith(b"\r"):
                        line = line[:-1]
                else:
                    if current_line != line_number:
                        return "unknown"
                    line = raw
                if b"\r" in line:
                    return "unknown"
                if current_line < line_number:
                    if not _safe_prefix_line(line):
                        return "unknown"
                    continue
                if ROLE_MEMBERSHIP_GRANT.fullmatch(line):
                    return "role-membership-grant"
                if ALTER_ROLE_SET.fullmatch(line):
                    return "alter-role-set"
                if CREATE_ROLE.fullmatch(line):
                    return "create-role"
                if ALTER_ROLE_ATTRIBUTES.fullmatch(line):
                    return "alter-role-attributes"
                return "unknown"
    except OSError:
        return "unknown"
    return "unknown"


def diagnostic_hints(stderr: bytes, exit_code: int, roles_sql: Path):
    """Return fixed investigative labels; parsing never authenticates stderr."""
    error = _accepted_error(stderr, exit_code)
    if error is None:
        return "unknown", "unknown", "unknown"
    component, line_number, sqlstate = error
    if component != "roles.sql":
        return component, "unknown", "unknown"
    category = ERROR_CATEGORIES.get(sqlstate, "unknown")
    statement_class = statement_class_from_file(roles_sql, line_number)
    return component, category, statement_class


def hint_from_file(path: Path, exit_code: int) -> str:
    """Read at most the limit plus one byte, without decoding private output."""
    if exit_code != 3:
        return "unknown"
    try:
        with path.open("rb") as source:
            return component_hint(source.read(MAX_LOG_BYTES + 1), exit_code)
    except OSError:
        return "unknown"


def diagnostic_hints_from_files(stderr_path: Path, exit_code: int, roles_sql: Path):
    """Read only bounded runner files; stderr never supplies a filesystem path."""
    if exit_code != 3:
        return "unknown", "unknown", "unknown"
    try:
        with stderr_path.open("rb") as source:
            stderr = source.read(MAX_LOG_BYTES + 1)
    except OSError:
        return "unknown", "unknown", "unknown"
    return diagnostic_hints(stderr, exit_code, roles_sql)


def main() -> None:
    if len(sys.argv) == 3:
        # Preserve the component-only interface for existing local callers.
        try:
            hint = hint_from_file(Path(sys.argv[1]), int(sys.argv[2]))
        except (OSError, ValueError):
            hint = "unknown"
        print(hint if hint in COMPONENTS.values() else "unknown")
        return

    hints = ("unknown", "unknown", "unknown")
    try:
        if len(sys.argv) == 5 and sys.argv[1] == "--details":
            hints = diagnostic_hints_from_files(
                Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4]))
    except (OSError, ValueError):
        pass
    component, category, statement_class = hints
    # Keep stdout fixed even when arguments or private files are malformed.
    if component not in COMPONENTS.values():
        component = "unknown"
    if category not in {"insufficient-privilege", "undefined-object", "duplicate-object", "unknown"}:
        category = "unknown"
    if statement_class not in STATEMENT_CLASSES:
        statement_class = "unknown"
    print(f"{component} {category} {statement_class}")


if __name__ == "__main__":
    main()
