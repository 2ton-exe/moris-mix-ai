"""Verify a selected restore archive and extract its SQL into private storage.

The verifier uses only the Python standard library. Expected archive and
workflow identity values come from the caller's environment and must come from
the reviewed backup record, not from the downloaded evidence object alone.
"""

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile


MAX_COMPONENT_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_BYTES = 192 * 1024 * 1024
MAX_EVIDENCE_BYTES = 64 * 1024
COMPONENTS = {
    "roles.sql",
    "schema.sql",
    "data.sql",
    "history-schema.sql",
    "history-data.sql",
}
MEMBERS = COMPONENTS | {"component-checksums.sha256", "backup-metadata.json"}
EXPECTED_ENV = {
    "archive_sha256": "BACKUP_SHA256",
    "archive_size_bytes": "BACKUP_SIZE",
    "workflow_run_id": "BACKUP_RUN_ID",
    "workflow_run_attempt": "BACKUP_ATTEMPT",
    "source_revision": "BACKUP_SOURCE_SHA",
    "source_project_ref": "BACKUP_SOURCE_PROJECT",
    "source_repository": "GITHUB_REPOSITORY",
}


class ArchiveVerificationError(ValueError):
    """The selected archive or its independent evidence did not verify."""


def _require(condition, reason):
    if not condition:
        raise ArchiveVerificationError(reason)


def _private_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ArchiveVerificationError("input-file")
    info = path.stat()
    if os.name == "posix" and (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid()):
        raise ArchiveVerificationError("input-permissions")
    return path.resolve(strict=True)


def _private_root_for_target(target_path):
    raw_target = Path(target_path)
    raw_root = raw_target.parent
    if raw_target.name != "restore-verified-sql":
        raise ArchiveVerificationError("target-path")
    if raw_root.is_symlink() or raw_target.is_symlink():
        raise ArchiveVerificationError("private-path-symlink")
    root = raw_root.resolve(strict=True)
    if not root.is_dir():
        raise ArchiveVerificationError("private-root")
    repo = Path(__file__).resolve().parent.parent
    try:
        root.relative_to(repo)
        overlaps_repo = True
    except ValueError:
        try:
            repo.relative_to(root)
            overlaps_repo = True
        except ValueError:
            overlaps_repo = False
    if overlaps_repo:
        raise ArchiveVerificationError("private-root-overlaps-repository")
    if os.name == "posix":
        info = root.stat()
        if stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid():
            raise ArchiveVerificationError("private-root-permissions")
    return root


def _expected_values():
    values = {key: os.environ.get(variable, "") for key, variable in EXPECTED_ENV.items()}
    values.update({
        "object_key": os.environ.get("BACKUP_PREFIX", "") + "/" + os.environ.get("ARCHIVE_NAME", ""),
        "consistency_check": "passed",
    })
    _require(all(values[key] for key in (
        "archive_sha256", "archive_size_bytes", "workflow_run_id", "workflow_run_attempt",
        "source_revision", "source_project_ref", "source_repository", "object_key",
    )), "expected-identity-missing")
    _require(re.fullmatch(r"[0-9a-f]{64}", values["archive_sha256"]) is not None,
             "expected-checksum-invalid")
    try:
        values["archive_size_bytes"] = int(values["archive_size_bytes"])
        values["workflow_run_id"] = int(values["workflow_run_id"])
        values["workflow_run_attempt"] = int(values["workflow_run_attempt"])
    except ValueError as error:
        raise ArchiveVerificationError("expected-identity-invalid") from error
    _require(values["archive_size_bytes"] > 0, "expected-size-invalid")
    _require(re.fullmatch(r"[0-9a-f]{40}", values["source_revision"]) is not None,
             "expected-revision-invalid")
    _require(".." not in values["object_key"].split("/"), "expected-object-key-invalid")
    return values


def _read_archive_file(archive, item, limit):
    _require(item.size <= limit, "archive-member-size")
    source = archive.extractfile(item)
    _require(source is not None, "archive-member-unreadable")
    with source:
        value = source.read(limit + 1)
    _require(len(value) == item.size and len(value) <= limit, "archive-member-size")
    return value


def _checksums(raw):
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError as error:
        raise ArchiveVerificationError("checksum-manifest-encoding") from error
    values = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([a-z-]+\.sql)", line)
        _require(match is not None, "checksum-manifest-format")
        digest, name = match.groups()
        _require(name in COMPONENTS and name not in values, "checksum-manifest-entry")
        values[name] = digest
    _require(set(values) == COMPONENTS, "checksum-manifest-incomplete")
    return values


def _write_private(path, value):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(value)
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


