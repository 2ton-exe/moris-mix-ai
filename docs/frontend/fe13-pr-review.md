# FE-13 PR review notes

Target: `main`. Improves recoverable CRUD and AI errors, cooldowns and retained input, and gives stalled image preparation, reads and uploads a recovery path while retaining the current photo and upload intent. The image implementation and authenticated ingress from main remain in place. The image feature gate is unchanged.

Image tests use synthetic responses. Before accepting live image behavior, verify private R2 access, ownership, replay, attachment, replacement and monitored staging and final cleanup in an authorized environment. Backend owners must review the security advisor warning about executable `handle_new_user` SECURITY DEFINER and mutable function search paths. No live image verification is claimed.

Validation: lint, type-check, build, 602 unit tests, and isolated recipe journal, forms/delete, Quick AI and AI Chef browser suites passed on Windows. The build warns about a large JavaScript chunk. Linux local-Supabase E2E remains unverified: Windows native runtime is unsupported, and the PR workflow may migrate a configured hosted database whose target has not been established. Do not treat this branch as staging accepted until that check and live image verification are addressed.
