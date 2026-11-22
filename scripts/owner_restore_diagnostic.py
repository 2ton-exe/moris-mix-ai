"""Prepare and publish bounded, owner-local PostgreSQL restore diagnostics.

This helper never connects to a database. It writes a target guard query and a
catalog query for the operator to run with the repository-pinned local psql
container. Only the finalize command writes a fixed investigative label to
stdout; exact SQL and catalog evidence remain in the private work directory.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


MAX_COMPONENT_BYTES = 32 * 1024 * 1024
MAX_LOG_BYTES = 64 * 1024
MAX_LOG_LINE_BYTES = 512
MAX_STATEMENT_BYTES = 64 * 1024
MAX_CATALOG_BYTES = 32 * 1024
MAX_COPY_COLUMNS = 256
MAX_SQL_LINES = 1_000_000

COMPONENTS = (
    "roles.sql",
    "schema.sql",
    "data.sql",
    "history-schema.sql",
    "history-data.sql",
)
LABELS = (
    "header-target-absent",
    "header-dependency",
    "copy-stream-or-terminator",
    "sequence",
    "other/unknown",
)
ERROR_RECORD = re.compile(
    rb"psql:/backup/data\.sql:(?P<line>[1-9][0-9]{0,19}): "
    rb"(?P<severity>ERROR|NOTICE|WARNING):  (?P<sqlstate>[0-9A-Z]{5})(?:: [^\r\n]*)?"
)
IDENTIFIER = rb'(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"\r\n]|"")+")'
IDENTIFIER_RE = re.compile(IDENTIFIER)
COPY_HEADER = re.compile(
    rb"\s*COPY\s+(?P<relation>" + IDENTIFIER + rb"(?:\s*\.\s*" + IDENTIFIER
    + rb")?)\s*(?:\((?P<columns>[^;]*)\))?\s+FROM\s+stdin\s*;\s*\Z",
    re.IGNORECASE,
)
ALTER_SEQUENCE = re.compile(
    rb"\s*ALTER\s+SEQUENCE\s+(?P<relation>" + IDENTIFIER
    + rb"(?:\s*\.\s*" + IDENTIFIER + rb")?)(?:\s|;)", re.IGNORECASE,
)
SETVAL = re.compile(
    rb"\s*SELECT\s+(?:(?:pg_catalog)\s*\.\s*)?setval\s*\(\s*"
    rb"'(?P<relation>(?:[^']|'')*)'\s*,", re.IGNORECASE,
)
RESTRICT_COMMAND = re.compile(rb"\\(?:un)?restrict [A-Za-z0-9]+")


class DiagnosticInputError(ValueError):
    """The private evidence is absent, unsafe, or outside the bounded format."""


def _repo_root():
    return Path(__file__).resolve().parent.parent


def _inside(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _private_root(path):
    raw_root = Path(path)
    if raw_root.is_symlink():
        raise DiagnosticInputError("private directory is a symbolic link")
    root = raw_root.resolve(strict=True)
    if not root.is_dir():
        raise DiagnosticInputError("private directory is not a real directory")
    repo = _repo_root()
    if _inside(root, repo) or _inside(repo, root):
        raise DiagnosticInputError("private directory overlaps the repository")
    _check_private_mode(root)
    return root


def _private_child_directory(path, root):
    raw_path = Path(path)
    if raw_path.is_symlink():
        raise DiagnosticInputError("private SQL directory is a symbolic link")
    resolved = raw_path.resolve(strict=True)
    if not _inside(resolved, root) or resolved.parent != root or not resolved.is_dir():
        raise DiagnosticInputError("verified SQL must be a private child directory")
    _check_private_mode(resolved)
    return resolved


def _check_private_mode(path):
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) and not stat.S_ISREG(info.st_mode):
        raise DiagnosticInputError("private path is not a regular file or directory")
    if os.name == "posix":
        if stat.S_IMODE(info.st_mode) & 0o077:
            raise DiagnosticInputError("private path has group or world permissions")
        if info.st_uid != os.getuid():
            raise DiagnosticInputError("private path is not owned by the current user")


def _private_file(path, root, must_exist=True):
    raw_path = Path(path)
    resolved = raw_path.resolve(strict=must_exist)
    if not _inside(resolved, root):
        raise DiagnosticInputError("file is outside the private directory")
    if raw_path.is_symlink():
        raise DiagnosticInputError("symbolic links are not accepted")
    if must_exist:
        if not resolved.is_file():
            raise DiagnosticInputError("input is not a regular file")
        _check_private_mode(resolved)
    else:
        parent = resolved.parent.resolve(strict=True)
        if parent != root and not _inside(parent, root):
            raise DiagnosticInputError("output parent is outside the private directory")
    return resolved


def _read_bounded(path, limit):
    info = path.stat()
    if info.st_size > limit:
        raise DiagnosticInputError("private file exceeds its bound")
    with path.open("rb") as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise DiagnosticInputError("private file exceeds its bound")
    return data


def _write_private(path, data):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(data)
            destination.flush()
            os.fsync(destination.fileno())
    except Exception:
        try:
            path.unlink()
        except OSError:
            pass
        raise
    if os.name == "posix":
        os.chmod(path, 0o600)


def target_guard_query():
    """Return one-row JSON SQL for the clean local Supabase target preflight."""
    return (
        "SELECT pg_catalog.json_build_object(\n"
        "  'server_version_num', current_setting('server_version_num')::integer,\n"
        "  'database', current_database(),\n"
        "  'system_identifier', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),\n"
        "  'auth_users_present', pg_catalog.to_regclass('auth.users') IS NOT NULL,\n"
        "  'public_recipes_absent', pg_catalog.to_regclass('public.recipes') IS NULL,\n"
        "  'public_profiles_absent', pg_catalog.to_regclass('public.profiles') IS NULL\n"
        ")::text;\n"
    )


def _canonical_identifier(token):
    if token.startswith(b'"') and token.endswith(b'"'):
        value = token[1:-1].replace(b'""', b'"')
        try:
            decoded = value.decode("ascii")
        except UnicodeDecodeError:
            return None
        if not decoded or "\x00" in decoded:
            return None
        return '"' + decoded.replace('"', '""') + '"', decoded
    try:
        decoded = token.decode("ascii").lower()
    except UnicodeDecodeError:
        return None
    return decoded, decoded


def _qualified_name(raw):
    tokens = []
    offset = 0
    while offset < len(raw) and raw[offset] in b" \t\r\n":
        offset += 1
    first = IDENTIFIER_RE.match(raw, offset)
    if first is None:
        return None
    tokens.append(first.group(0))
    offset = first.end()
    while offset < len(raw) and raw[offset] in b" \t\r\n":
        offset += 1
    if offset < len(raw) and raw[offset:offset + 1] == b".":
        offset += 1
        while offset < len(raw) and raw[offset] in b" \t\r\n":
            offset += 1
        second = IDENTIFIER_RE.match(raw, offset)
        if second is None:
            return None
        tokens.append(second.group(0))
        offset = second.end()
        while offset < len(raw) and raw[offset] in b" \t\r\n":
            offset += 1
    if offset != len(raw):
        return None
    canonical = []
    normalized = []
    for token in tokens:
        result = _canonical_identifier(token)
        if result is None:
            return None
        canonical.append(result[0])
        normalized.append(result[1])
    if len(tokens) == 1:
        return {"regclass": canonical[0], "schema": None, "name": normalized[0]}
    return {
        "regclass": canonical[0] + "." + canonical[1],
        "schema": normalized[0],
        "name": normalized[1],
    }


def _copy_columns(raw):
    if raw is None:
        return []
    if not raw.strip():
        return None
    columns = []
    offset = 0
    while offset < len(raw):
        while offset < len(raw) and raw[offset] in b" \t\r\n":
            offset += 1
        match = IDENTIFIER_RE.match(raw, offset)
        if match is None:
            return None
        result = _canonical_identifier(match.group(0))
        if result is None:
            return None
        columns.append(result[1])
        if len(columns) > MAX_COPY_COLUMNS:
            return None
        offset = match.end()
        while offset < len(raw) and raw[offset] in b" \t\r\n":
            offset += 1
        if offset == len(raw):
            break
        if raw[offset:offset + 1] != b",":
            return None
        offset += 1
    if len(columns) != len(set(columns)):
        return None
    return columns


def _copy_candidate(statement):
    match = COPY_HEADER.fullmatch(statement)
    if match is None:
        return None
    relation = _qualified_name(match.group("relation"))
    columns = _copy_columns(match.group("columns"))
    if relation is None or columns is None:
        return None
    return {"kind": "copy", "relation": relation, "columns": columns}


def _sequence_candidate(statement):
    match = SETVAL.match(statement.strip())
    if match is not None:
        relation_bytes = match.group("relation").replace(b"''", b"'")
        relation = _qualified_name(relation_bytes)
        if relation is not None:
            return {"kind": "sequence", "relation": relation, "columns": []}
        return None
    match = ALTER_SEQUENCE.match(statement)
    if match is not None:
        relation = _qualified_name(match.group("relation"))
        if relation is not None:
            return {"kind": "sequence", "relation": relation, "columns": []}
    return None


def parse_error(stderr):
    """Accept one bounded verbose data.sql error record; reject ambiguity."""
    if not stderr or len(stderr) > MAX_LOG_BYTES or b"\x00" in stderr or not stderr.endswith(b"\n"):
        return None
    errors = []
    for raw_line in stderr.split(b"\n")[:-1]:
        if raw_line.endswith(b"\r"):
            raw_line = raw_line[:-1]
        if len(raw_line) > MAX_LOG_LINE_BYTES:
            return None
        match = ERROR_RECORD.fullmatch(raw_line)
        if match is None:
            # VERBOSITY=verbose can add DETAIL, CONTEXT and LOCATION lines.
            # They remain in the private stderr file and are never interpreted.
            continue
        line = int(match.group("line"))
        if line > MAX_SQL_LINES:
            return None
        if match.group("severity") == b"ERROR":
            errors.append((line, match.group("sqlstate").decode("ascii")))
    if len(errors) != 1:
        return None
    return {"line": errors[0][0], "sqlstate": errors[0][1]}


def _statement_at_error(sql, error_line):
    """Find a bounded statement or COPY section for a reported physical line.

    Unsupported or ambiguous syntax returns an unattributed result. COPY rows
    are never included in the returned evidence.
    """
    if not sql or len(sql) > MAX_COMPONENT_BYTES or b"\x00" in sql:
        return None
    # psql reports physical LF-delimited input lines. `bytes.splitlines()` also
    # treats several control bytes found in COPY data as line breaks, which can
    # shift attribution to the wrong statement. Strip only the final split
    # sentinel when the file ends with LF; keep all other bytes within a line.
    lines = sql.split(b"\n")
    if sql.endswith(b"\n"):
        lines.pop()
    if len(lines) > MAX_SQL_LINES or error_line > len(lines):
        return None
    if any(len(line) > MAX_STATEMENT_BYTES for line in lines):
        return None

    statement = bytearray()
    statement_start = None
    statement_overflow = False
    quote = None
    dollar_quote = None
    block_depth = 0
    copy_candidate = None

    for line_number, raw_line in enumerate(lines, 1):
        line = raw_line[:-1] if raw_line.endswith(b"\r") else raw_line
        if copy_candidate is not None:
            if line_number > copy_candidate["header_end"]:
                if line == b"\\.":
                    if line_number == error_line:
                        try:
                            private_statement = copy_candidate["statement"].decode("utf-8")
                        except UnicodeDecodeError:
                            return None
                        return {
                            "location": "copy-terminator",
                            "candidate": copy_candidate["candidate"],
                            "statement": private_statement,
                        }
                    copy_candidate = None
                    statement = bytearray()
                    statement_start = None
                    statement_overflow = False
                    quote = None
                    dollar_quote = None
                    block_depth = 0
                    continue
                if line_number == error_line:
                    try:
                        private_statement = copy_candidate["statement"].decode("utf-8")
                    except UnicodeDecodeError:
                        return None
                    return {
                        "location": "copy-data",
                        "candidate": copy_candidate["candidate"],
                        "statement": private_statement,
                    }
                continue
        if RESTRICT_COMMAND.fullmatch(line):
            continue

        index = 0
        line_comment = False
        completed_on_line = 0
        matching_statement = None
        while index < len(line):
            byte = line[index:index + 1]
            following = line[index + 1:index + 2]

            if line_comment:
                break
            if block_depth:
                if byte == b"/" and following == b"*":
                    block_depth += 1
                    index += 2
                    continue
                if byte == b"*" and following == b"/":
                    block_depth -= 1
                    index += 2
                    continue
                index += 1
                continue
            if dollar_quote is not None:
                if line[index:index + len(dollar_quote)] == dollar_quote:
                    if not statement_overflow:
                        statement.extend(dollar_quote)
                    index += len(dollar_quote)
                    dollar_quote = None
                    continue
                if not statement_overflow:
                    statement.extend(byte)
                index += 1
                continue
            if quote == b"'":
                if byte == b"\\" and following:
                    if not statement_overflow:
                        statement.extend(line[index:index + 2])
                    index += 2
                    continue
                if byte == b"'" and following == b"'":
                    if not statement_overflow:
                        statement.extend(b"''")
                    index += 2
                    continue
                if not statement_overflow:
                    statement.extend(byte)
                index += 1
                if byte == b"'":
                    quote = None
                continue
            if quote == b'"':
                if byte == b'"' and following == b'"':
                    if not statement_overflow:
                        statement.extend(b'""')
                    index += 2
                    continue
                if not statement_overflow:
                    statement.extend(byte)
                index += 1
                if byte == b'"':
                    quote = None
                continue

            if byte == b"-" and following == b"-":
                line_comment = True
                index += 2
                continue
            if byte == b"/" and following == b"*":
                if statement_start is not None and not statement_overflow:
                    statement.extend(b"/*")
                block_depth = 1
                index += 2
                continue
            if byte in (b"'", b'"'):
                if statement_start is None:
                    statement_start = line_number
                if not statement_overflow:
                    statement.extend(byte)
                quote = byte
                index += 1
                continue
            if byte == b"$":
                dollar = re.match(rb"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", line[index:])
                if dollar is not None:
                    if statement_start is None:
                        statement_start = line_number
                    dollar_quote = dollar.group(0)
                    if not statement_overflow:
                        statement.extend(dollar_quote)
                    index += len(dollar_quote)
                    continue

            if statement_start is None and byte not in b" \t\r\n":
                statement_start = line_number
            if statement_start is not None and not statement_overflow:
                statement.extend(byte)
                if len(statement) > MAX_STATEMENT_BYTES:
                    statement.clear()
                    statement_overflow = True
            index += 1

            if byte == b";" and statement_start is not None:
                completed_on_line += 1
                raw_statement = bytes(statement) if not statement_overflow else b""
                copy_info = _copy_candidate(raw_statement) if raw_statement else None
                seq_info = _sequence_candidate(raw_statement) if raw_statement else None
                if statement_start <= error_line <= line_number:
                    matching_statement = {
                        "location": "copy-header" if copy_info is not None else "statement",
                        "candidate": copy_info or seq_info or {"kind": "other"},
                        "statement": raw_statement,
                    }
                elif copy_info is not None and error_line > line_number:
                    copy_candidate = {
                        "header_end": line_number,
                        "candidate": copy_info,
                        "statement": raw_statement,
                    }
                statement = bytearray()
                statement_start = None
                statement_overflow = False

        if statement_start is not None and not statement_overflow:
            if len(statement) + 1 > MAX_STATEMENT_BYTES:
                statement.clear()
                statement_overflow = True
            else:
                statement.extend(b"\n")
        if line_number == error_line:
            if completed_on_line > 1:
                return None
            if matching_statement is not None:
                try:
                    matching_statement["statement"] = matching_statement["statement"].decode("utf-8")
                except UnicodeDecodeError:
                    return None
                return matching_statement
            if statement_start is not None and statement_start <= error_line:
                return None
            if copy_candidate is not None and error_line > copy_candidate["header_end"]:
                # The branch above handles COPY data/terminator lines.
                return None

    return None


def _sql_literal(value):
    if not isinstance(value, str) or "\x00" in value:
        raise DiagnosticInputError("invalid SQL literal")
    return "'" + value.replace("'", "''") + "'"


def _catalog_query(candidate):
    base = (
        "WITH target AS (\n"
        "  SELECT current_setting('server_version_num')::integer AS server_version_num,\n"
        "         current_database() AS database_name,\n"
        "         (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,\n"
        "         pg_catalog.to_regclass('auth.users') IS NOT NULL AS auth_users_present\n"
        "),\n"
    )
    if candidate.get("kind") not in ("copy", "sequence"):
        return (
            base
            + "SELECT pg_catalog.json_build_object(\n"
            "  'server_version_num', target.server_version_num,\n"
            "  'database', target.database_name,\n"
            "  'system_identifier', target.system_identifier,\n"
            "  'auth_users_present', target.auth_users_present,\n"
            "  'candidate', NULL\n"
            ")::text FROM target;\n"
        )

    relation = _sql_literal(candidate["relation"]["regclass"])
    candidate_kind = _sql_literal(candidate["kind"])
    columns = candidate.get("columns", [])
    column_sql = ", ".join(_sql_literal(column) for column in columns)
    base += (
        "candidate AS (SELECT pg_catalog.to_regclass(" + relation + ") AS oid),\n"
        "object_state AS (\n"
        "  SELECT candidate.oid, relation.relkind, namespace.nspname, relation.relname,\n"
        "         ARRAY(\n"
        "           SELECT required.name\n"
        "           FROM unnest(ARRAY[" + column_sql + "]::text[]) AS required(name)\n"
        "           WHERE NOT EXISTS (\n"
        "             SELECT 1 FROM pg_catalog.pg_attribute AS attribute\n"
        "             WHERE attribute.attrelid = candidate.oid\n"
        "               AND attribute.attnum > 0 AND NOT attribute.attisdropped\n"
        "               AND attribute.attname = required.name\n"
        "           )\n"
        "         ) AS missing_columns\n"
        "  FROM candidate\n"
        "  LEFT JOIN pg_catalog.pg_class AS relation ON relation.oid = candidate.oid\n"
        "  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace\n"
        ")\n"
    )
    return (
        base
        + "SELECT pg_catalog.json_build_object(\n"
        "  'server_version_num', target.server_version_num,\n"
        "  'database', target.database_name,\n"
        "  'system_identifier', target.system_identifier,\n"
        "  'auth_users_present', target.auth_users_present,\n"
        "  'candidate', pg_catalog.json_build_object(\n"
        "    'kind', " + candidate_kind + ",\n"
        "    'requested_relation', " + relation + ",\n"
        "    'relation_present', object_state.oid IS NOT NULL,\n"
        "    'schema', object_state.nspname,\n"
        "    'name', object_state.relname,\n"
        "    'relkind', object_state.relkind,\n"
        "    'sequence_present', object_state.relkind = 'S',\n"
        "    'missing_columns', object_state.missing_columns\n"
        "  )\n"
        ")::text FROM target CROSS JOIN object_state;\n"
    )


def _validate_component_checksums(sql_dir):
    manifest_path = sql_dir / "component-checksums.sha256"
    manifest = _read_bounded(manifest_path, 4096)
    try:
        lines = manifest.decode("ascii").splitlines()
    except UnicodeDecodeError as error:
        raise DiagnosticInputError("invalid checksum manifest") from error
    checksums = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([a-z-]+\.sql)", line)
        if match is None or match.group(2) not in COMPONENTS or match.group(2) in checksums:
            raise DiagnosticInputError("invalid checksum manifest")
        checksums[match.group(2)] = match.group(1)
    if set(checksums) != set(COMPONENTS):
        raise DiagnosticInputError("incomplete checksum manifest")
    for name in COMPONENTS:
        component_path = sql_dir / name
        info = component_path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_COMPONENT_BYTES:
            raise DiagnosticInputError("SQL component is not a bounded regular file")
        _check_private_mode(component_path)
        digest = hashlib.sha256()
        with component_path.open("rb") as component:
            for chunk in iter(lambda: component.read(64 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != checksums[name]:
            raise DiagnosticInputError("SQL component checksum mismatch")
    return checksums


def prepare(private_dir, sql_dir, stderr_path):
    root = _private_root(private_dir)
    sql_root = _private_child_directory(sql_dir, root)
    for name in COMPONENTS:
        _private_file(sql_root / name, root)
    manifest_path = _private_file(sql_root / "component-checksums.sha256", root)
    receipt_path = _private_file(root / "verified.json", root)
    receipt_raw = _read_bounded(receipt_path, 4096)
    try:
        receipt = json.loads(receipt_raw.decode("ascii"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DiagnosticInputError("archive verification receipt is malformed") from error
    if (
        not isinstance(receipt, dict)
        or re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("archive_sha256", ""))) is None
        or type(receipt.get("archive_size_bytes")) is not int
        or receipt["archive_size_bytes"] <= 0
    ):
        raise DiagnosticInputError("archive verification receipt is incomplete")
    stderr = _read_bounded(_private_file(stderr_path, root), MAX_LOG_BYTES)
    checksums = _validate_component_checksums(sql_root)
    if receipt.get("data_sha256") != checksums["data.sql"]:
        raise DiagnosticInputError("archive verification receipt does not match data.sql")
    error = parse_error(stderr)
    context = None
    if error is not None:
        context = _statement_at_error((sql_root / "data.sql").read_bytes(), error["line"])

    candidate = {
        "format": 1,
        "data_sha256": checksums["data.sql"],
        "error": error,
        "context": context,
        "manifest": manifest_path.name,
    }
    candidate_bytes = (json.dumps(candidate, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")
    catalog_bytes = _catalog_query((context or {}).get("candidate", {"kind": "other"})).encode("ascii")
    _write_private(root / "candidate.json", candidate_bytes)
    try:
        _write_private(root / "catalog-after.sql", catalog_bytes)
    except Exception:
        (root / "candidate.json").unlink(missing_ok=True)
        raise


def _one_json_object(path, root):
    raw = _read_bounded(_private_file(path, root), MAX_CATALOG_BYTES)
    if not raw.endswith(b"\n") or raw.count(b"\n") != 1:
        raise DiagnosticInputError("catalog result must contain one JSON row")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DiagnosticInputError("catalog result is not valid JSON") from error
    if not isinstance(value, dict):
        raise DiagnosticInputError("catalog result is not a JSON object")
    return value


def _valid_target_before(value):
    required = {
        "server_version_num", "database", "system_identifier", "auth_users_present",
        "public_recipes_absent", "public_profiles_absent",
    }
    if set(value) != required:
        return False
    try:
        server_version_num = int(value["server_version_num"])
    except (TypeError, ValueError):
        return False
    return (
        server_version_num // 10000 == 17
        and value["database"] == "postgres"
        and isinstance(value["system_identifier"], str)
        and re.fullmatch(r"[0-9]{1,20}", value["system_identifier"]) is not None
        and value["auth_users_present"] is True
        and value["public_recipes_absent"] is True
        and value["public_profiles_absent"] is True
    )


def _valid_target_after(value, before):
    required = {
        "server_version_num", "database", "system_identifier", "auth_users_present", "candidate",
    }
    if set(value) != required:
        return False
    try:
        server_version_num = int(value["server_version_num"])
    except (TypeError, ValueError):
        return False
    return (
        server_version_num // 10000 == 17
        and value["database"] == "postgres"
        and value["system_identifier"] == before["system_identifier"]
        and value["auth_users_present"] is True
    )


def _classify(candidate, after):
    error = candidate.get("error")
    context = candidate.get("context")
    if not isinstance(error, dict) or not isinstance(context, dict):
        return "other/unknown"
    if (
        type(error.get("line")) is not int
        or not 1 <= error["line"] <= MAX_SQL_LINES
        or re.fullmatch(r"[0-9A-Z]{5}", str(error.get("sqlstate", ""))) is None
    ):
        return "other/unknown"
    state = error.get("sqlstate")
    location = context.get("location")
    parsed = context.get("candidate")
    target = after.get("candidate")
    if not isinstance(parsed, dict) or not isinstance(target, dict):
        return "other/unknown"
    expected_relation = (
        parsed.get("relation", {}).get("regclass")
        if isinstance(parsed.get("relation"), dict) else None
    )
    if (
        target.get("kind") != parsed.get("kind")
        or target.get("requested_relation") != expected_relation
        or not isinstance(target.get("relation_present"), bool)
        or not isinstance(target.get("missing_columns"), list)
        or any(not isinstance(item, str) for item in target["missing_columns"])
    ):
        return "other/unknown"
    relation_info = parsed.get("relation")
    if (
        not isinstance(relation_info, dict)
        or not isinstance(relation_info.get("schema"), str)
        or not relation_info["schema"]
        or not isinstance(relation_info.get("name"), str)
    ):
        return "other/unknown"
    if target["relation_present"]:
        if target.get("schema") != relation_info["schema"] or target.get("name") != relation_info["name"]:
            return "other/unknown"
    elif target.get("schema") is not None or target.get("name") is not None:
        return "other/unknown"

    if parsed.get("kind") == "copy":
        columns = parsed.get("columns")
        if (
            not isinstance(columns, list)
            or any(not isinstance(item, str) for item in columns)
            or len(columns) != len(set(columns))
        ):
            return "other/unknown"
        missing_columns = target["missing_columns"]
        if target.get("relation_present") is False and (
            location == "copy-header"
            and state == "42P01"
            and missing_columns == []
        ):
            return "header-target-absent"
        if (
            target.get("relation_present") is True
            and location == "copy-header"
            and state == "42703"
            and missing_columns
            and set(missing_columns).issubset(set(columns))
        ):
            return "header-dependency"
        if (
            target.get("relation_present") is True
            and target.get("relkind") in ("r", "p")
            and location in ("copy-data", "copy-terminator")
            and target.get("missing_columns") == []
        ):
            return "copy-stream-or-terminator"
        return "other/unknown"

    if parsed.get("kind") == "sequence" and location == "statement":
        if target.get("relation_present") is False and target.get("sequence_present") is None:
            return "sequence"
        if (
            target.get("relation_present") is True
            and target.get("sequence_present") is True
            and target.get("relkind") == "S"
        ):
            return "sequence"
    return "other/unknown"


def check_target(private_dir, target_before_path):
    root = _private_root(private_dir)
    before = _one_json_object(target_before_path, root)
    if not _valid_target_before(before):
        raise DiagnosticInputError("disposable target guard did not pass")


def finalize(private_dir, target_before_path, catalog_after_path):
    root = _private_root(private_dir)
    candidate_path = _private_file(root / "candidate.json", root)
    candidate_raw = _read_bounded(candidate_path, MAX_CATALOG_BYTES)
    try:
        candidate = json.loads(candidate_raw.decode("ascii"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise DiagnosticInputError("candidate evidence is malformed")
    if not isinstance(candidate, dict) or candidate.get("format") != 1:
        raise DiagnosticInputError("candidate evidence version is unsupported")
    if not isinstance(candidate.get("data_sha256"), str) or re.fullmatch(
        r"[0-9a-f]{64}", candidate["data_sha256"]
    ) is None:
        raise DiagnosticInputError("candidate evidence checksum is malformed")
    receipt_path = _private_file(root / "verified.json", root)
    receipt_raw = _read_bounded(receipt_path, 4096)
    try:
        receipt = json.loads(receipt_raw.decode("ascii"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DiagnosticInputError("archive verification receipt is malformed") from error
    if not isinstance(receipt, dict) or candidate["data_sha256"] != receipt.get("data_sha256"):
        raise DiagnosticInputError("candidate evidence does not match verified archive")
    before = _one_json_object(target_before_path, root)
    after = _one_json_object(catalog_after_path, root)

    if not _valid_target_before(before) or not _valid_target_after(after, before):
        label = "other/unknown"
        reason = "disposable-target-guard-failed"
    else:
        label = _classify(candidate, after)
        reason = "corroborated-fixed-category" if label != "other/unknown" else "unclassified-or-ambiguous"

    context = candidate.get("context")
    statement = context.get("statement", "") if isinstance(context, dict) else ""
    if not isinstance(statement, str) or len(statement.encode("utf-8")) > MAX_STATEMENT_BYTES:
        statement = ""
        label = "other/unknown"
        reason = "private-statement-exceeds-bound"
    report = (
        "Owner-local restore diagnostic; investigative label is not root-cause proof.\n"
        f"label={label}\n"
        f"reason={reason}\n"
        f"error_line={candidate.get('error', {}).get('line', 'unknown') if isinstance(candidate.get('error'), dict) else 'unknown'}\n"
        f"sqlstate={candidate.get('error', {}).get('sqlstate', 'unknown') if isinstance(candidate.get('error'), dict) else 'unknown'}\n"
        "failing_statement_begin\n"
        f"{statement}\n"
        "failing_statement_end\n"
        "catalog_state_begin\n"
        f"{json.dumps(after, ensure_ascii=True, sort_keys=True)}\n"
        "catalog_state_end\n"
    ).encode("utf-8")
    if len(report) > 2 * MAX_CATALOG_BYTES:
        label = "other/unknown"
        report = (
            "Owner-local restore diagnostic; investigative label is not root-cause proof.\n"
            "label=other/unknown\nreason=private-report-exceeds-bound\n"
        ).encode("ascii")
    _write_private(root / "inspection.txt", report)
    return label


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    guard = subparsers.add_parser("guard", help="write the pre-replay disposable-target query")
    guard.add_argument("--private-dir", required=True)
    prep = subparsers.add_parser("prepare", help="validate private inputs and prepare catalog query")
    prep.add_argument("--private-dir", required=True)
    prep.add_argument("--sql-dir", required=True)
    prep.add_argument("--stderr", required=True)
    check = subparsers.add_parser("check-target", help="refuse restore unless the clean target guard passes")
    check.add_argument("--private-dir", required=True)
    check.add_argument("--target-before", required=True)
    finish = subparsers.add_parser("finalize", help="corroborate and emit one fixed label")
    finish.add_argument("--private-dir", required=True)
    finish.add_argument("--target-before", required=True)
    finish.add_argument("--catalog-after", required=True)
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        if args.command == "guard":
            root = _private_root(args.private_dir)
            _write_private(root / "target-before.sql", target_guard_query().encode("ascii"))
            return 0
        if args.command == "prepare":
            prepare(args.private_dir, args.sql_dir, args.stderr)
            return 0
        if args.command == "check-target":
            check_target(args.private_dir, args.target_before)
            return 0
        if args.command == "finalize":
            label = finalize(args.private_dir, args.target_before, args.catalog_after)
        else:
            label = "other/unknown"
    except Exception:
        if args.command == "finalize":
            label = "other/unknown"
        else:
            return 1
    sys.stdout.write(label + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
