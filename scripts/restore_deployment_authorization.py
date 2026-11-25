#!/usr/bin/env python3
"""Fail closed unless this run has a protected, explicit deployment approval."""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any
from urllib.error import URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


ENVIRONMENT = "database-restore-drill"
EGRESS_MARKER = "MORI-STAGEB-ORDINARY-EGRESS-ACCEPTED"
CANDIDATE_MARKER = "MORI-STAGEB-CANDIDATE-APPROVAL-CONFIRMED"
ERROR = "::error::Protected restore authorization is missing or invalid"
MAX_RESPONSE_BYTES = 1_000_000


def approval_is_authorized(
    approvals: Any,
    *,
    actor: str,
    triggering_actor: str,
    run_id: str,
    run_attempt: str,
) -> bool:
    """Require one current-attempt approval for this protected environment."""
    if not isinstance(approvals, list):
        return False
    if (
        not isinstance(run_id, str)
        or not isinstance(run_attempt, str)
        or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id)
        # The approval-history API is run-scoped, not attempt-scoped. Reject
        # reruns so an earlier attempt's approval can never authorize this one.
        or run_attempt != "1"
        or not isinstance(actor, str)
        or not actor
        or not isinstance(triggering_actor, str)
        or not triggering_actor
    ):
        return False

    required_lines = (
        f"{EGRESS_MARKER} run_id={run_id} run_attempt=1",
        f"{CANDIDATE_MARKER} run_id={run_id} run_attempt=1",
    )
    matching_approvals = []
    for approval in approvals:
        if not isinstance(approval, dict):
            continue
        environments = approval.get("environments")
        if not isinstance(environments, list) or not any(
            isinstance(environment, dict) and environment.get("name") == ENVIRONMENT
            for environment in environments
        ):
            continue
        comment = approval.get("comment")
        if not isinstance(comment, str):
            continue
        comment_lines = comment.splitlines()
        if comment_lines in (list(required_lines), list(reversed(required_lines))):
            matching_approvals.append(approval)

    if len(matching_approvals) != 1:
        return False
    approval = matching_approvals[0]
    user = approval.get("user")
    if approval.get("state") != "approved" or not isinstance(user, dict):
        return False
    reviewer = user.get("login")
    if not isinstance(reviewer, str) or not reviewer:
        return False
    return reviewer.casefold() not in {actor.casefold(), triggering_actor.casefold()}


def fetch_approval_history(
    *,
    api_url: str,
    repository: str,
    run_id: str,
    token: str,
) -> list[dict[str, Any]]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("invalid repository")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
        raise ValueError("invalid run id")
    if not token:
        raise ValueError("missing token")

    parsed_api_url = urlsplit(api_url)
    if (
        parsed_api_url.scheme != "https"
        or not parsed_api_url.netloc
        or parsed_api_url.query
        or parsed_api_url.fragment
    ):
        raise ValueError("invalid API URL")
    endpoint = urljoin(
        api_url.rstrip("/") + "/",
        f"repos/{repository}/actions/runs/{run_id}/approvals",
    )
    request = Request(
        endpoint,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2026-03-10",
        },
        method="GET",
    )
    with urlopen(request, timeout=10) as response:
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("oversized approval response")
    decoded = json.loads(payload.decode("utf-8"))
    if not isinstance(decoded, list):
        raise ValueError("invalid approval response")
    return decoded


def main() -> int:
    try:
        approvals = fetch_approval_history(
            api_url=os.environ.get("GITHUB_API_URL", ""),
            repository=os.environ.get("GITHUB_REPOSITORY", ""),
            run_id=os.environ.get("GITHUB_RUN_ID", ""),
            token=os.environ.get("GITHUB_TOKEN", ""),
        )
        if not approval_is_authorized(
            approvals,
            actor=os.environ.get("GITHUB_ACTOR", ""),
            triggering_actor=os.environ.get("GITHUB_TRIGGERING_ACTOR", ""),
            run_id=os.environ.get("GITHUB_RUN_ID", ""),
            run_attempt=os.environ.get("GITHUB_RUN_ATTEMPT", ""),
        ):
            raise ValueError("approval is not authorized")
    except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError, URLError):
        print(ERROR, file=sys.stderr)
        return 1

    print("protected-deployment-authorization=pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
