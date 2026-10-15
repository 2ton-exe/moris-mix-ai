# Demo recipe API contract

This contract is shared by the frontend API client (FE-02) and the read-only Edge Function (BE-03). The mock response is in [`fixtures/demo-recipe.json`](../../fixtures/demo-recipe.json).

The fields and property names below define the response contract. Recipe fields retain their database `snake_case` names (`flavor_scores`, `star_rating`, and `cooked_at`); nested ingredient objects may also include `quantityText`.

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
    "ingredients": [
      { "name": "spaghetti", "quantity": 200, "unit": "g", "inferred": false },
      { "name": "tomato paste", "quantity": 2, "unit": "tbsp", "inferred": false },
      { "name": "garlic", "quantity": 2, "unit": "cloves", "inferred": false },
      { "name": "Fresh basil", "quantity": null, "unit": null, "inferred": false }
    ],
    "instructions": [
      { "step": 1, "text": "Boil pasta in salted water." },
      { "step": 2, "text": "Saute minced garlic and tomato paste." },
      { "step": 3, "text": "Toss pasta with sauce and torn basil." }
    ],
    "flavor_scores": { "sweet": 2, "salty": 3, "sour": 3, "bitter": 1, "umami": 4, "spicy": 0 },
    "star_rating": 4,
    "cooked_at": "2026-10-13"
  }
}
```

The `recipe` fields are required. `id` is a UUID string. Each ingredient has `name` (string), `quantity` (number or `null`), `unit` (string or `null`), and `inferred` (boolean, defaulting to `false`); it may also have `quantityText` (string). Each instruction has `step` (number) and `text` (string). `flavor_scores` is required in this response and contains all six shared flavor properties (`sweet`, `salty`, `sour`, `bitter`, `umami`, and `spicy`), each a number from 0 to 5. `star_rating` is an integer from 1 to 5 or `null`; `cooked_at` is an ISO date (`YYYY-MM-DD`) or `null`. The sample values are fixed in the fixture so mock responses are deterministic.

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

Handle `OPTIONS` as a CORS preflight for the configured frontend origin. Allow `GET` and `OPTIONS`, and permit the `apikey`, `authorization`, `content-type`, and `x-client-info` request headers.

The frontend shows a loading state while the request is pending, renders `recipe` on success, and shows a user-safe, retryable error state for HTTP, network, or response-parsing failures. It must not display raw server or database details.
