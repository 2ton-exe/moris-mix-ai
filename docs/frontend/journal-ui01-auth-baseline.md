# UI-01 Step 1 — existing authentication test failure

November 1, 2026. The full frontend run on `feat/UI-01-journal-redesign` reports
382 passing tests and this one failure:

`src/auth/AuthFlow.test.tsx:167`, “restores a valid session on a fresh mount and
allows protected access”: expected `auth.getSession` twice, observed four calls.

Reproduce from `frontend`:

```powershell
pnpm exec vitest run --configLoader runner --maxWorkers=1
```

This is the same failure previously documented and reproduced on `origin/main`
in [journal-review.md](journal-review.md) and the earlier journal shell handoff.
This milestone reproduced it; it did not perform a fresh checkout or change the
expectation to make it pass. Auth/session implementation is unchanged. Auth-page
changes in Step 1 are button presentation classes only.

The authentication browser suite passes restoration, protected return and
logout using isolated synthetic sessions/intercepted responses. That result
does not establish live Supabase acceptance. The separate local backend runner
cannot start its stack in this Windows subprocess environment, as detailed in
the [completion report](journal-ui01-step1.md).

The full run is retained in
[frontend-tests.log](../../frontend/test-results/ui01-step1/frontend-tests.log).

## Step 3A recheck

The November 1, 2026 Step 3A full run reports **400 passing tests and the same
one failure out of 401**: expected two `auth.getSession` calls, observed four at
`AuthFlow.test.tsx:167`. No authentication implementation or expectation was
changed for continuation pagination. The isolated auth browser acceptance suite
also passes. The latest [full test log](../../frontend/test-results/ui01-step3a/frontend-tests.log)
and [Step 3A report](journal-ui01-step3a.md) retain this failure separately from
the reading work.
