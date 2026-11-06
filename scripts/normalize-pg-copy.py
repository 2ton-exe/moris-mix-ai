#!/usr/bin/env python3
"""Normalize pg_dump *for comparison only*, never for restoring a backup.

Outside COPY, ignore non-executable pg_dump comments, blank lines, and paired
random psql restrict guards. Preserve executable statements byte-for-byte.
Within COPY, preserve the header/terminator and sort data rows, including any
rows resembling comments. Reject malformed COPY blocks and psql guard pairs.
"""

from __future__ import annotations

import re
import sys

_GUARD = re.compile(r"^\\(un)?restrict ([A-Za-z0-9]+)$")


def main() -> int:
    in_copy = False
    rows: list[str] = []
    guard_key: str | None = None
    guard_closed = False
    copy_blocks = 0

    for line in sys.stdin:
        stripped = line.rstrip("\r\n")

        if in_copy:
            if stripped == r"\.":
                sys.stdout.writelines(sorted(rows))
                rows.clear()
                in_copy = False
                sys.stdout.write(line)
            else:
                rows.append(line)
            continue

        if line.startswith("COPY "):
            if not stripped.endswith(" FROM stdin;"):
                print("malformed pg_dump COPY header", file=sys.stderr)
                return 1
            copy_blocks += 1
            in_copy = True
            sys.stdout.write(line)
            continue

        guard = _GUARD.fullmatch(stripped)
        if guard is not None:
            is_end = bool(guard.group(1))
            key = guard.group(2)
            if not is_end and guard_key is None and not guard_closed:
                guard_key = key
            elif is_end and guard_key == key and not guard_closed:
                guard_closed = True
            else:
                print("invalid or mismatched pg_dump restrict guard", file=sys.stderr)
                return 1
            continue

        if stripped.startswith((r"\restrict", r"\unrestrict")):
            print("malformed pg_dump restrict guard", file=sys.stderr)
            return 1

        # Full-line SQL comments and whitespace outside COPY have no execution
        # effect. Executable SQL, psql commands, and COPY rows are preserved.
        if not stripped.strip() or line.startswith("--"):
            continue
        if stripped == r"\.":
            print("unexpected COPY terminator", file=sys.stderr)
            return 1
        sys.stdout.write(line)

    if in_copy:
        print("unterminated pg_dump COPY block", file=sys.stderr)
        return 1
    if guard_key is not None and not guard_closed:
        print("unclosed pg_dump restrict guard", file=sys.stderr)
        return 1
    if copy_blocks == 0:
        print("missing pg_dump COPY block", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
