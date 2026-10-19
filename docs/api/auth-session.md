# Authenticated session and Edge Function authentication boundary contract

This contract defines the reusable Supabase Edge Function authentication boundary (`supabase/functions/_shared/auth.ts`) and the protected session verification endpoint (`supabase/functions/auth-session/index.ts`) implemented for BE-04.

## Reusable authentication boundary (`_shared/auth.ts`)

Protected Edge Function handlers must authenticate incoming requests through `authenticateRequest(req, deps)` rather than parsing JWT claims manually or trusting client-supplied identifiers.

### Interface

```ts
export type AuthenticatedUser = {
  id: string;
  email: string | null;
  role: string | null;
};

export type AuthContext = {
  user: AuthenticatedUser;
  supabase: SupabaseClient;
};

export type AuthSuccess = {
  ok: true;
  context: AuthContext;
};

export type AuthFailure = {
  ok: false;
  response: Response;
};

export type AuthResult = AuthSuccess | AuthFailure;
```

### Security and RLS guarantees

1. **Bearer extraction and structural check:** `extractBearerToken(req)` requires an `Authorization: Bearer <jwt>` header (matching the `Bearer` scheme case-insensitively per RFC 6750/RFC 9110) containing a single compact three-segment JWS (`header.payload.signature`). Missing headers, unsupported schemes, extra segments, or empty credentials immediately return `401 Unauthorized` without network calls.
2. **Genuine token verification:** `authenticateRequest(req, deps)` verifies the extracted Bearer token against Supabase Auth (`supabase.auth.getUser(accessToken)`). Unverified JWT payloads are never trusted.
3. **Minimal trusted context:** On success, `authenticateRequest` returns only `context.user` (`id`, `email`, `role`) and `context.supabase`. The raw `accessToken` is not separately exposed on `AuthContext`.
4. **PostgreSQL RLS preservation:** `context.supabase` is constructed with the public anon/publishable key (`SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`) and sets `Authorization: Bearer <accessToken>` on outgoing requests. All subsequent PostgREST operations execute as the verified user so PostgreSQL Row Level Security (`auth.uid()`) remains active. Service-role credentials are never used for user-owned data operations.
5. **Caller override protection:** Downstream handlers must resolve ownership and identity exclusively from `auth.context.user.id` and ignore any `id`, `user_id`, `userId`, or custom identity headers supplied by the caller.

## Protected endpoint request (`GET /functions/v1/auth-session`)

- **Method and path:** `GET /functions/v1/auth-session`
- **Headers:** `Authorization: Bearer <supabase-access-token>`, `apikey: <supabase-anon-or-publishable-key>`
- **Query parameters:** none (any caller-supplied identity parameters are ignored)
- **Request body:** none
- **Access:** authenticated users only.

## Successful response

Return `200 OK` with `Content-Type: application/json`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`:

```json
{
  "user": {
    "id": "99999999-9999-9999-9999-999999999999",
    "email": "verified@morisscraps.local",
    "display_name": "Verified Chef",
    "avatar_url": null
  }
}
```

## Errors

Function errors use `Content-Type: application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and the standard error envelope:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authentication credentials."
  }
}
```

| HTTP status | Code | Message | When |
| --- | --- | --- | --- |
| `401 Unauthorized` | `UNAUTHORIZED` | `Missing or invalid Authorization header.` | The `Authorization` header is missing, empty, does not use the `Bearer` scheme (case-insensitive), has extra segments, or is not a three-part compact JWT. |
| `401 Unauthorized` | `UNAUTHORIZED` | `Invalid or expired authentication credentials.` | Supabase Auth explicitly identifies the user token as invalid, expired, malformed, revoked, or belonging to a nonexistent/unauthenticated user. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | `Only GET and OPTIONS methods are supported.` | A method other than `GET` or CORS preflight `OPTIONS` is used. Includes `Allow: GET, OPTIONS`. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | `Internal server error.` | Missing or invalid server configuration (`SUPABASE_URL` / `SUPABASE_ANON_KEY`), invalid server API key rejected by the upstream gateway, unrecognized upstream 4xx/5xx error, upstream Auth network failure, or database query failure. Never exposes tokens, secrets, upstream messages, or stack traces. |

## CORS behavior

Handles `OPTIONS` preflight before authentication so browser preflight requests succeed with `204 No Content` without requiring an `Authorization` header. Allows `GET, OPTIONS` and permits `authorization, x-client-info, apikey, content-type`.
