from __future__ import annotations

import io
import json
import os
import unittest
from unittest.mock import patch

from restore_deployment_authorization import (
    CANDIDATE_MARKER,
    EGRESS_MARKER,
    ENVIRONMENT,
    ERROR,
    approval_is_authorized,
    fetch_approval_history,
    main,
)


RUN_ID = "45584482750"
RUN_ATTEMPT = "1"
ACTOR = "restore-operator"
TRIGGERING_ACTOR = "restore-rerunner"
REVIEWER = "independent-approver"


def approval_record(
    *,
    state: str = "approved",
    environment: str = ENVIRONMENT,
    reviewer: str = REVIEWER,
    run_id: str = RUN_ID,
    run_attempt: str = RUN_ATTEMPT,
    extra_comment: str = "",
) -> dict:
    comment = "\n".join(
        (
            f"{EGRESS_MARKER} run_id={run_id} run_attempt={run_attempt}",
            f"{CANDIDATE_MARKER} run_id={run_id} run_attempt={run_attempt}",
            extra_comment,
        )
    )
    return {
        "state": state,
        "comment": comment,
        "environments": [{"name": environment}],
        "user": {"login": reviewer},
    }


class RestoreDeploymentAuthorizationTests(unittest.TestCase):
    def test_current_protected_approval_accepts_both_explicit_gate_markers(self) -> None:
        self.assertTrue(
            approval_is_authorized(
                [approval_record()],
                actor=ACTOR,
                triggering_actor=TRIGGERING_ACTOR,
                run_id=RUN_ID,
                run_attempt=RUN_ATTEMPT,
            )
        )

    def test_public_approval_comment_rejects_any_extra_or_duplicate_content(self) -> None:
        valid = approval_record()
        egress = f"{EGRESS_MARKER} run_id={RUN_ID} run_attempt={RUN_ATTEMPT}"
        candidate = f"{CANDIDATE_MARKER} run_id={RUN_ID} run_attempt={RUN_ATTEMPT}"
        invalid_comments = (
            f"{egress}\n{candidate}\nSYNTHETIC_PRIVATE_APPROVAL_SENTINEL",
            f"prefix {egress}\n{candidate}",
            f"{egress}\n{candidate}\nsuffix",
            f"{egress}\n\n{candidate}",
            f"{egress}\n{candidate}\n{candidate}",
            f" {egress}\n{candidate}",
        )
        for comment in invalid_comments:
            with self.subTest(comment=comment):
                record = {**valid, "comment": comment}
                self.assertFalse(
                    approval_is_authorized(
                        [record],
                        actor=ACTOR,
                        triggering_actor=TRIGGERING_ACTOR,
                        run_id=RUN_ID,
                        run_attempt=RUN_ATTEMPT,
                    )
                )

    def test_missing_invalid_unapproved_or_stale_records_fail_closed(self) -> None:
        cases = (
            (None, RUN_ID, RUN_ATTEMPT),
            ([], RUN_ID, RUN_ATTEMPT),
            ([approval_record(state="rejected")], RUN_ID, RUN_ATTEMPT),
            ([approval_record(environment="other-environment")], RUN_ID, RUN_ATTEMPT),
            ([approval_record(run_id="45584482749")], RUN_ID, RUN_ATTEMPT),
            ([approval_record(run_attempt="1")], RUN_ID, "2"),
            ([approval_record(run_attempt="2")], RUN_ID, "2"),
            ([approval_record(), approval_record(reviewer="second-reviewer")], RUN_ID, RUN_ATTEMPT),
            ([{key: value for key, value in approval_record().items() if key != "user"}], RUN_ID, RUN_ATTEMPT),
            (["malformed"], RUN_ID, RUN_ATTEMPT),
        )
        for approvals, run_id, attempt in cases:
            with self.subTest(approvals=approvals, attempt=attempt):
                self.assertFalse(
                    approval_is_authorized(
                        approvals,
                        actor=ACTOR,
                        triggering_actor=TRIGGERING_ACTOR,
                        run_id=run_id,
                        run_attempt=attempt,
                    )
                )

    def test_rerun_attempt_is_rejected_even_with_matching_approval_text(self) -> None:
        self.assertFalse(
            approval_is_authorized(
                [approval_record(run_attempt="2")],
                actor=ACTOR,
                triggering_actor=TRIGGERING_ACTOR,
                run_id=RUN_ID,
                run_attempt="2",
            )
        )

    def test_dispatcher_and_rerunner_cannot_authorize_their_own_run(self) -> None:
        for actor in (ACTOR, TRIGGERING_ACTOR):
            with self.subTest(actor=actor):
                self.assertFalse(
                    approval_is_authorized(
                        [approval_record(reviewer=actor)],
                        actor=ACTOR,
                        triggering_actor=TRIGGERING_ACTOR,
                        run_id=RUN_ID,
                        run_attempt=RUN_ATTEMPT,
                    )
                )

    def test_comment_requires_standalone_markers_for_current_attempt(self) -> None:
        record = approval_record()
        record["comment"] = (
            f"Prefix {EGRESS_MARKER} run_id={RUN_ID} run_attempt={RUN_ATTEMPT}\n"
            f"{CANDIDATE_MARKER} run_id={RUN_ID} run_attempt={RUN_ATTEMPT}"
        )
        self.assertFalse(
            approval_is_authorized(
                [record],
                actor=ACTOR,
                triggering_actor=TRIGGERING_ACTOR,
                run_id=RUN_ID,
                run_attempt=RUN_ATTEMPT,
            )
        )

    def test_approval_api_request_is_read_only_and_output_is_fixed(self) -> None:
        payload = json.dumps([approval_record()]).encode("utf-8")

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                self.close()

        captured = {}

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response(payload)

        with patch("restore_deployment_authorization.urlopen", side_effect=fake_urlopen):
            records = fetch_approval_history(
                api_url="https://api.github.com",
                repository="2ton-exe/moris-mix-ai",
                run_id=RUN_ID,
                token="SYNTHETIC_API_TOKEN_SENTINEL",
            )
        request = captured["request"]
        self.assertEqual(request.full_url,
                         f"https://api.github.com/repos/2ton-exe/moris-mix-ai/actions/runs/{RUN_ID}/approvals")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Authorization"), "Bearer SYNTHETIC_API_TOKEN_SENTINEL")
        self.assertEqual(captured["timeout"], 10)
        self.assertTrue(
            approval_is_authorized(
                records,
                actor=ACTOR,
                triggering_actor=TRIGGERING_ACTOR,
                run_id=RUN_ID,
                run_attempt=RUN_ATTEMPT,
            )
        )

    def test_failure_output_never_contains_api_or_private_comment_content(self) -> None:
        with patch.dict(os.environ, {
            "GITHUB_API_URL": "https://api.github.com",
            "GITHUB_REPOSITORY": "2ton-exe/moris-mix-ai",
            "GITHUB_RUN_ID": RUN_ID,
            "GITHUB_RUN_ATTEMPT": RUN_ATTEMPT,
            "GITHUB_ACTOR": ACTOR,
            "GITHUB_TRIGGERING_ACTOR": TRIGGERING_ACTOR,
            "GITHUB_TOKEN": "SYNTHETIC_TOKEN_SENTINEL",
        }), patch("restore_deployment_authorization.fetch_approval_history",
                 side_effect=OSError("SYNTHETIC_PRIVATE_APPROVAL_SENTINEL")):
            stdout = io.StringIO()
            stderr = io.StringIO()
            with patch("sys.stdout", stdout), patch("sys.stderr", stderr):
                status = main()
        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), ERROR + "\n")
        self.assertNotIn("SYNTHETIC", stdout.getvalue() + stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
