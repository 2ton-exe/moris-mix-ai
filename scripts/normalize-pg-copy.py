#!/usr/bin/env python3
"""Normalize pg_dump COPY blocks for semantic comparison.

This sorts only data rows inside plain-text ``COPY ... FROM stdin;`` blocks.
Everything else is preserved byte-for-byte. It is intended for comparison
only; backup files used for restore must remain untouched.
"""

from __future__ import annotations

import sys


def main() -> int:
    in_copy = False
    rows: list[str] = []

    for line in sys.stdin:
        stripped = line.rstrip("\r\n")

        if not in_copy and line.startswith("COPY ") and stripped.endswith(" FROM stdin;"):
            in_copy = True
            sys.stdout.write(line)
            continue

        if in_copy and stripped == r"\.":
            sys.stdout.writelines(sorted(rows))
            rows.clear()
            in_copy = False
            sys.stdout.write(line)
            continue

        if in_copy:
            rows.append(line)
        else:
            sys.stdout.write(line)

    if in_copy:
        print("unterminated pg_dump COPY block", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
