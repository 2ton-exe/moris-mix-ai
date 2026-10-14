# Demo recipe API contract

This contract is shared by the frontend API client (FE-02) and the read-only Edge Function (BE-03). The mock response is in [`fixtures/demo-recipe.json`](../../fixtures/demo-recipe.json).

## Request

- **Method and path:** `GET /functions/v1/demo-recipe`
- **Query parameters:** none
- **Request body:** none
- **Access:** public demo data only. Invoke through the configured Supabase client with the public anon key; a signed-in user is not required. Never expose a service-role key in the browser.

The function may return only the approved demonstration recipe. It must not return private user recipes, owner identifiers, or internal storage paths.

## Successful response

Return `200 OK` with `Content-Type: application/json`:

```json
{
  "recipe": {
    "id": "11111111-1111-1111-1111-111111111111",
    "title": "Classic Tomato Scraps Pasta",
    "ingredients": ["200g spaghetti", "2 tbsp tomato paste", "2 cloves garlic", "Fresh basil"],
    "instructions": [
      "Boil pasta in salted water.",
      "Saute minced garlic and tomato paste.",
      "Toss pasta with sauce and torn basil."
    ],
    "flavorScores": { "sweet": 2, "salty": 3, "sour": 3, "bitter": 1, "umami": 4 },
    "starRating": 4,
    "cookedAt": "2026-10-13"
  }
}
```

The `recipe` fields are required. `id` is a UUID string; `ingredients` and `instructions` are arrays of strings; `flavorScores` maps flavor names to numbers; `starRating` is an integer from 1 to 5 or `null`; and `cookedAt` is an ISO date (`YYYY-MM-DD`) or `null`. The date and other sample values are fixed in the fixture so mock responses are deterministic.

## Errors

Function errors use `Content-Type: application/json` and this shape:

```json
{
  "error": {
    "code": "DEMO_RECIPE_NOT_FOUND",
    "message": "Demo recipe is unavailable."
  }
}
```

| HTTP status | Code | When |
| --- | --- | --- |
| `404 Not Found` | `DEMO_RECIPE_NOT_FOUND` | The approved demo recipe is unavailable. |
| `405 Method Not Allowed` | `METHOD_NOT_ALLOWED` | A method other than `GET` or CORS preflight `OPTIONS` is used. Include `Allow: GET, OPTIONS`. |
| `500 Internal Server Error` | `INTERNAL_ERROR` | An unexpected server or data-source failure occurs. The message must not expose database details, secrets, or stack traces. |

Supabase gateway or network failures can occur before the function returns this envelope. The frontend must treat every non-2xx response or request failure as an error.

## CORS and frontend behavior

Handle `OPTIONS` as a CORS preflight for the configured frontend origin. Allow `GET` and `OPTIONS`, and permit the `apikey`, `authorization`, and `content-type` request headers.

The frontend shows a loading state while the request is pending, renders `recipe` on success, and shows a user-safe, retryable error state for HTTP, network, or response-parsing failures. It must not display raw server or database details.
