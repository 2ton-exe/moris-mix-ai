"""Bounded, untrusted diagnostic labels for a private Stage B role replay.

Never emit SQL, stderr, identifiers, filenames from SQL, or server messages.
These labels cannot authenticate an error: matching spoofed stderr is possible.
No replay transformation or role/ownership modification is performed.
"""
from pathlib import Path
import re
import sys

from classify_restore_component import (
    _accepted_error,
    _safe_prefix_line,
    IDENTIFIER,
    ROLE_MEMBERSHIP_GRANT,
    ERROR_CATEGORIES,
    MAX_ROLE_LINE_BYTES,
    MAX_ROLE_SQL_BYTES,
    MAX_ROLE_SCAN_LINES,
)

# Exact public example from Supabase's CLI backup/restore documentation.
DOCUMENTED_GRANT = (
    b'GRANT "postgres" TO "cli_login_postgres" WITH INHERIT FALSE '
    b'GRANTED BY "supabase_admin";'
)
# Count single-line ALTER ... OWNER TO cases; names and SQL never leave the runner.
OWNER = re.compile(
    rb'^ALTER (?P<kind>TABLE|FUNCTION|SEQUENCE|VIEW|MATERIALIZED VIEW|TYPE|SCHEMA|'
    rb'PROCEDURE|AGGREGATE|OTHER)\b[^\r\n]* OWNER TO (?:"supabase_admin"|supabase_admin);$'
)
OWNER_OTHER = re.compile(
    rb'^ALTER [^\r\n]+ OWNER TO (?:"supabase_admin"|supabase_admin);$'
)
CATEGORY = {b"42501": "insufficient-privilege",
            b"42704": "undefined-object",
            b"42710": "duplicate-object"}
VERBS = {b"ALTER ROLE ": "alter-role",
         b"CREATE ROLE ": "create-role"}

PARAMETER_GRANT_TYPE = "parameter-grant"
MEMBERSHIP_GRANT_TYPE = "role-membership-grant"
UNKNOWN_GRANT_TYPE = "other-or-unknown"

# PostgreSQL 17 kwlist.h. Parameter components are ColId, which excludes
# reserved and type/function keywords. Role names allow the latter.
RESERVED_WORDS = b"""
all analyse analyze and any array as asc asymmetric both case cast check
collate column constraint create current_catalog current_date current_role
current_time current_timestamp current_user default deferrable desc distinct
do else end except false fetch for foreign from grant group having in initially
intersect into lateral leading limit localtime localtimestamp not null offset
on only or order placing primary references returning select session_user some
symmetric system_user table then to trailing true union unique user using
variadic when where window with
""".split()
TYPE_FUNCTION_WORDS = b"""
authorization binary collation concurrently cross current_schema freeze full
ilike inner is isnull join left like natural notnull outer overlaps right
similar tablesample verbose
""".split()


def identifier_excluding(words: list[bytes]) -> bytes:
    """Match a quoted identifier or an unquoted word outside the exclusions."""
    return rb"(?!(?:" + b"|".join(words) + rb")(?![a-z0-9_$]))" + IDENTIFIER


SQL_SPACE = rb"[ \t\f\v]"
SQL_SEPARATOR = SQL_SPACE + rb"+"
SQL_COMMA = SQL_SPACE + rb"*," + SQL_SPACE + rb"*"
BEFORE_IDENTIFIER = rb"(?:" + SQL_SEPARATOR + rb'|(?="))'
AFTER_IDENTIFIER = rb"(?:" + SQL_SEPARATOR + rb'|(?<="))'
PARAMETER_COMPONENT = identifier_excluding(RESERVED_WORDS + TYPE_FUNCTION_WORDS)
PARAMETER_NAME = (
    PARAMETER_COMPONENT + rb"(?:" + SQL_SPACE + rb"*\." + SQL_SPACE
    + rb"*" + PARAMETER_COMPONENT + rb")*"
)
ROLE_NAME = rb'(?!(?-i:"none"))' + identifier_excluding(
    RESERVED_WORDS + [b"none", b"public"]
)
ROLE_SPEC = rb"(?:CURRENT_ROLE|CURRENT_USER|SESSION_USER|" + ROLE_NAME + rb")"
GRANTEE = rb"(?:GROUP" + BEFORE_IDENTIFIER + ROLE_NAME + rb"|PUBLIC|" + ROLE_SPEC + rb")"
PARAMETER_PRIVILEGE = rb"(?:SET|ALTER" + SQL_SEPARATOR + rb"SYSTEM)"
PARAMETER_GRANT = re.compile(
    rb"GRANT" + SQL_SEPARATOR
    + rb"(?:ALL(?:" + SQL_SEPARATOR + rb"PRIVILEGES)?|" + PARAMETER_PRIVILEGE
    + rb"(?:" + SQL_COMMA + PARAMETER_PRIVILEGE + rb")*)"
    + SQL_SEPARATOR + rb"ON" + SQL_SEPARATOR + rb"PARAMETER" + BEFORE_IDENTIFIER
    + PARAMETER_NAME + rb"(?:" + SQL_COMMA + PARAMETER_NAME + rb")*"
    + AFTER_IDENTIFIER + rb"TO" + BEFORE_IDENTIFIER
    + rb"(?P<grantees>" + GRANTEE + rb"(?:" + SQL_COMMA + GRANTEE + rb")*)"
    + rb"(?P<grant_option>" + AFTER_IDENTIFIER + rb"WITH" + SQL_SEPARATOR
    + rb"GRANT" + SQL_SEPARATOR + rb"OPTION)?"
    + rb"(?:" + AFTER_IDENTIFIER + rb"GRANTED" + SQL_SEPARATOR + rb"BY"
    + BEFORE_IDENTIFIER + ROLE_SPEC + rb")?"
    + SQL_SPACE + rb"*;",
    re.IGNORECASE,
)
PUBLIC_KEYWORD = re.compile(rb"public", re.IGNORECASE)


