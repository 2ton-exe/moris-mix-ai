# UI-05-02 — mori-feedback

Status: resolved
Blocked by: none

Implement the corresponding behavior and regression checks in [the spec](../spec.md).

## Answer

Mori now shows current non-idle activity in a compact speech bubble when chat is closed, reusing the existing viewport placement and measurement. Signed-in open chat retains an explicitly named status. The existing duplicate-pantry activity and card highlights now have visible speech without changing pantry normalization, AI requests, recipe writes, authentication, or photo storage.

Verification: three new Mori regressions failed before implementation (no accessible closed speech); 73 MoriCompanion/AIChefPage tests pass on Node 24. Typecheck, focused ESLint and diff checks pass. A targeted browser journey verified signed-in duplicate feedback, preserved pantry focus, hidden chat/composer, compact bounds at all four desktop corners, and activity in open chat. Screenshots inspected at `/tmp/ui05-mori-feedback-20-20.png` and `/tmp/ui05-mori-feedback-1300-650.png`. Existing AI Chef browser journey includes closed-feedback geometry assertions. Initial parallel test runs exceeded timeouts under CPU load; sequential final runs passed.


### Pending-chat announcement follow-up

Tagged chat-owned activity explicitly so open chat uses its existing pending status without duplicating the companion announcement. Closed chat still presents speech, and independently selected external problems retain their status. An actual pending-request regression failed before the change with two statuses instead of one; all 63 MoriChatPanel/MoriCompanion tests pass after it. A focused browser extraction of the existing dialogue journey verified the original single-announcement assertion, closed pending speech, reopen, and successful completion; the durable journey now checks closed/reopened pending feedback too.
