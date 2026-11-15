# API reference

The authenticated API runs through Supabase Edge Functions. Handlers verify the user's access token and derive ownership server-side; the public demo route is the exception. The endpoint contracts describe request/response shapes, access rules, errors, and CORS behavior.

- [Recipe CRUD, search, pagination, and lineage](recipes.md)
- [Authentication and session](auth-session.md)
- [Public demo recipe](demo-recipe.md)
- [AI extraction, generation, quotas, and candidate lineage](ai-integration.md)
- [Private recipe-image upload, attachment, reads, and deletion](recipe-images.md)

The [database overview](../database.md) describes the persisted fields and ownership boundaries. Recipe image signing and cleanup handlers exist in the repository, while production signing and cleanup remain disabled pending separate readiness verification and authorization.