def is_parameter_grant(candidate: bytes) -> bool:
    match = PARAMETER_GRANT.fullmatch(candidate)
    if match is None:
        return False
    # Apply the PUBLIC keyword check to unquoted tokens only.
    return not (match["grant_option"] and any(
        PUBLIC_KEYWORD.fullmatch(name.group())
        for name in re.finditer(IDENTIFIER, match["grantees"])
    ))


# Only complete single-line role membership GRANTs with an actual GRANTED BY
# clause count. Reject keyword lookalikes inside quoted role names or comments.
GRANTOR_SUFFIX = re.compile(rb" GRANTED BY " + IDENTIFIER + rb";$")


def role_grantor_candidate(raw: bytes) -> bool:
    candidate = raw.strip(b" \t")
    if not candidate.startswith(b"GRANT ") or not _safe_prefix_line(candidate):
        return False
    # Remove a trailing line comment only when outside a quoted identifier.
    # Double quotes inside an identifier are escaped by a doubled double quote.
    quoted = False
    idx = 0
    while idx < len(candidate) - 1:
        if candidate[idx] == ord('"'):
            if quoted and candidate[idx + 1] == ord('"'):
                idx += 2
                continue
            quoted = not quoted
        elif not quoted and candidate[idx:idx + 2] == b"--":
            candidate = candidate[:idx].rstrip(b" \t")
            break
        idx += 1
    return bool(ROLE_MEMBERSHIP_GRANT.fullmatch(candidate)
                and GRANTOR_SUFFIX.search(candidate))


def bounded_lines(path: Path) -> list[bytes]:
    """Read only a bounded file and refuse overlong/malformed lines."""
    if path.stat().st_size > MAX_ROLE_SQL_BYTES:
        raise ValueError("oversize")
    source = path.read_bytes()
    if not source or len(source) > MAX_ROLE_SQL_BYTES:
        raise ValueError("invalid size")
    lines = source.split(b"\n")
    if lines[-1] == b"":
        lines.pop()
    if len(lines) > MAX_ROLE_SCAN_LINES:
        raise ValueError("too many lines")
    result = []
    for raw in lines:
        if raw.endswith(b"\r"):
            raw = raw[:-1]
        if len(raw) > MAX_ROLE_LINE_BYTES or b"\r" in raw or b"\x00" in raw:
            raise ValueError("malformed line")
        result.append(raw)
    return result


def counts(roles: Path, schema: Path) -> str:
    role_lines = bounded_lines(roles)
    schema_lines = bounded_lines(schema)
    documented = sum(line.strip(b" \t") == DOCUMENTED_GRANT
                     for line in role_lines)
    # Candidate total includes the exact documented grant; zero never rules
    # out multiline or unsupported role-grant syntax.
    grantor_candidates = sum(role_grantor_candidate(line) for line in role_lines)
    kinds = {"table": 0, "function": 0, "other": 0}
    for line in schema_lines:
        candidate = line.strip(b" \t")
        if not OWNER_OTHER.fullmatch(candidate):
            continue
        matched = OWNER.fullmatch(candidate)
        kind = matched.group("kind") if matched else b""
        if kind == b"TABLE":
            kinds["table"] += 1
        elif kind == b"FUNCTION":
            kinds["function"] += 1
        else:
            kinds["other"] += 1
    return (f"doc_grant={documented} grantor_candidates={grantor_candidates} "
            f"owner_table={kinds['table']} owner_function={kinds['function']} "
            f"owner_other={kinds['other']}")


