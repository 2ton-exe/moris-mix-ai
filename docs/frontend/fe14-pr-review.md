# FE-14 PR review notes

Target: `main`. Improves accessibility in authentication, AI Chef, deletion and recipe forms, including focus behavior and accessible status. The existing image component now has a name even when its heading is omitted. Main's image functionality and feature gate remain unchanged.

Image tests use synthetic responses. Before accepting live image behavior, verify private R2 access, ownership, replay, attachment, replacement and monitored staging and final cleanup in an authorized environment. Backend owners must review the security advisor warning about executable `handle_new_user` SECURITY DEFINER and mutable function search paths. No live image verification or comprehensive assistive-technology audit is claimed.

Validation: lint, type-check, build, 578 unit tests, and isolated authentication, recipe forms/delete and AI Chef browser suites passed on Windows. The build warns about a large JavaScript chunk. Linux local-Supabase E2E remains unverified: Windows native runtime is unsupported, and the PR workflow may migrate a configured hosted database whose target has not been established. Do not treat this branch as staging accepted until that check and live image verification are addressed.
