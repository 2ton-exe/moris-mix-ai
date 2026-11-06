#!/usr/bin/env python3
"""Report only structural details of a pg_dump mismatch, never SQL content."""

from __future__ import annotations

import sys
from itertools import zip_longest
from pathlib import Path


def classify(path: str) -> tuple[list[bytes], list[str], int, int, bool]:
    """Read a runner-local normalized dump and classify lines without printing data."""
    lines = Path(path).read_bytes().splitlines(keepends=True)
    kinds: list[str] = []
    in_copy = False
    blocks = 0
    rows = 0

    for line in lines:
        stripped = line.rstrip(b"\r\n")
        if not in_copy and line.startswith(b"COPY ") and stripped.endswith(b" FROM stdin;"):
            in_copy = True
            blocks += 1
            kinds.append("copy-header")
        elif in_copy and stripped == b"\\.":
            in_copy = False
            kinds.append("copy-terminator")
        elif in_copy:
            rows += 1
            kinds.append("copy-row")
        else:
            kinds.append("outside-copy")

    return lines, kinds, blocks, rows, in_copy


def main() -> int:
    """Describe the first byte-level mismatch without exposing either dump."""
    if len(sys.argv) != 3:
        print("usage: describe-pg-dump-diff.py BEFORE AFTER", file=sys.stderr)
        return 2

    left, left_kinds, left_blocks, left_rows, left_unclosed = classify(sys.argv[1])
    right, right_kinds, right_blocks, right_rows, right_unclosed = classify(sys.argv[2])

    first: int | None = None
    mismatch_categories: set[str] = set()
    for index, (before_line, after_line) in enumerate(zip_longest(left, right)):
        if before_line == after_line:
            continue
        if first is None:
            first = index
        before_kind = left_kinds[index] if index < len(left_kinds) else "missing"
        after_kind = right_kinds[index] if index < len(right_kinds) else "missing"
        mismatch_categories.add(f"{before_kind}->{after_kind}")

    if first is None:
        print("::notice::Normalized migration dumps match exactly; no difference to classify.")
        return 0

    left_kind = left_kinds[first] if first < len(left_kinds) else "missing"
    right_kind = right_kinds[first] if first < len(right_kinds) else "missing"
    print(
        "::notice::Sanitized migration dump mismatch: "
        f"first differing line={first + 1}; "
        f"before category={left_kind}; after category={right_kind}; "
        f"all differing line categories={','.join(sorted(mismatch_categories))}; "
        f"before lines={len(left)}; after lines={len(right)}; "
        f"before COPY blocks={left_blocks}; after COPY blocks={right_blocks}; "
        f"before COPY rows={left_rows}; after COPY rows={right_rows}; "
        f"before unterminated COPY={left_unclosed}; "
        f"after unterminated COPY={right_unclosed}. "
        "No SQL, row contents, credentials or hashes were logged."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