def result(stderr: bytes, roles: Path, exit_code: int) -> str:
    unknown = f"membership=unknown grant_type={UNKNOWN_GRANT_TYPE}"
    if exit_code == 0:
        return ("replay=passed category=unknown verb=unknown "
                f"doc_grant=unknown prefix_pass=unknown {unknown}")
    fields = ("replay=failed category=unknown verb=unknown "
              f"doc_grant=unknown prefix_pass=unknown {unknown}")
    error = _accepted_error(stderr, exit_code)
    if not error or error[0] != "roles.sql":
        return fields
    _, lineno, sqlstate = error
    category = CATEGORY.get(sqlstate, "unknown")
    unattributed = f"replay=failed category={category} verb=unknown doc_grant=unknown"
    if not (1 <= lineno <= MAX_ROLE_SCAN_LINES):
        return f"{unattributed} prefix_pass=unknown {unknown}"
    try:
        lines = bounded_lines(roles)
    except (OSError, ValueError):
        return f"{unattributed} prefix_pass=unknown {unknown}"
    if lineno > len(lines):
        return f"{unattributed} prefix_pass=unknown {unknown}"
    prefix_ok = all(_safe_prefix_line(line) for line in lines[:lineno - 1])
    if not prefix_ok:
        return f"{unattributed} prefix_pass=false {unknown}"
    candidate = lines[lineno - 1].strip(b" \t")
    sql = candidate.strip(b"\f\v \t")
    # The line must itself be a complete, standalone executable SQL statement.
    # A line reported at the end of multi-line SQL cannot be attributed safely.
    if not sql or sql.startswith((b"--", b"\\")) or not _safe_prefix_line(sql):
        return f"{unattributed} prefix_pass=false {unknown}"
    # Match the SQL keyword independently of the strict membership grammar.
    # PostgreSQL accepts non-newline whitespace and adjacent quoted identifiers.
    # Reject longer unquoted tokens (GRANTED, GRANT_role, GRANT$foo).
    verb = ("grant" if re.match(rb'(?i)^GRANT(?=[ \t\v\f"])', sql)
            else next((label for prefix, label in VERBS.items()
                       if candidate.startswith(prefix)), "other"))
    documented = "true" if candidate == DOCUMENTED_GRANT else "false"
    # A structural match does not authenticate the stderr or prove root cause.
    grant_type = UNKNOWN_GRANT_TYPE
    membership = "not-applicable"
    if verb == "grant":
        membership = "unclassified"
        if ROLE_MEMBERSHIP_GRANT.fullmatch(candidate):
            membership = "match"
            grant_type = MEMBERSHIP_GRANT_TYPE
        elif is_parameter_grant(sql):
            grant_type = PARAMETER_GRANT_TYPE
    return (f"replay=failed category={category} verb={verb} "
            f"doc_grant={documented} prefix_pass=true membership={membership} "
            f"grant_type={grant_type}")



# The workflow saves all producer stdout as raw bytes. Bash command substitution
# would discard trailing newlines and embedded NUL before a shell guard sees them.
# Validate exact bytes and replay/label consistency inside this single process.
COUNT_RECORD = re.compile(
    rb"doc_grant=([0-9]{1,6}) grantor_candidates=([0-9]{1,6}) "
    rb"owner_table=([0-9]{1,6}) owner_function=([0-9]{1,6}) "
    rb"owner_other=([0-9]{1,6})\n"
)
FLAG_RECORD = re.compile(rb"([01])\|([01])\|([01])\|([01])\|([01])\n")
RESULT_RECORD = re.compile(
    rb"replay=(passed|failed) "
    rb"category=(insufficient-privilege|undefined-object|duplicate-object|unknown) "
    rb"verb=(grant|alter-role|create-role|other|unknown) "
    rb"doc_grant=(true|false|unknown) prefix_pass=(true|false|unknown) "
    rb"membership=(match|unclassified|not-applicable|unknown) "
    rb"grant_type=(parameter-grant|role-membership-grant|other-or-unknown)\n"
)


def checked_record(path: Path, pattern: re.Pattern[bytes]) -> re.Match[bytes]:
    """Match all bytes, including the one required terminator; reject extra bytes."""
    size = path.stat().st_size
    if size < 2 or size > 256:
        raise ValueError("invalid diagnostic record size")
    match = pattern.fullmatch(path.read_bytes())
    if match is None:
        raise ValueError("invalid diagnostic record")
    return match


