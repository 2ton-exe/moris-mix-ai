# DRAFT — FS-01 demo API contract proposal

Status: **UNAPPROVED PROPOSAL** for Belen (FS-01) and Ramos (BE-03).
This document and its companion fixture are review material only. They are not
imported by the frontend and do not establish the official shared API contract.
No backend implementation, database operations, or live integration are included.

## Request

Proposed endpoint: `GET /functions/v1/demo-recipe` on the Supabase project origin.
Request header: `Accept: application/json`. No request body, query parameters,
recipe IDs, or user-supplied filters. Access headers remain undecided below.

## Proposed success response

HTTP 200, `Content-Type: application/json`:

```json
{
  "data": {
    "id": "11111111-1111-1111-1111-111111111111",
    "title": "Classic Tomato Scraps Pasta",
    "ingredients": ["200g spaghetti", "2 tbsp tomato paste", "2 cloves garlic", "Fresh basil"],
    "instructions": ["Boil pasta in salted water.", "Saute minced garlic and tomato paste.", "Toss pasta with sauce and torn basil."]
  }
}
```

Proposed types: `data` is one non-null recipe object; `id` is a UUID string;
`title` is a non-empty string; `ingredients` and `instructions` are arrays of
non-empty strings. Empty arrays are allowed and render explicit empty-section
messages. Additional fields should not be displayed without agreement.

This minimal proposal uses string arrays like the current BE-02 demo seed.
AI-01 extraction schemas use ingredient/step objects instead. Belen and Ramos
must decide the shared REST representation; the frontend must not infer it from
either database columns or AI output. No owner ID, email, raw input, or other
private metadata is proposed for public exposure.

Companion example: `demo-recipe.fixture.DRAFT.json`. Its recipe text is illustrative
and is not evidence of a database response. Do not enable it as a runtime fixture
until FS-01 is approved and the official shared fixture is available.

## Proposed shared error response

All non-success responses use `Content-Type: application/json`:

```json
{
  "error": {
    "code": "DEMO_UNAVAILABLE",
    "message": "The demonstration recipe is temporarily unavailable."
  }
}
```

Proposed `code`: stable machine-readable string. Proposed `message`: safe public
string, with no SQL, stack trace, internal endpoint, or credential details.
The frontend should map approved codes/statuses to user-friendly messages rather
than displaying an unvalidated server response. The current transport preserves
parsed errors as `unknown`; it does not implement this draft envelope.

| Status | Proposed behavior/code | Frontend recovery |
| --- | --- | --- |
| 200 | Valid recipe in `data` | Display approved fields |
| 400 | `INVALID_REQUEST`, if unsupported input is rejected | Show error, no automatic retry |
| 401 / 403 | Access-policy or gateway denial, if applicable | Show access error; do not retry unchanged credentials |
| 404 | `DEMO_RECIPE_NOT_FOUND` when the approved seed is absent | Show that no demo is available |
| 405 | `METHOD_NOT_ALLOWED`; allow GET/OPTIONS | Not expected from this UI |
| 408 | Request timeout | Offer manual retry |
| 429 | `RATE_LIMITED` | Offer manual retry respecting `Retry-After` once agreed |
| 500 / 503 | `DEMO_UNAVAILABLE` | Offer manual retry |
| 204 | Not proposed for this endpoint | Generic transport supports it; recipe adapter decision pending |

Backend/gateway error envelopes may differ for access or infrastructure failures.
The frontend must retain HTTP status and handle non-JSON failure bodies safely.

## Expected frontend behavior

After approval, request the demo on entry; show an accessible loading status until
it settles. Render only a validated payload. Treat malformed JSON and mismatched
recipe shapes as response errors, without displaying partially trusted data.
An unexpected null/missing payload must show an empty/error state according to
the final contract; it must not crash the page.

Show a clear message for network/CORS failures and recoverable HTTP failures.
Retry starts a fresh request and returns to loading; no infinite or automatic
retry loop. Cancel stale requests when leaving the page. Announce loading/error
changes and keep retry keyboard accessible at desktop and mobile widths.

Official fixture and live adapters should eventually return the same validated
type so the screen stays unchanged when switching sources. The source selector,
adapter, recipe renderer, and payload tests remain pending approval.

## Public-demo policy questions — backend approval required

1. Is this unauthenticated public GET access, public publishable-key access, or
   an authenticated session? What headers and Supabase gateway/JWT settings apply?
   Do not disable JWT verification based on this proposal.
2. Which fixed seed recipe and exact field allowlist are approved as non-sensitive?
   How will BE-03 prevent access to private recipes or arbitrary caller-selected IDs?
3. Which local and deployed frontend origins may use CORS? Who configures OPTIONS,
   allowed methods/headers, and `Vary: Origin`? Are cookies explicitly unnecessary?
4. What rate limits, `Retry-After`, and cache policy apply? The GET must be read-only.
5. Does missing demo data mean 404 as proposed, or 200 with nullable `data`?
6. Are ingredients/instructions string arrays or structured objects? Are title,
   flavor scores, ratings, timestamps, or other fields required for Sprint 1?
7. Will gateway errors use the shared envelope? Which codes and safe messages are
   stable? How should validation failures differ from availability failures?
8. What is the deployed project origin, and what evidence confirms the returned
   recipe comes from PostgreSQL rather than an embedded function fixture?

All privileged database access and any LLM calls remain behind Edge Functions.
Only an explicitly approved public key may enter browser configuration if the
final policy requires one. Service-role credentials and Gemini keys never belong
in Vite variables. No public access policy is implemented by this proposal.