def verify_and_extract(archive_path, evidence_path, target_path):
    root = _private_root_for_target(target_path)
    archive_path = _private_file(archive_path)
    evidence_path = _private_file(evidence_path)
    for source in (archive_path, evidence_path):
        try:
            source.relative_to(root)
        except ValueError as error:
            raise ArchiveVerificationError("input-outside-private-root") from error
    target = root / Path(target_path).name
    if target.exists() or (root / "verified.json").exists():
        raise ArchiveVerificationError("output-directory-exists")

    expected = _expected_values()
    size = archive_path.stat().st_size
    _require(size <= MAX_ARCHIVE_BYTES and size == expected["archive_size_bytes"], "archive-size")
    digest = hashlib.sha256()
    with archive_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    _require(digest.hexdigest() == expected["archive_sha256"], "archive-sha256")

    _require(evidence_path.stat().st_size <= MAX_EVIDENCE_BYTES, "evidence-size")
    evidence_raw = evidence_path.read_bytes()
    try:
        evidence = json.loads(evidence_raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveVerificationError("evidence-format") from error
    _require(isinstance(evidence, dict), "evidence-format")
    generated_at = evidence.get("generated_at_utc")
    _require(
        isinstance(generated_at, str)
        and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", generated_at)
        is not None,
        "evidence-timestamp",
    )
    try:
        datetime.strptime(generated_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise ArchiveVerificationError("evidence-timestamp") from error
    for key, value in expected.items():
        _require(str(evidence.get(key)) == str(value), "evidence-identity")

    members = {}
    entry_count = 0
    root_directory_seen = False
    with tarfile.open(archive_path, "r|gz") as bundle:
        for item in bundle:
            entry_count += 1
            _require(entry_count <= len(MEMBERS) + 2, "archive-entry-count")
            if item.isdir() and item.name in (".", "./"):
                _require(not root_directory_seen, "archive-member-name")
                root_directory_seen = True
                continue
            _require(item.isfile() and item.name.startswith("./"), "archive-member-type")
            name = item.name[2:]
            _require(name in MEMBERS and name not in members, "archive-member-name")
            _require(0 < item.size < MAX_COMPONENT_BYTES, "archive-member-size")
            if name == "component-checksums.sha256":
                limit = 4096
            elif name == "backup-metadata.json":
                limit = MAX_EVIDENCE_BYTES
            else:
                limit = MAX_COMPONENT_BYTES - 1
            members[name] = _read_archive_file(bundle, item, limit)
    _require(set(members) == MEMBERS, "archive-member-set")

    manifest = members["component-checksums.sha256"]
    component_hashes = _checksums(manifest)
    try:
        metadata = json.loads(members["backup-metadata.json"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveVerificationError("backup-metadata-format") from error
    _require(isinstance(metadata, dict), "backup-metadata-format")
    metadata_expected = {
        "source_revision": expected["source_revision"],
        "source_project_ref": expected["source_project_ref"],
        "workflow_run_id": expected["workflow_run_id"],
        "workflow_run_attempt": expected["workflow_run_attempt"],
        "generated_at_utc": evidence["generated_at_utc"],
    }
    for key, value in metadata_expected.items():
        _require(str(metadata.get(key)) == str(value), "backup-metadata-identity")

    extracted = {}
    for name in sorted(COMPONENTS):
        raw = members[name]
        _require(hashlib.sha256(raw).hexdigest() == component_hashes[name], "component-sha256")
        extracted[name] = raw
    extracted["component-checksums.sha256"] = manifest

    target.mkdir(mode=0o700)
    try:
        for name, value in extracted.items():
            _write_private(target / name, value)
        receipt = {
            "archive_sha256": expected["archive_sha256"],
            "archive_size_bytes": expected["archive_size_bytes"],
            "workflow_run_id": expected["workflow_run_id"],
            "workflow_run_attempt": expected["workflow_run_attempt"],
            "source_revision": expected["source_revision"],
            "source_project_ref": expected["source_project_ref"],
            "data_sha256": component_hashes["data.sql"],
        }
        _write_private(
            target.parent / "verified.json",
            (json.dumps(receipt, separators=(",", ":")) + "\n").encode("ascii"),
        )
    except Exception:
        for child in target.iterdir():
            child.unlink(missing_ok=True)
        target.rmdir()
        try:
            (target.parent / "verified.json").unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return target


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args(argv)
    try:
        verify_and_extract(args.archive, args.evidence, args.target)
    except Exception as error:
        reason = error.args[0] if isinstance(error, ArchiveVerificationError) else "unexpected-error"
        if reason not in {
            "input-file", "input-permissions", "output-directory-exists", "expected-identity-missing",
            "expected-checksum-invalid", "expected-identity-invalid", "expected-size-invalid",
            "expected-revision-invalid", "expected-object-key-invalid", "private-path-symlink",
            "private-root", "private-root-overlaps-repository", "private-root-permissions",
            "input-outside-private-root", "target-path", "archive-size",
            "archive-sha256", "evidence-size", "evidence-format", "evidence-identity", "evidence-timestamp",
            "archive-member-type", "archive-member-name", "archive-member-size", "archive-member-set",
            "archive-member-unreadable", "checksum-manifest-encoding", "checksum-manifest-format",
            "checksum-manifest-entry", "checksum-manifest-incomplete", "backup-metadata-format",
            "backup-metadata-identity", "component-sha256",
        }:
            reason = "unexpected-error"
        print(f"::error::Private restore archive verification failed ({reason})", file=sys.stderr)
        return 1
    print("Private archive, evidence, and five SQL components verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