def publish(count_path: Path, flag_path: Path, result_path: Path,
            exit_code: int, summary_path: Path) -> None:
    """Publish only reconstructed fixed fields after all inputs are validated."""
    if exit_code not in (0, 3):
        raise ValueError("unsupported replay exit")
    with count_path.open("rb") as raw:
        count_bytes = raw.read(257)
    # An unavailable optional count must not block SQL replay.
    if len(count_bytes) > 256:
        raise ValueError("invalid count record size")
    unavailable = count_bytes == b"counts=unavailable\n"
    cm = None if unavailable else COUNT_RECORD.fullmatch(count_bytes)
    if not unavailable and cm is None:
        raise ValueError("invalid count record")
    fm = checked_record(flag_path, FLAG_RECORD)
    rm = checked_record(result_path, RESULT_RECORD)
    replay, category, verb, documented, prefix, membership, grant_type = (
        field.decode("ascii") for field in rm.groups()
    )
    if exit_code == 0:
        if (replay, category, verb, documented, prefix, membership, grant_type) != (
                "passed", "unknown", "unknown", "unknown", "unknown", "unknown",
                UNKNOWN_GRANT_TYPE):
            raise ValueError("contradictory success diagnostic")
    else:
        if replay != "failed":
            raise ValueError("contradictory failure diagnostic")
        if prefix != "true" and (verb != "unknown" or documented != "unknown"
                                 or membership != "unknown"):
            raise ValueError("statement attribution missing validated prefix")
        if documented == "true" and verb != "grant":
            raise ValueError("contradictory documented grant")
        if prefix == "true" and verb == "unknown":
            raise ValueError("missing attributed verb")
        if prefix == "true" and documented == "unknown":
            raise ValueError("missing attributed grant classification")
        if documented == "true" and membership != "match":
            raise ValueError("contradictory documented membership")
        if prefix == "true" and (
                (verb == "grant" and membership not in ("match", "unclassified"))
                or (verb != "grant" and membership != "not-applicable")):
            raise ValueError("contradictory membership classification")
        if (membership == "match") != (grant_type == MEMBERSHIP_GRANT_TYPE):
            raise ValueError("contradictory membership grant type")
        if grant_type == PARAMETER_GRANT_TYPE and (
                prefix, verb, documented, membership) != (
                "true", "grant", "false", "unclassified"):
            raise ValueError("contradictory parameter grant type")
    if cm and int(cm.group(1)) > int(cm.group(2)):
        raise ValueError("inconsistent diagnostic candidate counts")
    numbers = [str(int(field)) for field in cm.groups()] if cm else []
    flags = [field.decode("ascii") for field in fm.groups()]
    static = ("doc_grant=" + numbers[0] + " grantor_candidates=" + numbers[1]
              + " owner_table=" + numbers[2] + " owner_function=" + numbers[3]
              + " owner_other=" + numbers[4]) if cm else "counts=unavailable"
    role = ("superuser=" + flags[0] + " createrole=" + flags[1]
            + " createdb=" + flags[2] + " bypassrls=" + flags[3]
            + " inherit=" + flags[4])
    observed = (f"replay={replay} category={category} verb={verb} "
                f"doc_grant={documented} prefix_pass={prefix} membership={membership} "
                f"grant_type={grant_type}")
    # Fully build the safe output before any publication. No raw bytes are copied.
    summary = (
        "### Role-only diagnostic (NOT recovery evidence)\n"
        f"- Static patterns: {static}\n"
        f"- Local connection-role attributes: {role}\n"
        f"- Untrusted role replay labels: {observed}\n"
        "- Schema/data recovery was not attempted.\n"
    )
    with summary_path.open("a", encoding="ascii") as out:
        out.write(summary)
    print("Role diagnostic patterns: " + static)
    print("Local role attributes: " + role)
    print("Role-only diagnostic (untrusted): " + observed)


def main() -> int:
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "counts":
            print(counts(Path(sys.argv[2]), Path(sys.argv[3])))
            return 0
        if len(sys.argv) == 7 and sys.argv[1] == "publish":
            publish(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]),
                    int(sys.argv[5]), Path(sys.argv[6]))
            return 0
        if len(sys.argv) == 5 and sys.argv[1] == "result":
            code = int(sys.argv[4])
            if code not in (0, 3):
                raise ValueError("unexpected psql status")
            stderr_path = Path(sys.argv[2])
            if stderr_path.stat().st_size > 64 * 1024:
                raise ValueError("stderr too large")
            print(result(stderr_path.read_bytes(),
                         Path(sys.argv[3]), code))
            return 0
    except (OSError, ValueError, OverflowError):
        pass
    # A generic fixed failure message never includes paths or private bytes.
    print("diagnostic-unavailable")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
