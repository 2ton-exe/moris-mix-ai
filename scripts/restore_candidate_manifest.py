#!/usr/bin/env python3
"""Materialize one fixed, protected restore-candidate identity privately."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any


CANDIDATES = {"backup-4", "backup-7"}
FIELDS = (
    "object_prefix",
    "archive_name",
    "evidence_name",
    "archive_sha256",
    "archive_size_bytes",
    "workflow_run_id",
    "workflow_run_attempt",
    "source_revision",
    "source_project_ref",
)
ERROR = "::error::Selected restore candidate configuration is missing or invalid"


def resolve_candidate(candidate: str, raw_manifest: str) -> dict[str, str]:
    if candidate not in CANDIDATES or not raw_manifest:
        raise ValueError("invalid candidate configuration")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate manifest key")
            result[key] = value
        return result

    manifest: Any = json.loads(raw_manifest, object_pairs_hook=unique_object)
    if not isinstance(manifest, dict) or set(manifest) - CANDIDATES:
        raise ValueError("invalid candidate configuration")
    record = manifest.get(candidate)
    if not isinstance(record, dict) or set(record) != set(FIELDS):
        raise ValueError("invalid candidate configuration")

    values: dict[str, str] = {}
    for field in FIELDS:
        value = record[field]
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise ValueError("invalid candidate configuration")
        normalized = str(value)
        if not normalized or "\n" in normalized or "\r" in normalized or "\0" in normalized:
            raise ValueError("invalid candidate configuration")
        values[field] = normalized

    if (
        not re.fullmatch(r"postgres/(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9/_-]+", values["object_prefix"])
        or values["object_prefix"].endswith("/")
        or "//" in values["object_prefix"]
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz", values["archive_name"])
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.json", values["evidence_name"])
        or not re.fullmatch(r"[0-9a-f]{64}", values["archive_sha256"])
        or not re.fullmatch(r"[1-9][0-9]{0,8}", values["archive_size_bytes"])
        or int(values["archive_size_bytes"]) > 268_435_456
        or not re.fullmatch(r"[1-9][0-9]{0,19}", values["workflow_run_id"])
        or not re.fullmatch(r"[1-9][0-9]{0,8}", values["workflow_run_attempt"])
        or not re.fullmatch(r"[0-9a-f]{40}", values["source_revision"])
        or not re.fullmatch(r"[a-z0-9]{20}", values["source_project_ref"])
    ):
        raise ValueError("invalid candidate configuration")
    return values


def write_shell_environment(path: Path, values: dict[str, str]) -> None:
    names = {
        "object_prefix": "BACKUP_PREFIX",
        "archive_name": "ARCHIVE_NAME",
        "evidence_name": "EVIDENCE_NAME",
        "archive_sha256": "BACKUP_SHA256",
        "archive_size_bytes": "BACKUP_SIZE",
        "workflow_run_id": "BACKUP_RUN_ID",
        "workflow_run_attempt": "BACKUP_ATTEMPT",
        "source_revision": "BACKUP_SOURCE_SHA",
        "source_project_ref": "BACKUP_SOURCE_PROJECT",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            for field in FIELDS:
                output.write(f"export {names[field]}={shlex.quote(values[field])}\n")
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    os.chmod(path, 0o600)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(ERROR, file=sys.stderr)
        return 1
    try:
        values = resolve_candidate(argv[1], os.environ.get("RESTORE_CANDIDATES_JSON", ""))
        write_shell_environment(Path(argv[2]), values)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        print(ERROR, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
