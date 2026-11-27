#!/usr/bin/env python3
"""Materialize one fixed, protected restore-candidate identity privately."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any


ORDINARY_CANDIDATE = "next-ordinary-recovery"
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
    if candidate != ORDINARY_CANDIDATE or not raw_manifest:
        raise ValueError("invalid candidate configuration")

    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate manifest key")
            result[key] = value
        return result

    manifest: Any = json.loads(raw_manifest, object_pairs_hook=unique_object)
    if not isinstance(manifest, dict) or set(manifest) != {candidate}:
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


def verify_manifest_pin(raw_manifest: str, expected_sha256: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("invalid candidate manifest pin")
    actual_sha256 = hashlib.sha256(raw_manifest.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual_sha256, expected_sha256):
        raise ValueError("candidate manifest pin mismatch")


def verify_manifest_approval(
    raw_manifest: str,
    configured_sha256: str,
    independently_approved_sha256: str,
) -> None:
    """Require both the operational pin and independent approval to match bytes."""
    verify_manifest_pin(raw_manifest, configured_sha256)
    verify_manifest_pin(raw_manifest, independently_approved_sha256)


def _open_parent_directory_without_symlinks(path: Path) -> tuple[int, str]:
    raw_path = Path(path)
    if ".." in raw_path.parts:
        raise ValueError("unsafe candidate manifest output path")
    if not raw_path.is_absolute():
        raw_path = Path.cwd() / raw_path
    if raw_path.anchor != "/" or not raw_path.name or raw_path.name in {".", ".."}:
        raise ValueError("unsupported candidate manifest output path")
    if (
        os.name != "posix"
        or not hasattr(os, "O_DIRECTORY")
        or not hasattr(os, "O_NOFOLLOW")
        or os.open not in os.supports_dir_fd
        or os.unlink not in os.supports_dir_fd
    ):
        raise OSError("symlink-safe candidate manifest output is unavailable")

    directory_flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0)
    nofollow_flags = directory_flags | os.O_NOFOLLOW
    directory_fd = os.open("/", directory_flags)
    try:
        for component in raw_path.parent.parts[1:]:
            child_fd = os.open(component, nofollow_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
    except BaseException:
        os.close(directory_fd)
        raise
    return directory_fd, raw_path.name


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
    payload = "".join(
        f"export {names[field]}={shlex.quote(values[field])}\n"
        for field in FIELDS
    ).encode("utf-8")
    parent_fd, filename = _open_parent_directory_without_symlinks(path)
    output_fd: int | None = None
    created = False
    try:
        output_flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | os.O_NOFOLLOW
            | getattr(os, "O_CLOEXEC", 0)
        )
        output_fd = os.open(filename, output_flags, 0o600, dir_fd=parent_fd)
        created = True
        os.fchmod(output_fd, 0o600)
        output = os.fdopen(output_fd, "wb")
        output_fd = None
        with output:
            output.write(payload)
    except BaseException:
        if output_fd is not None:
            try:
                os.close(output_fd)
            except OSError:
                pass
        if created:
            try:
                os.unlink(filename, dir_fd=parent_fd)
            except OSError:
                pass
        raise
    finally:
        os.close(parent_fd)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(ERROR, file=sys.stderr)
        return 1
    try:
        raw_manifest = os.environ.get("RESTORE_CANDIDATES_JSON", "")
        verify_manifest_approval(
            raw_manifest,
            os.environ.get("RESTORE_CANDIDATE_MANIFEST_SHA256", ""),
            os.environ.get("RESTORE_CANDIDATE_APPROVED_SHA256", ""),
        )
        values = resolve_candidate(argv[1], raw_manifest)
        # Both preflights must bind the archived source to the reviewed main
        # revision executing this workflow. The archive/evidence check later
        # verifies the source revision against this independently pinned record.
        if values["source_revision"] != os.environ.get("GITHUB_SHA"):
            raise ValueError("candidate source revision does not match workflow")
        write_shell_environment(Path(argv[2]), values)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        print(ERROR, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
