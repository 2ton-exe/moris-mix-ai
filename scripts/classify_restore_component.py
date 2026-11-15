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
COMPONENTS = {
    b"roles.sql": "roles.sql",
    b"schema.sql": "schema.sql",
    b"history-schema.sql": "history-schema.sql",
    b"data.sql": "data.sql",
    b"history-data.sql": "history-data.sql",
}
RECORD = re.compile(
    rb"psql:/backup/(?P<component>roles\.sql|schema\.sql|history-schema\.sql|data\.sql|history-data\.sql)"
    rb":(?P<line>[1-9][0-9]{0,19}): "
    rb"(?P<severity>ERROR|FATAL|PANIC|NOTICE|WARNING|INFO|LOG|DEBUG):  [0-9A-Z]{5}"
)


def component_hint(stderr: bytes, exit_code: int) -> str:
    """Reject ambiguity and unexpected framing, including partial/verbose logs."""
    if exit_code != 3 or not stderr or len(stderr) > MAX_LOG_BYTES:
        return "unknown"
    if not stderr.endswith(b"\n"):
        return "unknown"
    errors = []
    for line in stderr.split(b"\n")[:-1]:
        if not line or len(line) > MAX_LINE_BYTES:
            return "unknown"
        match = RECORD.fullmatch(line)
        if match is None or int(match["line"]) > (1 << 64) - 1:
            return "unknown"
        if match["severity"] in (b"ERROR", b"FATAL", b"PANIC"):
            errors.append(COMPONENTS[match["component"]])
    return errors[0] if len(errors) == 1 else "unknown"


def hint_from_file(path: Path, exit_code: int) -> str:
    """Read at most the limit plus one byte, without decoding private output."""
    if exit_code != 3:
        return "unknown"
    try:
        with path.open("rb") as source:
            return component_hint(source.read(MAX_LOG_BYTES + 1), exit_code)
    except OSError:
        return "unknown"


def main() -> None:
    hint = "unknown"
    try:
        if len(sys.argv) == 3:
            hint = hint_from_file(Path(sys.argv[1]), int(sys.argv[2]))
    except (OSError, ValueError):
        pass
    # Defensive fixed-output boundary; never print paths, exceptions or records.
    print(hint if hint in COMPONENTS.values() else "unknown")


if __name__ == "__main__":
    main()
