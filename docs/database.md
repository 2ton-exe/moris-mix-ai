# Database overview

Versioned SQL migrations in `supabase/migrations/` are the source of truth for the Supabase PostgreSQL schema. The application browser does not query these tables directly; it uses authenticated Edge Functions, and PostgreSQL row-level security remains enabled for user-owned data.

## Main tables

| Table | Key data | Relationship and access |
| --- | --- | --- |
| `profiles` | Auth user ID, display name, avatar URL, timestamps | One profile per `auth.users` row. Users can access their own profile. |
| `recipes` | Owner ID, title, raw input, notes, ingredients, instructions, flavor scores, rating, cooked date, image fields, timestamps | Owned by `user_id`. The `is_public` flag supports the approved demo row; it does not make the recipe collection public. Ingredient filters use generated text; combined searches use database-side ranking. |
| `recipe_lineage` | Parent recipe ID, child recipe ID, creation time | Both IDs reference recipes. Self-links and duplicate pairs are rejected; deletion cascades with either recipe. The API verifies that the caller owns the child and every parent. |
| `ai_usage_daily` | User ID, usage date, operation count | One counter per user and date. The backend owns quota updates. |
| `ai_quota_reservations` | User ID, daily usage ID, reservation status, refund details, timestamps | Internal reservation records support concurrent quota enforcement. Browser roles have no table access. |

## Private image lifecycle

The `recipes.image_path` column stores the internal final R2 object key after a verified attachment. It is omitted from recipe API responses. `image_url` is a separate recipe field; temporary signed upload and download URLs are not stored in it. The browser requests a short-lived download URL through the authenticated image API when it needs to display a private image.

| Tables | Purpose | Access and retention |
| --- | --- | --- |
| `recipe_image_upload_intents` | Binds an upload ID to its owner, recipe, staging/final keys, content type, byte size, expiry, and lifecycle state | RLS is enabled and forced; browser table privileges are revoked. There are deliberately no cascading user/recipe foreign keys, so cleanup records survive deletion. |
| `recipe_image_final_cleanup`, `recipe_image_finalization_attempts` | Queue finalized objects and record attempt keys, leases, retries, and cleanup outcomes | Internal lifecycle state used by narrowly scoped backend RPCs; not general recipe access. |
| `recipe_image_staging_reconciliation_state`, `recipe_image_staging_reconciliation_objects` | Persist cursor, lease, and per-object staging cleanup progress | Internal recovery state used by the cleanup handler; browser table privileges are revoked. |

Image upload intents allow JPEG, PNG, or WebP and at most 10 MiB. The authenticated Edge Function counts and verifies the raw request bytes before writing to private R2. Attachment rechecks recipe ownership and verifies the stored object before updating `image_path`. Image deletion clears the recipe association and queues object cleanup; the successful API response does not claim that physical R2 deletion has finished.

## Ownership boundary

- Supabase Auth provides the user identity. Protected handlers verify the Bearer token and derive `user_id` from that verified identity.
- Recipe and lineage operations use user-scoped database access with RLS. Client-supplied owner IDs and image object keys are not trusted.
- AI quota and image lifecycle mutations use backend-only operations where an atomic state transition is required. The service-role key is never sent to the browser or used for general recipe access.
- The demo API reads only the approved public demonstration recipe. Public demo access does not change ownership rules for saved recipes.

See the [architecture decision](architecture/sprint-1-adr.md) for request flow and the [API reference](api/README.md) for endpoint contracts.
