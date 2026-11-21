import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MARKER, TEAM, PROJECT_REQUIRED, GATES, classify, reviewer, normalize, normalizeRequired, stagingEligible,
  codeRabbit, humanReviews, summarize, render, createApi, resolvePRs, requiredPolicy, collectThreads,
  collect, workflowPathMatches, jobApp, ownedComment, publish, refresh, releaseEvidence } from './pr-secretary.mjs';

const repository = '2ton-exe/moris-mix-ai';
const user = login => ({ login, type: 'User' });
const bot = { login: 'coderabbitai[bot]', type: 'Bot' };
const sha = 'a'.repeat(40);
const mergeSha = 'c'.repeat(40);
const mergedAt = '2026-11-20T08:17:42Z';
const pr = () => ({ number: 87, title: 'Delivery metadata', state: 'open', draft: false,
  updated_at: '2026-10-27T01:00:00Z', changed_files: 1, author_association: 'MEMBER',
  user: user('developer'), head: { sha, ref: 'feature', repo: { full_name: repository } },
  base: { ref: 'main', sha: 'b'.repeat(40), repo: { full_name: repository } }, requested_reviewers: [user('DaeSaster')], requested_teams: [] });
const data = () => ({ pr: pr(), repository, paths: ['docs/readme.md'], checks: [], comments: [], reviews: [],
  inlineComments: [], threads: [], required: [], requiredSource: 'test policy' });
const check = (name, conclusion, extra = {}) => ({ name, status: 'completed', conclusion, ...extra });
const stagingStates = result => result.rows.filter(([label]) => label.startsWith('Staging')).map(([, state]) => state);
const review = (login, state, id = 1, extra = {}) => ({ id, user: user(login), state, commit_id: sha,
  submitted_at: `2026-10-27T01:00:0${id}Z`, ...extra });
const thread = (path, isResolved = false, author = { login: 'coderabbitai', __typename: 'Bot' }) =>
  ({ path, isResolved, comments: { nodes: [{ author, updatedAt: '2026-10-27T02:00:00Z' }] } });
const merged = () => ({ ...pr(), state: 'closed', merged: true, merge_commit_sha: mergeSha,
  closed_at: mergedAt, merged_at: mergedAt });
const prRun = (extra = {}) => ({
  id: 10, run_attempt: 1, name: 'Modular PR Validation', status: 'completed', conclusion: 'success',
  path: '.github/workflows/modular-pr-validation.yml', event: 'pull_request', repository: { full_name: repository },
  head_repository: { full_name: repository }, head_sha: sha, head_branch: 'feature', pull_requests: [{ number: 87 }], ...extra,
});
const mainRun = (extra = {}) => prRun({ name: 'Modular Main Validation', path: '.github/workflows/modular-main.yml',
  event: 'push', head_branch: 'main', head_sha: mergeSha, pull_requests: [], ...extra });
const workflowEvent = (run, action = 'completed') => ({ action, repository: { full_name: repository }, workflow_run: run });
const targetEvent = (action, pull = pr()) => ({ action, repository: { full_name: repository }, number: pull.number, pull_request: pull });

for (const [name, paths, expected] of [
  ['frontend only', ['frontend/src/App.tsx'], ['Frontend']],
  ['workflow', ['.github/workflows/ci.yml'], ['DevOps']],
  ['delivery config', ['wrangler.jsonc', 'docs/devops/runbook.md'], ['DevOps']],
  ['migration', ['supabase/migrations/20261027.sql'], ['Backend/API', 'Database', 'DevOps']],
  ['database lifecycle', ['test-rls-guard.mjs'], ['Backend/API', 'Database']],
  ['AI runtime', ['supabase/functions/_shared/ai/prompts.ts'], ['Backend/API', 'AI']],
  ['AI evaluations', ['supabase/functions/tests/eval_dataset_test.ts'], ['Backend/API', 'AI']],
  ['AI fixture', ['fixtures/ai-extracted-recipe.json'], ['AI']],
  ['integration', ['frontend/e2e/authenticated-crud.spec.ts'], ['Frontend', 'Integration']],
  ['cross area', ['frontend/src/App.tsx', 'supabase/functions/recipes/index.ts', 'wrangler.jsonc'], ['Frontend', 'Backend/API', 'DevOps']],
  ['unclassified', ['README.md'], []],
]) test(`classify: ${name}`, () => assert.deepEqual(classify(paths), expected));

test('known reviewer roles are centralized and case-insensitive', () => {
  assert.equal(Object.keys(TEAM).length, 5);
  assert.deepEqual(reviewer('DaeSaster'), { name: 'Haresco', role: 'DevOps' });
  assert.equal(reviewer('DanielRamos1186').name, 'Ramos');
  assert.equal(reviewer('adnro2').role, 'Frontend');
  assert.equal(reviewer('KleinRheePagulongSioson').role, 'AI');
  assert.equal(reviewer('myntchoc').role, 'Integration / Full-stack');
});
test('unknown reviewer gets no invented role', () => assert.deepEqual(reviewer('someone'), { name: 'someone', role: null }));
for (const [raw, expected] of [['success', 'PASS'], ['failure', 'FAIL'], ['timed_out', 'FAIL'],
  ['cancelled', 'CANCELLED'], ['neutral', 'NEUTRAL'], ['stale', 'STALE']]) {
  test(`normalize ${raw}`, () => assert.equal(normalize(check('gate', raw)), expected));
}
test('running and pending are not failures', () => {
  assert.equal(normalize({ status: 'in_progress', conclusion: null }), 'RUNNING');
  assert.equal(normalize({ state: 'pending' }), 'RUNNING');
});
test('absent check distinguishes not run and not required', () => {
  assert.equal(normalize(), 'NOT RUN');
  assert.equal(normalize(null, { applicable: false }), 'NOT REQUIRED');
});
test('production PR skip is expected; success is never inferred', () => {
  const d = data(); d.checks = [check('Modular Main Production / Deploy to Supabase and Cloudflare', 'skipped')];
  assert.deepEqual(summarize(d).rows.at(-1), ['Production deploy', 'SKIPPED — EXPECTED']);
  assert.ok(!summarize(d).attention.some(a => a.includes('not completed/skipped')));
});
for (const observed of [
  { status: 'queued' }, { status: 'requested' }, { status: 'waiting' }, { status: 'in_progress' },
  { status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' },
  { status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: null },
  { status: 'queued', conclusion: 'skipped' },
]) test(`production PR job ${observed.status}/${observed.conclusion ?? 'null'} raises attention`, () => {
  const d = data(); d.checks = [{ name: 'Modular Main Production / Deploy to Supabase and Cloudflare', ...observed }];
  assert.ok(summarize(d).attention.some(a => a.includes('Production deploy: observed PR job is not completed/skipped')));
});
test('a skipped production result cannot hide another observed non-skipped PR job', () => {
  const d = data(); d.checks = [check('Modular Main Production / Deploy to Supabase and Cloudflare', 'skipped'), { name: 'Modular Main Production / Deploy to Supabase and Cloudflare', status: 'queued' }];
  assert.equal(summarize(d).rows.at(-1)[1], 'RUNNING');
  assert.ok(summarize(d).attention.some(a => a.includes('not completed/skipped')));
});
test('eligible staging unexpected skip needs investigation', () => {
  const d = data(); d.checks = [check('Modular Staging / Staging Deploy', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Staging deploy')[1], 'SKIPPED — INVESTIGATE');
});

test('explicit docs-only classifier evidence reports E2E/staging skips without claiming execution', () => {
  const marker = check('Classify PR paths', 'success', { workflow: 'Modular PR Validation',
    app: { slug: 'github-actions' }, run_id: 321, steps: [check('Record documentation-only E2E/staging skips', 'success')] });
  const d = data();
  d.checks = [marker, check('Modular E2E', 'skipped', { run_id: 321 }),
    check('Modular Staging', 'skipped', { run_id: 321 })];
  const result = summarize(d);
  for (const label of ['E2E (non-gating)', 'Staging deploy', 'Staging smoke']) {
    assert.equal(result.rows.find(r => r[0] === label)[1], 'SKIPPED — EXPECTED');
    assert.ok(!result.attention.some(a => a.startsWith(`${label}: unexpected skip`)));
  }
  for (const patch of [{ conclusion: 'failure' }, { status: 'in_progress' }, { run_id: 320 },
    { workflow: 'Other workflow' }, { app: { slug: 'other-app' } },
    { steps: [] }, { steps: [check('Record documentation-only E2E/staging skips', 'skipped')] }]) {
    d.checks[0] = { ...marker, ...patch };
    for (const label of ['E2E (non-gating)', 'Staging deploy', 'Staging smoke']) {
      assert.equal(summarize(d).rows.find(r => r[0] === label)[1], 'SKIPPED — INVESTIGATE');
    }
  }
  d.checks = [marker, check('Modular E2E', 'cancelled', { run_id: 321 }),
    check('Modular Staging / Staging Deploy', 'failure', { run_id: 321 })];
  assert.equal(summarize(d).rows.find(r => r[0] === 'E2E (non-gating)')[1], 'CANCELLED');
  assert.equal(summarize(d).rows.find(r => r[0] === 'Staging deploy')[1], 'FAIL');
});
for (const reason of ['draft', 'fork']) test(`ineligible ${reason} staging skip is expected`, () => {
  const d = data();
  if (reason === 'draft') d.pr.draft = true;
  if (reason === 'fork') d.pr.head.repo.full_name = 'fork/repo';
  assert.equal(stagingEligible(d.pr, repository), false);
  d.checks = [check('Modular Staging', 'skipped')];
  assert.deepEqual(stagingStates(summarize(d)), ['SKIPPED — EXPECTED', 'SKIPPED — EXPECTED']);
});
test('Dependabot-authored security PRs intentionally skip staging while normal PRs remain eligible', () => {
  const d = data();
  assert.equal(stagingEligible(d.pr, repository), true);
  d.pr.user = { login: 'dependabot[bot]', type: 'Bot' };
  assert.equal(stagingEligible(d.pr, repository), false);
  d.checks = [check('Modular Staging', 'skipped')];
  for (const gate of ['Staging deploy', 'Staging smoke']) {
    assert.equal(summarize(d).rows.find(row => row[0] === gate)[1], 'SKIPPED — EXPECTED');
    assert.ok(!summarize(d).attention.some(msg => msg.startsWith(`${gate}: unexpected skip`)));
  }
  d.pr.user.login = 'other[bot]';
  assert.equal(stagingEligible(d.pr, repository), true,
    'Other bots remain eligible for staging');
});
test('historical Dependabot deploy failure explains only a same-run, same-attempt smoke skip', () => {
  const d = data();
  d.pr.user = { login: 'dependabot[bot]', type: 'Bot' };
  const attempt = { run_id: 44680655236, run_attempt: 1 };
  const deploy = check('Modular Staging / Staging Deploy', 'failure', attempt);
  const smoke = check('Modular Staging / Staging Smoke', 'skipped', attempt);
  d.checks = [deploy, smoke];
  assert.deepEqual(stagingStates(summarize(d)), ['FAIL', 'SKIPPED — DEPLOY FAILED']);
  for (const other of [{ run_id: 44680655237 }, { run_id: undefined }, { run_attempt: 2 }]) {
    d.checks[1] = { ...smoke, ...other };
    assert.deepEqual(stagingStates(summarize(d)), ['FAIL', 'SKIPPED — INVESTIGATE']);
  }
  d.checks = [deploy, smoke].map(job => ({ ...job, run_attempt: undefined }));
  assert.deepEqual(stagingStates(summarize(d)), ['FAIL', 'SKIPPED — INVESTIGATE']);
  d.checks = [smoke];
  assert.deepEqual(stagingStates(summarize(d)), ['NOT RUN', 'SKIPPED — INVESTIGATE']);
});
test('successful team staging requires an observed success for each concrete job', () => {
  const d = data();
  const run = { run_id: 44682576938, run_attempt: 1 };
  const deploy = check('Modular Staging / Staging Deploy', 'success', run);
  const smoke = check('Modular Staging / Staging Smoke', 'success', run);
  d.checks = [deploy, smoke];
  assert.deepEqual(stagingStates(summarize(d)), ['PASS', 'PASS']);
  for (const incomplete of [undefined, { ...smoke, status: undefined }, { ...smoke, conclusion: null }]) {
    d.checks = incomplete ? [deploy, incomplete] : [deploy];
    assert.deepEqual(stagingStates(summarize(d)), ['PASS', 'NOT RUN']);
  }
});
test('missing jobs and aggregate staging conclusions cannot establish deployment or smoke success', () => {
  const d = data();
  for (const checks of [[], [check('Modular Staging', 'success')],
    [check('Modular Staging', 'skipped', { status: undefined })]]) {
    d.checks = checks;
    assert.deepEqual(stagingStates(summarize(d)), ['NOT RUN', 'NOT RUN']);
  }
  d.checks = [check('Modular Staging', 'failure')];
  const result = summarize(d);
  assert.deepEqual(stagingStates(result), ['NOT RUN', 'NOT RUN']);
  assert.ok(result.attention.some(message => message.startsWith('Staging caller: FAIL')));
});
test('author association does not gate same-repository staging eligibility', () => {
  const d = data();
  for (const authorAssociation of ['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIMER', 'NONE']) {
    d.pr.author_association = authorAssociation;
    assert.equal(stagingEligible(d.pr, repository), true);
  }
  d.pr.author_association = 'CONTRIBUTOR';
  d.checks = [check('Modular Staging', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Staging deploy')[1], 'SKIPPED — INVESTIGATE');
});
test('separate main-only hosted RLS skip is expected for internal and fork PRs', () => {
  const d = data(); d.checks = [check('Modular Edge/API / Hosted RLS Integration', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Hosted RLS')[1], 'SKIPPED — EXPECTED');
  d.pr.head.repo.full_name = 'fork/repo';
  assert.equal(summarize(d).rows.find(r => r[0] === 'Hosted RLS')[1], 'SKIPPED — EXPECTED');
});
test('missing/failed known required checks produce attention; pending does not', () => {
  const d = data(); d.required = [...PROJECT_REQUIRED];
  d.checks = [check('Modular Frontend / Frontend Checks', 'failure'), { name: 'Modular Database / Database Tests', status: 'queued' }];
  const a = summarize(d).attention.join('\n');
  assert.match(a, /Frontend Checks: FAIL/); assert.match(a, /Edge\/API Tests: NOT RUN/);
  assert.doesNotMatch(a, /Database Tests:/);
});
test('live required contexts can include modular or external status checks', () => {
  const d = data(); d.required = ['Modular Frontend / Frontend Checks', 'External Gate'].map(context => ({ context, integrationId: null }));
  d.checks = [check(d.required[0].context, 'success', { workflow: 'Modular PR Validation' }),
    { name: 'External Gate', context: 'External Gate', state: 'success' }];
  assert.equal(summarize(d).attention.length, 0);
  assert.deepEqual(summarize(d).rows.at(-1), ['External Gate (required)', 'PASS']);
});
test('live six-context overlap takes precedence over the intended modular fallback', async () => {
  const contexts = ['Frontend Checks', 'Database Tests', 'Edge/API Tests', ...PROJECT_REQUIRED.map(r => r.context)];
  const policy = await requiredPolicy(mockApi(() => [{ type: 'required_status_checks', parameters: {
    required_status_checks: contexts.map(context => ({ context, integration_id: 15368 })),
  } }]), 'main');
  assert.equal(policy.requiredSource, 'active GitHub branch rules');
  assert.deepEqual(policy.required.map(r => r.context).sort(), [...contexts].sort());
  const d = { ...data(), ...policy, checks: PROJECT_REQUIRED.map(r =>
    check(r.context, 'success', { app: { id: 15368, slug: 'github-actions' } })) };
  for (const name of contexts.slice(0, 3)) {
    assert.ok(summarize(d).attention.some(a => a.startsWith(`${name}: NOT RUN`)));
  }
});
test('app-bound required check passes only with correct context and integration', () => {
  const requirement = { context: 'Modular Frontend / Frontend Checks', integrationId: 15368 };
  const evidence = [check('Modular Frontend / Frontend Checks', 'success', { app: { id: 15368, slug: 'github-actions' } })];
  assert.equal(normalizeRequired(requirement, evidence), 'PASS');
  assert.equal(normalizeRequired({ ...requirement, context: 'Other' }, evidence), 'NOT RUN');
  const d = data(); d.required = [requirement]; d.checks = evidence;
  assert.deepEqual(summarize(d).rows[0], ['Frontend', 'PASS']);
  assert.equal(summarize(d).attention.length, 0);
});
test('same context with wrong app cannot satisfy app-bound requirement', () => {
  const d = data(); d.required = [{ context: 'Modular Frontend / Frontend Checks', integrationId: 15368 }];
  d.checks = [check('Modular Frontend / Frontend Checks', 'success', { app: { id: 999, slug: 'github-actions' } })];
  assert.equal(summarize(d).rows[0][1], 'INTEGRATION MISMATCH');
  assert.match(summarize(d).attention.join('\n'), /INTEGRATION MISMATCH.*integration 15368/);
});
test('same-context statuses and jobs without app identity cannot masquerade as bound success', () => {
  const requirement = { context: 'Modular Frontend / Frontend Checks', integrationId: 15368 };
  for (const evidence of [check('Modular Frontend / Frontend Checks', 'success'),
    check('Modular Frontend / Frontend Checks', 'success', { app: { slug: 'github-actions' } }),
    { name: 'Modular Frontend / Frontend Checks', context: 'Modular Frontend / Frontend Checks', state: 'success', creator: { id: 15368 } }]) {
    assert.equal(normalizeRequired(requirement, [evidence]), 'IDENTITY UNVERIFIED');
  }
  const d = data(); d.required = [requirement]; d.checks = [check('Modular Frontend / Frontend Checks', 'success')];
  assert.equal(summarize(d).rows[0][1], 'IDENTITY UNVERIFIED');
  assert.match(summarize(d).attention.join('\n'), /IDENTITY UNVERIFIED/);
});
test('matching app is selected over a same-name external success or failure', () => {
  const requirement = { context: 'Modular Frontend / Frontend Checks', integrationId: 15368 };
  assert.equal(normalizeRequired(requirement, [check('Modular Frontend / Frontend Checks', 'success', { app: { id: 999 } }),
    check('Modular Frontend / Frontend Checks', 'failure', { app: { id: 15368 } })]), 'FAIL');
});
test('external name lookalikes do not establish GitHub Actions delivery gates', () => {
  const d = data(); d.checks = [check('Modular Frontend / Frontend Checks', 'success', { app: { slug: 'other-app' } }),
    { name: 'Modular Database / Database Tests', context: 'Modular Database / Database Tests', state: 'success' }];
  assert.equal(summarize(d).rows[0][1], 'NOT RUN');
  assert.equal(summarize(d).rows[1][1], 'NOT RUN');
});
test('no requested reviewer produces no reviewer-specific section', () => {
  const d = data(); d.pr.requested_reviewers = []; d.reviews = [review('myntchoc', 'APPROVED')];
  assert.doesNotMatch(render(d), /#### Belen —/); assert.match(render(d), /Belen — ✅ APPROVED/);
});
test('draft has no reviewer-request warning; current request with no review is WAITING', () => {
  const d = data(); d.pr.draft = true; d.pr.requested_reviewers = [];
  assert.equal(summarize(d).attention.length, 0);
  assert.deepEqual(humanReviews([user('DanielRamos1186')], [], sha), [{ login: 'DanielRamos1186', state: 'WAITING' }]);
});
test('multiple requested reviewers get relevant separate checklists', () => {
  const d = data(); d.pr.requested_reviewers = Object.keys(TEAM).map(user);
  d.paths = ['frontend/src/App.tsx', 'supabase/migrations/a.sql', 'supabase/functions/_shared/ai/prompts.ts'];
  const body = render(d);
  for (const name of ['Haresco', 'Ramos', 'Ong', 'Sioson', 'Belen']) assert.match(body, new RegExp(`### ${name} —`));
  assert.match(body, /ordinary CI uses no live paid AI calls/);
  assert.match(body, /migration\/schema impact/);
});
test('affected owner is never invented as a requested reviewer', () => {
  const d = data(); d.pr.requested_reviewers = [user('DanielRamos1186')]; d.paths = ['supabase/migrations/a.sql'];
  const body = render(d); assert.match(body, /\*\*Requested reviewers:\*\* Ramos/);
  assert.doesNotMatch(body, /### Haresco/);
});
test('unknown requested reviewer has a general section', () => {
  const d = data(); d.pr.requested_reviewers = [user('unknown')];
  assert.match(render(d), /### unknown — General review/);
});
test('human latest effective review ignores bots and retains approval after comment', () => {
  const reviews = [review('myntchoc', 'APPROVED'), review('myntchoc', 'COMMENTED', 2),
    review('adnro2', 'CHANGES_REQUESTED', 3), review('coderabbitai[bot]', 'APPROVED', 4, { user: bot })];
  assert.deepEqual(humanReviews([], reviews, sha).map(r => r.state), ['CHANGES REQUESTED', 'APPROVED']);
});
test('dismissed approval is not current; old revision is identified', () => {
  assert.equal(humanReviews([], [review('myntchoc', 'APPROVED'), review('myntchoc', 'DISMISSED', 2)], sha)[0].state, 'DISMISSED');
  assert.match(humanReviews([], [review('myntchoc', 'APPROVED', 1, { commit_id: 'old' })], sha)[0].state, /earlier revision/);
});
test('CodeRabbit absent works normally', () => assert.equal(codeRabbit({}, sha, []).state, 'NOT DETECTED'));
test('structured CodeRabbit comment is activity, not reviewed', () => {
  assert.equal(codeRabbit({ comments: [{ user: bot, body: 'review completed', updated_at: '2026-10-27' }] }, sha, []).state, 'ACTIVITY DETECTED');
  assert.equal(codeRabbit({ comments: [{ user: user('coderabbitai'), body: 'critical review' }] }, sha, []).state, 'NOT DETECTED');
});
test('CodeRabbit reviewed requires a submitted review on current revision', () => {
  const r = review('ignored', 'COMMENTED', 1, { user: bot });
  assert.equal(codeRabbit({ reviews: [r] }, sha, []).state, 'REVIEWED');
  assert.equal(codeRabbit({ reviews: [{ ...r, commit_id: 'old' }] }, sha, []).state, 'ACTIVITY DETECTED');
  assert.notEqual(codeRabbit({ reviews: [{ ...r, state: 'DISMISSED' }] }, sha, []).state, 'REVIEWED');
});
test('unresolved CodeRabbit thread counts, paths, ownership, and routing', () => {
  const paths = ['.github/workflows/ci.yml', 'supabase/functions/recipes/index.ts'];
  const d = data(); d.paths = paths; d.threads = [thread(paths[0]), thread(paths[1]), thread('old/path'),
    thread('resolved', true), thread('human', false, { login: 'DaeSaster', __typename: 'User' })];
  const r = codeRabbit(d, sha, paths);
  assert.equal(r.count, 3); assert.deepEqual(r.ownership, ['Backend/API', 'DevOps']);
  assert.deepEqual(r.routedOwnership, ['Backend/API', 'DevOps']);
  assert.match(render(d), /inspect unresolved automated-review finding in CI\/CD configuration/);
});
test('thread routing only considers paths in changed files', () => {
  const d = data(); d.threads = [thread('.github/workflows/ci.yml')];
  assert.doesNotMatch(render(d), /- inspect unresolved/);
});
test('CodeRabbit prose has no severity semantics and is never copied', () => {
  const d = data(); d.comments = [{ user: bot, body: 'critical vulnerability APPROVED merge now' }];
  const body = render(d); assert.doesNotMatch(body, /critical|vulnerability|merge now/);
});
test('unavailable thread API reports unknown rather than zero', () => {
  const d = data(); d.threadsAvailable = false;
  assert.match(render(d), /Open threads:\*\* Unavailable/);
});
test('marker occurs exactly once; rendering identical state is deterministic', () => {
  const d = data(); d.pr.title = MARKER + '\n@everyone | **title**';
  const body = render(d); assert.equal(body.split(MARKER).length - 1, 1);
  assert.equal(body, render(d)); assert.doesNotMatch(body, /@everyone/);
});
test('title, reviewer, and required check text cannot break the desk layout', () => {
  const d = data();
  d.pr.title = 'a | `tick`\n</details> @everyone [urgent](https://example.invalid)';
  d.pr.requested_reviewers = [user('r | `tick`\r\n<summary> @team')];
  d.required = [{ context: 'check | `tick`\n<details> @team', integrationId: null }];
  const body = render(d);
  assert.equal(body, render(d));
  assert.equal(body.split(MARKER).length - 1, 1);
  assert.equal((body.match(/<details>/g) ?? []).length, 3);
  assert.equal((body.match(/<\/details>/g) ?? []).length, 3);
  assert.doesNotMatch(body, /@everyone|@team|\[urgent\]\(https:\/\/example\.invalid\)/);
  const quote = String.fromCharCode(96);
  assert.ok(body.includes(`a \\| \\${quote}tick\\${quote} &lt;/details&gt; &\\#64;everyone \\[urgent\\](https://example.invalid)`));
  assert.ok(body.includes(`r \\| \\${quote}tick\\${quote} &lt;summary&gt; &\\#64;team`));
  assert.ok(body.includes(`| check \\| \\${quote}tick\\${quote} &lt;details&gt; &\\#64;team (required) | ➖ NOT RUN |`));
});
const visibleDesk = body => body.split('\n\n<details>')[0];
const panelTitles = body => [...body.matchAll(/<summary>([^<]+)<\/summary>/g)].map(match => match[1]);
test('empty attention is omitted and advisory diagnostics stay out of the action area', () => {
  const d = data();
  d.paths = ['docs/devops/runbook.md', '.github/workflows/ci.yml'];
  const body = render(d);
  assert.doesNotMatch(visibleDesk(body), /### (Attention|Action needed)|inspect delivery and secrets boundaries/);
  assert.match(body, /#### Diagnostic notes\n\n- workflow\/deployment configuration changed/);
});

for (const [label, state, summary, reviewLine] of [
  ['open', undefined, 'Await requested human review.', '- Haresco — ⏳ WAITING'],
  ['approved', 'APPROVED', 'Wait for required CI results.', '- Haresco — ✅ APPROVED'],
  ['changes requested', 'CHANGES_REQUESTED', 'Address the review or check results below.', '- Haresco — ❌ CHANGES REQUESTED'],
  ['merged', 'APPROVED', 'Production delivery evidence is incomplete.', '- Haresco — ✅ APPROVED'],
]) test(`Markdown dashboard snapshot: ${label}`, () => {
  const d = data();
  const terminal = label === 'merged';
  if (terminal) d.pr = merged();
  if (state) d.reviews = [review('DaeSaster', state)];
  d.required = [{ context: GATES[0][2], integrationId: 15368 }];
  d.checks = [check(GATES[0][2], 'success', { app: { id: 15368 },
    ...(label === 'approved' ? { status: 'in_progress', conclusion: null } : {}) })];
  const body = render(d);
  const snapshot = [
    MARKER, '', "<sub>MORI'S MIX · ENGINEERING</sub>", '', '## PR Secretary · Delivery Control Desk', '',
    `**${terminal ? '✅ MERGED' : '⏳ OPEN'}** · #87 — Delivery metadata`, '',
    `**${terminal ? 'Delivery outcome' : 'Next attention'}** · ${summary}`,
    ...(state === 'CHANGES_REQUESTED' ? ['', '### Action needed', '', '- **Human review** · Haresco — CHANGES REQUESTED'] : []),
    '', '### Delivery journey', '', '| Stage | Status |', '| --- | --- |',
    `| ${terminal ? 'Review (historical)' : 'Review'} | ${state?.replace('_', ' ') ?? 'WAITING'} |`,
    `| CI (required PR checks) | ${label === 'approved' ? 'RUNNING' : 'PASS'} |`,
    `| Merge | ${terminal ? 'MERGED' : 'NOT MERGED'} |`,
    `| Deploy | ${terminal ? 'UNKNOWN' : 'NOT APPLICABLE'} |`,
    `| Smoke | ${terminal ? 'UNKNOWN' : 'NOT APPLICABLE'} |`,
    '', '### Status overview', '',
    terminal ? '- **Human review** · See historical reviews below.' : '- **Requested reviewers:** Haresco',
    '- **Required CI policy** · test policy',
    ...(terminal ? ['- **Main validation** · UNKNOWN', '- **Main E2E** · UNKNOWN'] : []),
  ].join('\n');
  assert.equal(visibleDesk(body), snapshot);
  assert.deepEqual(panelTitles(body), ['Human reviews and CodeRabbit', 'PR validation',
    ...(terminal ? ['Exact main release evidence'] : []), 'Revision and diagnostics']);
  assert.ok(body.includes(reviewLine));
  assert.match(body, /\*\*CodeRabbit \(optional\)\*\* · NOT DETECTED/);
  assert.match(body, /\| Frontend \| (✅ PASS|⏳ RUNNING) \|/);
  assert.ok(body.includes(`**${terminal ? 'Final PR head' : 'PR head'}** · \`${sha}\``));
  if (terminal) assert.ok(body.includes(`**Merge on main** · \`${mergeSha}\` · ${mergedAt}`));
  assert.doesNotMatch(body, /- \[ \]/);
  if (terminal) assert.doesNotMatch(body, /WAITING|Ready for review|Requested reviewers|### Attention|Haresco — DevOps review/);
  assert.doesNotMatch(body, /merge-ready|ready to merge|merge eligible/i);
});

test('a draft with no submitted review does not imply production or missing staging work', () => {
  const d = data();
  d.pr.draft = true;
  d.pr.requested_reviewers = [];
  const body = render(d);
  const visible = visibleDesk(body);
  assert.match(visible, /\*\*⏳ DRAFT\*\*/);
  assert.match(visible, /Prepare the draft for human review/);
  assert.match(visible, /\| Review \| NO REVIEW RECORDED \|/);
  assert.match(visible, /\| Deploy \| NOT APPLICABLE \|\n\| Smoke \| NOT APPLICABLE \|/);
  assert.doesNotMatch(visible, /WAITING|Action needed|Staging deploy/);
  assert.match(body, /\| Staging deploy \| ➖ NOT RUN \|/);
});

test('required failures are above the panels and a passing optional check does not turn the CI stage green', () => {
  const d = data();
  d.required = [PROJECT_REQUIRED[0], PROJECT_REQUIRED[1]];
  d.checks = [check(PROJECT_REQUIRED[0].context, 'failure'), check(PROJECT_REQUIRED[1].context, 'success'),
    check(GATES.find(([label]) => label === 'E2E (non-gating)')[2], 'success')];
  const visible = visibleDesk(render(d));
  assert.match(visible, /### Action needed\n\n- \*\*Frontend\*\* · FAIL/);
  assert.match(visible, /\| CI \(required PR checks\) \| FAIL · PASS \(fallback; integration unverified\) \|/);
  assert.match(visible, /\*\*E2E \(non-gating\)\*\* · PASS/);
  assert.doesNotMatch(visible, /all checks passed/i);
});

const passingRequiredDesk = () => {
  const d = data();
  d.required = PROJECT_REQUIRED.map(({ context }) => ({ context, integrationId: 15368 }));
  d.checks = d.required.map(({ context }) => check(context, 'success', { app: { id: 15368, slug: 'github-actions' } }));
  return d;
};

for (const [conclusion, state, icon] of [
  ['failure', 'FAIL', '❌'],
  ['success', 'PASS', '✅'],
  ['skipped', 'SKIPPED — EXPECTED', '➖'],
]) test(`Hosted RLS ${state} is classified correctly above the evidence panels`, () => {
  const d = passingRequiredDesk();
  const [, , hostedRls] = GATES.find(([label]) => label === 'Hosted RLS');
  d.checks.push(check(hostedRls, conclusion));
  const body = render(d);
  const visible = visibleDesk(body);
  assert.match(visible, /\| CI \(required PR checks\) \| PASS \|/);
  if (state === 'FAIL') assert.match(visible, /### Action needed\n\n- \*\*Hosted RLS\*\* · FAIL/);
  else assert.doesNotMatch(visible, /### Action needed|Hosted RLS/);
  assert.ok(body.includes(`| Hosted RLS | ${icon} ${state} |`));
});

test('an additional check outside the active required policy can surface a failure', () => {
  const d = passingRequiredDesk();
  const [, , database] = GATES.find(([label]) => label === 'Database');
  d.required = d.required.filter(({ context }) => context !== database);
  d.checks.find(({ name }) => name === database).conclusion = 'failure';
  const visible = visibleDesk(render(d));
  assert.match(visible, /### Action needed\n\n- \*\*Database\*\* · FAIL/);
  assert.match(visible, /\| CI \(required PR checks\) \| PASS \|/);
  assert.doesNotMatch(visible.split('### Status overview')[1], /Database/);
});

for (const [label, run, state, icon, action] of [
  ['failed', prRun({ id: 42, run_attempt: 3, conclusion: 'failure' }), 'FAIL', '❌', true],
  ['cancelled', prRun({ id: 42, run_attempt: 3, conclusion: 'cancelled' }), 'CANCELLED', '❌', true],
  ['running', prRun({ id: 42, run_attempt: 3, status: 'in_progress', conclusion: null }), 'RUNNING', '⏳', false],
  ['passing', prRun({ id: 42, run_attempt: 3 }), 'PASS', '✅', false],
  ['absent', undefined, 'UNKNOWN', '➖', false],
]) test(`the ${label} PR validation workflow stays separate from passing required checks`, () => {
  const body = render({ ...passingRequiredDesk(), validationRun: run });
  const visible = visibleDesk(body);
  assert.match(visible, /\| CI \(required PR checks\) \| PASS \|/);
  if (action) assert.ok(visible.includes(`### Action needed\n\n- **PR validation workflow** · ${state}`));
  else assert.doesNotMatch(visible, /### Action needed|PR validation workflow/);
  assert.ok(body.includes(`**PR validation workflow** · ${icon} ${state}`));
  const exactLink = `[run 42, attempt 3](https://github.com/${repository}/actions/runs/42/attempts/3)`;
  if (run) {
    assert.ok(body.includes(`**PR validation workflow** · ${icon} ${state} · ${exactLink}`));
    assert.ok(!visible.includes(exactLink));
  } else assert.doesNotMatch(body, /\/actions\/runs\//);
});

test('a failed PR validation workflow is visible when no required check results are available', () => {
  const d = passingRequiredDesk();
  d.checks = [];
  d.validationRun = prRun({ conclusion: 'failure' });
  const visible = visibleDesk(render(d));
  assert.match(visible, /### Action needed\n\n- \*\*PR validation workflow\*\* · FAIL/);
  assert.match(visible, /- \*\*Frontend\*\* · NOT RUN/);
  assert.match(visible, /\| CI \(required PR checks\) \| NOT RUN \|/);
});

test('a missing required check gets a visible action even while a reviewer is waiting', () => {
  const d = data();
  d.required = [PROJECT_REQUIRED[0]];
  const visible = visibleDesk(render(d));
  assert.match(visible, /\*\*Next attention\*\* · Check missing required CI results\./);
  assert.match(visible, /### Action needed\n\n- \*\*Frontend\*\* · NOT RUN/);
  assert.match(visible, /\| Review \| WAITING \|\n\| CI \(required PR checks\) \| NOT RUN \|/);
  assert.match(visible, /\*\*Requested reviewers:\*\* Haresco/);
  assert.doesNotMatch(visible, /Await requested human review|merge-ready|ready to merge|merge eligible/i);
});

test('earlier-revision changes requested remain visible as history without a current action', () => {
  const d = data();
  d.reviews = [review('DaeSaster', 'CHANGES_REQUESTED', 1, { commit_id: 'e'.repeat(40) })];
  const body = render(d);
  assert.match(visibleDesk(body), /\| Review \| CHANGES REQUESTED \(earlier revision\) \|/);
  assert.doesNotMatch(visibleDesk(body), /### Action needed/);
  assert.match(body, /Haresco — ❌ CHANGES REQUESTED \(earlier revision\)/);
});

test('expected skips remain visible and unavailable evidence stays distinct', () => {
  const d = data();
  d.checks = [check('Classify PR paths', 'success', { workflow: 'Modular PR Validation',
    app: { slug: 'github-actions' }, run_id: 8, steps: [check('Record documentation-only E2E/staging skips', 'success')] }),
  check('Modular E2E', 'skipped', { run_id: 8 }), check('Modular Staging', 'skipped', { run_id: 8 })];
  d.threadsAvailable = false;
  const body = render(d);
  const visible = visibleDesk(body);
  assert.match(visible, /\| CI \(required PR checks\) \| UNKNOWN \|/);
  for (const label of ['E2E (non-gating)', 'Staging deploy', 'Staging smoke']) {
    assert.ok(visible.includes(`- **${label}** · SKIPPED — EXPECTED`));
  }
  assert.doesNotMatch(visible, /### Action needed|VERIFIED/);
  assert.match(body, /CodeRabbit \(optional\)\*\* · NOT DETECTED\n\*\*Open threads:\*\* Unavailable/);
});

test('closed without merge is terminal even if a temporary merge SHA and requests remain', () => {
  const d = data();
  d.pr = { ...merged(), merged: false, merged_at: null };
  d.reviews = [review('myntchoc', 'DISMISSED')];
  d.release = { run: mainRun(), deploy: 'VERIFIED', smoke: 'VERIFIED' };
  const body = render(d);
  assert.match(body, /CLOSED WITHOUT MERGE/);
  assert.match(visibleDesk(body), /\| Merge \| CLOSED WITHOUT MERGE \|\n\| Deploy \| NOT APPLICABLE \|\n\| Smoke \| NOT APPLICABLE \|/);
  assert.match(body, /Belen — ➖ DISMISSED/);
  assert.doesNotMatch(body, /WAITING|Ready for review|Exact main release|Merge on main|Requested reviewers|### Attention|VERIFIED/);
});

function mockApi(handler) {
  const calls = [];
  const request = async (path, method = 'GET', body) => { calls.push({ path, method, body }); return handler(path, method, body); };
  return { root: `/repos/${repository}`, request, list: request, calls };
}
test('issue comments ignored unless structured CodeRabbit author on a PR', async () => {
  const api = mockApi(() => { throw new Error('must not read'); });
  assert.deepEqual(await resolvePRs(api, 'issue_comment', { issue: { number: 87, pull_request: {} }, comment: { user: user('DaeSaster') } }, repository), []);
  assert.deepEqual(await resolvePRs(api, 'issue_comment', { issue: { number: 86 }, comment: { user: bot } }, repository), []);
});
test('CodeRabbit PR comment resolves through fresh PR metadata', async () => {
  const api = mockApi(() => pr());
  assert.deepEqual(await resolvePRs(api, 'issue_comment', { issue: { number: 87, pull_request: {} }, comment: { user: bot } }, repository), [87]);
});
test('workflow association rejects stale heads, wrong repositories, main pushes', async () => {
  const event = workflowEvent(prRun());
  assert.deepEqual(await resolvePRs(mockApi(() => pr()), 'workflow_run', event, repository), [87]);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { event: 'push' }, { head_branch: 'other' },
    { repository: { full_name: 'other/repo' } }, { name: 'PR Secretary' }, { name: 'CI' },
    { path: '.github/workflows/other.yml' }]) {
    assert.deepEqual(await resolvePRs(mockApi(() => pr()), 'workflow_run', workflowEvent(prRun(patch)), repository), []);
  }
});
test('workflow with empty PR list uses commit association and verifies head/repo', async () => {
  const api = mockApi(path => path.includes('/commits/') ? [{ number: 87 }] : pr());
  const event = workflowEvent(prRun({ pull_requests: [] }));
  assert.deepEqual(await resolvePRs(api, 'workflow_run', event, repository), [87]);
});
test('CodeRabbit can refresh an eligible closed PR while non-main is excluded', async () => {
  const event = { issue: { number: 87, pull_request: {} }, comment: { user: bot } };
  assert.deepEqual(await resolvePRs(mockApi(() => merged()), 'issue_comment', event, repository), [87]);
  const other = { ...pr(), base: { ref: 'other', repo: { full_name: repository } } };
  assert.deepEqual(await resolvePRs(mockApi(() => other), 'issue_comment', event, repository), []);
});
test('schedule lists open PRs and caps reconciliation at ten recent closures', async () => {
  const api = mockApi(path => path.includes('?state=open') ? [{ number: 87 }] :
    [{ number: 1, closed_at: '2026-10-01T00:00:00Z' },
      ...Array.from({ length: 12 }, (_, i) => ({ number: 100 + i, closed_at: mergedAt }))]);
  assert.deepEqual(await resolvePRs(api, 'schedule', {}, repository, { now: Date.parse(mergedAt) }),
    [87, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  assert.equal(api.calls.length, 2);
});
test('dispatch and unsupported events never read or write', async () => {
  const api = mockApi(() => { throw new Error('must not read'); });
  for (const eventName of ['workflow_dispatch', 'unsupported']) {
    assert.deepEqual(await resolvePRs(api, eventName, {}, repository), []);
  }
  assert.equal(api.calls.length, 0);
});
test('all direct lifecycle actions resolve against live PR state, including closed and reopened', async () => {
  for (const action of ['opened', 'reopened', 'synchronize', 'edited', 'converted_to_draft', 'ready_for_review',
    'closed', 'review_requested', 'review_request_removed']) {
    const source = action === 'closed' ? merged() : pr();
    const live = action === 'closed' ? { ...merged(), merged: false } : pr();
    assert.deepEqual(await resolvePRs(mockApi(() => live), 'pull_request_target', targetEvent(action, source), repository), [87]);
  }
  assert.deepEqual(await resolvePRs(mockApi(() => pr()), 'pull_request_target', targetEvent('closed', merged()), repository), [87]);
});
test('direct lifecycle rejects forged repository, mismatched PR number, actions and endpoint syntax', async () => {
  const api = mockApi(() => assert.fail('must not read'));
  for (const event of [{ ...targetEvent('edited'), repository: { full_name: 'other/repo' } },
    { ...targetEvent('edited'), number: 12 }, targetEvent('labeled'), targetEvent('edited', { ...pr(), number: '87/files' })]) {
    assert.deepEqual(await resolvePRs(api, 'pull_request_target', event, repository), []);
  }
});
test('manual refresh accepts one bounded decimal PR on the main ref only', async () => {
  const event = { repository: { full_name: repository }, inputs: { pr: '87' } };
  assert.deepEqual(await resolvePRs(mockApi(() => merged()), 'workflow_dispatch', event, repository, { ref: 'refs/heads/main' }), [87]);
  const api = mockApi(() => assert.fail('must not read'));
  assert.deepEqual(await resolvePRs(api, 'workflow_dispatch', event, repository, { ref: 'refs/tags/main' }), []);
  for (const input of ['87?foo=bar', '087', ' 87', '0', '1e2', '99999999999', 87]) {
    assert.deepEqual(await resolvePRs(api, 'workflow_dispatch', { ...event, inputs: { pr: input } },
      repository, { ref: 'refs/heads/main' }), []);
  }
});
test('review signals require native event, allowed file, success, exact fork head and a proven association', async () => {
  const fork = { full_name: 'contributor/moris-mix-ai' };
  const live = { ...pr(), head: { ...pr().head, repo: fork } };
  const signal = prRun({ name: 'PR Secretary Review Signal', event: 'pull_request_review', head_repository: fork,
    path: '.github/workflows/pr-secretary-review-signal.yml@refs/pull/87/merge', pull_requests: [] });
  const api = mockApi(path => path.includes('/commits/') ? [{ number: 87 }] : live);
  assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent(signal), repository), [87]);
  assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent({ ...signal, event: 'pull_request_review_comment' }), repository), [87]);
  assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent(signal, 'in_progress'), repository), []);
  for (const patch of [{ conclusion: 'skipped' }, { event: 'workflow_dispatch' }, { head_sha: '../pulls/87' },
    { head_repository: { full_name: repository } }, { head_branch: 'same-sha-other-branch' }, { path: '.github/workflows/forged.yml' },
    { pull_requests: { number: 87 } }]) {
    assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent({ ...signal, ...patch }), repository), []);
  }
  const ambiguous = mockApi(path => path.includes('/commits/') ? [{ number: 87 }, { number: 88 }] :
    { ...live, number: Number(path.split('/').at(-1)) });
  assert.deepEqual(await resolvePRs(ambiguous, 'workflow_run', workflowEvent(signal), repository), []);
});
test('workflow signal without a commit association can use an encoded, independently verified fork head', async () => {
  const head = { sha, ref: 'topic/ready', repo: { full_name: 'contributor/moris-mix-ai' } };
  const run = prRun({ head_branch: head.ref, head_repository: head.repo, pull_requests: [] });
  const api = mockApi(path => {
    if (path.includes('/commits/')) throw Object.assign(new Error('Unknown commit'), { status: 404 });
    if (path.includes('/pulls?')) {
      assert.ok(path.endsWith('head=contributor%3Atopic%2Fready'));
      return [{ number: 87 }];
    }
    return { ...pr(), head };
  });
  assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent(run), repository), [87]);
});
test('main workflow signals resolve only to authoritative merged PRs with the exact merge SHA', async () => {
  const api = mockApi(path => path.includes('/commits/') ? [{ number: 87 }, { number: 88 }, { number: 89 }] :
    path.endsWith('/87') ? merged() : path.endsWith('/88') ? { ...merged(), number: 88, merge_commit_sha: sha } :
      { ...merged(), number: 89, merged: false });
  for (const action of ['requested', 'in_progress', 'completed']) {
    assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent(mainRun(), action), repository), [87]);
  }
  const raced = mockApi(path => path.includes('/commits/') ? [{ number: 87 }] : pr());
  assert.deepEqual(await resolvePRs(raced, 'workflow_run', workflowEvent(mainRun()), repository), []);
  assert.deepEqual(await resolvePRs(api, 'workflow_run', workflowEvent(mainRun({ head_branch: 'feature' })), repository), []);
});
test('required policy preserves integration IDs and distinct app-bound requirements', async () => {
  const api = mockApi(() => [{ type: 'required_status_checks', parameters: { required_status_checks: [
    { context: 'Current Gate', integration_id: 15368 }, { context: 'Current Gate', integration_id: 999 },
    { context: 'Current Gate', integration_id: 15368 }, { context: 'Unbound Gate' },
  ] } }]);
  assert.deepEqual((await requiredPolicy(api, 'main')).required, [
    { context: 'Current Gate', integrationId: 999 }, { context: 'Current Gate', integrationId: 15368 },
    { context: 'Unbound Gate', integrationId: null },
  ]);
});
test('unavailable or empty rules use documented main policy; unknown branch stays unknown', async () => {
  const api = mockApi(() => { throw Object.assign(new Error('forbidden'), { status: 403 }); });
  assert.deepEqual((await requiredPolicy(api, 'main')).required, [...PROJECT_REQUIRED]);
  assert.deepEqual((await requiredPolicy(mockApi(() => []), 'main')).required, [...PROJECT_REQUIRED]);
  assert.deepEqual((await requiredPolicy(api, 'other')).required, []);
});
test('fallback contexts explicitly carry unknown integration identity and labeled PASS', async () => {
  const policy = await requiredPolicy(mockApi(() => []), 'main');
  assert.match(policy.requiredSource, /fallback.*unconfirmed/);
  assert.deepEqual(policy.required.map(r => r.context), ['Modular Frontend / Frontend Checks', 'Modular Database / Database Tests', 'Modular Edge/API / Edge/API Tests']);
  assert.ok(policy.required.every(r => r.integrationId === null && r.integrationUnverified));
  const d = { ...data(), ...policy, checks: [check('Modular Frontend / Frontend Checks', 'success')] };
  assert.equal(summarize(d).rows[0][1], 'PASS (fallback; integration unverified)');
  assert.match(render(d), /fallback; live enforcement unconfirmed/);
});
test('unexpected rules API error is not silently treated as policy evidence', async () => {
  await assert.rejects(requiredPolicy(mockApi(() => { throw new Error('network'); }), 'main'), /network/);
});
test('GraphQL thread pagination is complete', async () => {
  const api = mockApi((path, method, body) => ({ data: { repository: { pullRequest: { reviewThreads: {
    nodes: [thread(body.variables.after ? 'second' : 'first')],
    pageInfo: { hasNextPage: !body.variables.after, endCursor: 'next' },
  } } } } }));
  assert.equal((await collectThreads(api, 87)).length, 2);
});
test('job identity joins exact check-run ID without borrowing a same-name app', async () => {
  const api = mockApi(() => { throw new Error('must not fetch'); });
  const job = { name: 'Modular Frontend / Frontend Checks', check_run_url: `https://api.github.com${api.root}/check-runs/42` };
  const app = { id: 15368, slug: 'github-actions' };
  assert.deepEqual(await jobApp(api, job, [check(job.name, 'success', { id: 41, app: { id: 999 } }),
    check(job.name, 'success', { id: 42, app })]), app);
});
test('job identity fetch constructs a local endpoint; unavailable or unsafe identity is unknown', async () => {
  const app = { id: 15368, slug: 'github-actions' };
  const api = mockApi(() => check('Modular Frontend / Frontend Checks', 'success', { id: 42, app }));
  const job = { name: 'Modular Frontend / Frontend Checks', check_run_url: `https://api.github.com${api.root}/check-runs/42` };
  assert.deepEqual(await jobApp(api, job, []), app);
  assert.equal(api.calls[0].path, `${api.root}/check-runs/42`);
  assert.equal(await jobApp(api, { ...job, check_run_url: 'https://evil.example/check-runs/42' }, []), null);
  assert.equal(api.calls.length, 1);
  assert.equal(await jobApp(mockApi(() => { throw new Error('unavailable'); }), job, []), null);
  assert.equal(await jobApp(api, { ...job, name: 'Different job' }, []), null);
});
test('REST pagination follows all pages and does not follow remote URLs', async () => {
  const urls = [];
  const api = createApi('fake-token', repository, async (url, options) => {
    urls.push(url); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => url.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  });
  assert.equal((await api.list(`${api.root}/issues`)).length, 101);
  assert.equal(urls.length, 2);
});

test('API stops a depleted resource and refuses to normalize unsafe repository paths', async () => {
  for (const slug of ['../repo', 'owner/..', 'owner/.', 'owner/repo?next=other']) {
    assert.throws(() => createApi('test-token', slug), /Invalid repository/);
  }
  let calls = 0;
  const api = createApi('test-token', repository, async () => {
    calls++;
    return { ok: true, headers: new Headers({ 'x-ratelimit-remaining': '0' }), json: async () => [] };
  });
  assert.deepEqual(await api.request(`${api.root}/pulls`), []);
  await assert.rejects(api.request(`${api.root}/pulls`), /rate limit exhausted/);
  assert.equal(calls, 1);
});

test('PR comment 403 retains safe GitHub diagnostics and permission evidence', async () => {
  const token = 'private-test-token';
  const documentation = 'https://docs.github.com/rest/issues/comments#create-an-issue-comment';
  const api = createApi(token, repository, async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ message: 'Resource not accessible by integration',
      documentation_url: documentation, errors: [{ secret: token }], body: 'untrusted body' }), {
      status: 403, headers: { 'x-accepted-github-permissions': 'issues=write; pull_requests=write',
        'x-github-request-id': 'AB12:34:CD56' },
    });
  });
  await assert.rejects(api.request(`${api.root}/issues/88/comments`, 'POST', { body: 'summary private contents' }), error => {
    assert.equal(error.status, 403);
    assert.equal(error.githubMessage, 'Resource not accessible by integration');
    assert.equal(error.documentation_url, documentation);
    assert.match(error.message, /GitHub POST .*\/issues\/88\/comments: 403/);
    assert.match(error.message, /issues=write; pull_requests=write/);
    assert.match(error.message, /request_id=AB12:34:CD56/);
    assert.doesNotMatch(error.message, /private-test-token|secret|untrusted body|summary private contents|Authorization/);
    return true;
  });
});

test('API error diagnostics redact credentials, bound messages, and prevent log-line injection', async () => {
  const token = 'private-test-token';
  const api = createApi(token, repository, async () => new Response(JSON.stringify({
    message: `Denied ${token}\n::error::injected\u001b[31m Bearer different-secret\nAuthorization: Basic another-secret\n${'x'.repeat(1000)}`,
    documentation_url: `https://docs.github.com/rest/${token}`,
  }), { status: 403 }));
  await assert.rejects(api.request(`${api.root}/issues/88/comments`, 'POST'), error => {
    assert.ok(error.githubMessage.length <= 400);
    assert.doesNotMatch(error.message, /private-test-token|different-secret|another-secret|[\r\n\u001b]/);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});

for (const [name, body] of [['HTML error', '<html>secret raw body</html>'], ['invalid JSON', '{secret broken'],
  ['non-object JSON', 'null'], ['array JSON', '["secret"]']]) {
  test(`API ${name} preserves status without exposing response body`, async () => {
    const api = createApi('fake-token', repository, async () => new Response(body, { status: 502 }));
    await assert.rejects(api.request(`${api.root}/pulls/88?secret=query`), error => {
      assert.equal(error.status, 502);
      assert.equal(error.message, `GitHub GET ${api.root}/pulls/88: 502`);
      return true;
    });
  });
}

for (const documentation of ['https://evil.example/docs', 'https://docs.github.com@evil.example/rest',
  'https://user:password@docs.github.com/rest', 'http://docs.github.com/rest',
  'https://docs.github.com/rest?secret=hidden', 'not a URL']) {
  test(`API diagnostics reject untrusted documentation URL: ${documentation}`, async () => {
    const api = createApi('fake-token', repository, async () => new Response(JSON.stringify({
      message: 'Forbidden', documentation_url: documentation,
    }), { status: 403 }));
    await assert.rejects(api.request(`${api.root}/pulls/88`), error => {
      assert.equal(error.documentation_url, undefined);
      assert.equal(error.message, `GitHub GET ${api.root}/pulls/88: 403; message="Forbidden"`);
      return true;
    });
  });
}

test('API diagnostics preserve status for permission fallback and ignore non-string messages', async () => {
  const api = createApi('fake-token', repository, async () => new Response(JSON.stringify({
    message: { secret: 'must not log' }, documentation_url: null,
  }), { status: 403 }));
  assert.equal((await requiredPolicy(api, 'main')).requiredSource,
    'documented main policy fallback; live enforcement unconfirmed');
});
test('marker lookup ignores forged user comments', () => {
  assert.equal(ownedComment([{ id: 1, user: user('someone'), body: MARKER }]), undefined);
});
test('publish creates once, updates owned comment, and skips identical bodies', async () => {
  const d = data(); let comments = [];
  const api = mockApi((path, method, body) => {
    if (path.endsWith('/pulls/87')) return d.pr;
    if (method === 'POST' || method === 'PATCH') { comments = [{ id: 9, user: { login: 'github-actions[bot]', type: 'Bot' }, body: body.body }]; return {}; }
    return comments;
  });
  assert.equal(await publish(api, d, 10), 'created');
  assert.equal(await publish(api, d, 11), 'unchanged');
  d.paths = ['frontend/src/App.tsx'];
  assert.equal(await publish(api, d, 12), 'updated');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(api.calls.filter(c => c.method === 'PATCH').length, 1);
});
test('older run cannot overwrite newer generation; stale head cannot write', async () => {
  const d = data(); const existing = { user: { login: 'github-actions[bot]', type: 'Bot' }, body: `${MARKER}\n<!-- secretary-run:20 -->` };
  assert.equal(await publish(mockApi(path => path.endsWith('/pulls/87') ? d.pr : [existing]), d, 10), 'superseded');
  const api = mockApi(() => ({ ...d.pr, head: { ...d.pr.head, sha: 'new' } }));
  assert.equal(await publish(api, d, 30), 'stale'); assert.equal(api.calls.length, 1);
});

test('comment activity changing updated_at alone does not suppress a valid same-revision summary', async () => {
  const d = data();
  const api = mockApi((path, method) => path.endsWith('/pulls/87') ?
    { ...d.pr, updated_at: '2026-10-28T10:57:15Z' } : method === 'POST' ? {} : []);
  assert.equal(await publish(api, d, 30), 'created');
  assert.equal(api.calls.filter(c => c.method === 'POST').length, 1);
});

for (const [name, change] of [
  ['closed PR', p => { p.state = 'closed'; }],
  ['head SHA', p => { p.head.sha = 'c'.repeat(40); }],
  ['base branch', p => { p.base.ref = 'release'; }],
  ['base SHA', p => { p.base.sha = 'c'.repeat(40); }],
  ['base repository', p => { p.base.repo.full_name = 'other/repo'; }],
]) test(`publish rejects changed ${name} even if updated_at is unchanged`, async () => {
  const d = data();
  const fresh = structuredClone(d.pr); change(fresh);
  const api = mockApi(() => fresh);
  assert.equal(await publish(api, d, 30), 'stale');
  assert.equal(api.calls.length, 1);
});

test('timestamp-only changes cannot bypass newer-generation or unchanged-comment guards', async () => {
  const d = data();
  const fresh = { ...d.pr, updated_at: '2026-10-28T10:57:15Z' };
  for (const [body, expected] of [
    [`${MARKER}\n<!-- secretary-run:31 -->`, 'superseded'],
    [`${render(d)}\n<!-- secretary-run:29 -->`, 'unchanged'],
  ]) {
    const api = mockApi(path => path.endsWith('/pulls/87') ? fresh :
      [{ id: 9, user: { login: 'github-actions[bot]', type: 'Bot' }, body }]);
    assert.equal(await publish(api, d, 30), expected);
    assert.ok(api.calls.every(c => c.method === 'GET'));
  }
});
test('newer observation wins over a queued older trigger ID without introducing repeat writes', async () => {
  const d = data();
  const time = Date.parse(mergedAt);
  const botOwner = { login: 'github-actions[bot]', type: 'Bot' };
  let comments = [{ id: 9, user: botOwner, body: MARKER }];
  const api = mockApi((path, method, payload) => {
    if (path.endsWith('/pulls/87')) return d.pr;
    if (method === 'PATCH') { comments = [{ ...comments[0], body: payload.body }]; return {}; }
    return comments;
  });
  assert.equal(await publish(api, d, 20, time), 'updated');
  const older = { ...d, reviews: [review('DaeSaster', 'APPROVED')] };
  assert.equal(await publish(api, older, 19, time - 1), 'superseded');
  assert.equal(await publish(api, older, 19, time + 1), 'updated');
  assert.equal(await publish(api, older, 21, time + 2), 'unchanged');
  assert.equal(api.calls.filter(call => call.method === 'PATCH').length, 2);
  assert.match(comments[0].body, /Last dashboard update · 2026-11-20T08:17:42.001Z/);
});

test('serialized simultaneous refreshes recover an open-to-merged race and keep one owned comment', async () => {
  let live = pr();
  let prReads = 0;
  let comments = [];
  const botOwner = { login: 'github-actions[bot]', type: 'Bot' };
  const api = mockApi((path, method, payload) => {
    if (path.endsWith('/pulls/87')) {
      if (++prReads === 3) live = merged(); // Merge after the first comment lookup, before the write.
      return live;
    }
    if (method === 'POST' && path === '/graphql') return { errors: [{}] };
    if (method === 'POST' || method === 'PATCH') {
      comments = [{ id: 9, user: botOwner, body: payload.body }];
      return {};
    }
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path.endsWith('/issues/87/comments')) return comments;
    if (path.endsWith('/reviews')) return [review('DaeSaster', 'APPROVED')];
    return [];
  });
  // The workflow's per-PR concurrency group queues the second invocation.
  const time = Date.parse(mergedAt);
  let observation = time;
  const close = refresh(api, 87, repository, 20, () => ++observation);
  const ci = close.then(() => refresh(api, 87, repository, 19, () => ++observation));
  assert.deepEqual(await Promise.all([close, ci]), ['created', 'unchanged']);
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/issues/87/comments')).length, 1);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /✅ MERGED/);
  assert.doesNotMatch(comments[0].body, /WAITING|Ready for review/);
});

test('publisher rejects a changed merge identity but ignores a newer main tip on a merged PR', async () => {
  const d = { ...data(), pr: merged() };
  const different = { ...d.pr, merge_commit_sha: sha };
  assert.equal(await publish(mockApi(() => different), d, 30), 'stale');
  const advanced = { ...d.pr, base: { ...d.pr.base, sha: 'd'.repeat(40) } };
  const api = mockApi(path => path.endsWith('/pulls/87') ? advanced : []);
  assert.equal(await publish(api, d, 30), 'created');
});

const productionJob = 'Modular Main Production / Deploy to Supabase and Cloudflare';
const deploySteps = ['Deploy recipes Edge Function', 'Deploy extract-recipe Edge Function', 'Deploy generate-recipe Edge Function',
  'Deploy recipe-image-attach Edge Function', 'Deploy to Cloudflare Workers'];
const smokeSteps = ['Verify production deployment URL', 'Verify deployed AI routes', 'Production runtime smoke'];
const mainJobs = [
  ...['Modular Main Frontend / Frontend Checks', 'Modular Main Database / Database Tests', 'Modular Main Edge/API / Edge/API Tests',
    'Modular Main Edge/API / Hosted RLS Integration', 'Modular Main E2E / Playwright E2E Tests'].map(name => check(name, 'success')),
  check(productionJob, 'success', { steps: [...deploySteps, ...smokeSteps].map(name => check(name, 'success')) }),
];
for (const [label, deploy, smoke, outcome, action] of [
  ['pending', 'PENDING', 'PENDING', 'Main delivery evidence is still pending.'],
  ['skipped', 'SKIPPED', 'SKIPPED', 'Production deployment and smoke were skipped.'],
  ['deployment failed', 'FAIL', 'SKIPPED', 'Release evidence needs attention.', '- **Production deployment** · FAIL'],
  ['smoke failed', 'VERIFIED', 'FAIL', 'Release evidence needs attention.', '- **Production smoke** · FAIL'],
  ['verified', 'VERIFIED', 'VERIFIED', 'Production deployment and smoke verified for this merge.'],
]) test(`collapsed main delivery remains accurate: ${label}`, () => {
  const run = mainRun({ run_attempt: 2, ...(label === 'pending' ? { status: 'in_progress', conclusion: null } : {}) });
  const jobs = structuredClone(mainJobs);
  if (label === 'deployment failed') {
    jobs.at(-1).conclusion = 'failure';
    jobs.at(-1).steps.at(0).conclusion = 'failure';
    for (const step of jobs.at(-1).steps.slice(1)) step.conclusion = 'skipped';
  } else if (label === 'smoke failed') {
    jobs.at(-1).conclusion = 'failure';
    jobs.at(-1).steps.at(-1).conclusion = 'failure';
  }
  const release = releaseEvidence(run, label === 'pending' ? [] : label === 'skipped' ?
    [check('Modular Main Production', 'skipped')] : jobs);
  const body = render({ ...data(), pr: merged(), release });
  const visible = visibleDesk(body);
  assert.ok(visible.includes(`**Delivery outcome** · ${outcome}`));
  assert.ok(visible.includes(`| Merge | MERGED |\n| Deploy | ${deploy} |\n| Smoke | ${smoke} |`));
  if (action) assert.ok(visible.includes(action));
  else assert.doesNotMatch(visible, /### Attention/);
  assert.ok(body.includes(`[run ${run.id}, attempt 2](https://github.com/${repository}/actions/runs/${run.id}/attempts/2)`));
  assert.doesNotMatch(body, /WAITING|current production|ready to merge/i);
});

for (const [conclusion, state] of [['failure', 'FAIL'], ['cancelled', 'CANCELLED']]) {
  test(`exact main workflow ${conclusion} is visible when job evidence is unavailable`, () => {
    const run = mainRun({ run_attempt: 2, conclusion });
    const release = releaseEvidence(run, []);
    const body = render({ ...data(), pr: merged(), release });
    const visible = visibleDesk(body);
    assert.match(visible, /\*\*Delivery outcome\*\* · Release evidence needs attention\./);
    assert.ok(visible.includes(`### Attention\n\n- **Main workflow** · ${state}`));
    assert.match(visible, /\| Deploy \| UNKNOWN \|\n\| Smoke \| UNKNOWN \|/);
    assert.doesNotMatch(visible, /\*\*Production (job|deployment|smoke)\*\*|VERIFIED/);
    assert.ok(body.includes(`[run ${run.id}, attempt 2](https://github.com/${repository}/actions/runs/${run.id}/attempts/2)`));
    assert.match(body, /\| Production deployment \| ➖ UNKNOWN \|/);
  });
}

test('exact attempt separates deployment success from smoke failure and does not infer success from aggregate jobs', () => {
  const run = mainRun();
  assert.deepEqual(releaseEvidence(run, mainJobs), { run, validation: 'VERIFIED', e2e: 'VERIFIED',
    production: 'PASS', deploy: 'VERIFIED', smoke: 'VERIFIED' });
  const failed = structuredClone(mainJobs);
  failed.at(-1).conclusion = 'failure';
  failed.at(-1).steps.at(-1).conclusion = 'failure';
  assert.equal(releaseEvidence(run, failed).production, 'FAIL');
  assert.equal(releaseEvidence(run, failed).deploy, 'VERIFIED');
  assert.equal(releaseEvidence(run, failed).smoke, 'FAIL');
  assert.equal(releaseEvidence(run, [check(productionJob, 'success')]).deploy, 'UNKNOWN');
  assert.equal(releaseEvidence(run, [check(productionJob, 'success')]).smoke, 'UNKNOWN');
  assert.equal(releaseEvidence(run, [check('Modular Main Production', 'skipped')]).deploy, 'SKIPPED');
  assert.equal(releaseEvidence({ ...run, status: 'in_progress' }, []).smoke, 'PENDING');
  assert.equal(releaseEvidence(run, [{ ...failed.at(-1), steps: failed.at(-1).steps.slice(-3).map(s => check(s.name, 'success')) }]).smoke,
    'UNKNOWN');
});

test('production setup failure and early cancellation stay visible when delivery steps did not run', () => {
  const run = mainRun();
  const failed = check(productionJob, 'failure', { steps: [
    check('Validate production deployment configuration', 'failure'),
    ...[...deploySteps, ...smokeSteps].map(name => check(name, 'skipped')),
  ] });
  const cancelled = check(productionJob, 'cancelled', { steps: [] });
  for (const [job, outcome, phase] of [[failed, 'FAIL', 'SKIPPED'], [cancelled, 'CANCELLED', 'UNKNOWN']]) {
    const release = releaseEvidence(run, [job]);
    assert.deepEqual([release.production, release.deploy, release.smoke], [outcome, phase, phase]);
    const body = render({ ...data(), pr: merged(), release });
    assert.ok(body.includes(`| Production job | ❌ ${outcome} |`));
    assert.ok(visibleDesk(body).includes(`- **Production job** · ${outcome}`));
  }
});
test('merged collection uses actual merge SHA and latest exact run attempt only', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return merged();
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path === '/graphql') return { errors: [{}] };
    if (path.includes('/actions/workflows/')) {
      assert.ok(path.endsWith(`&head_sha=${mergeSha}`));
      return [mainRun({ id: 33, head_sha: sha }), mainRun({ id: 32, head_branch: 'feature' }),
        mainRun({ id: 30 }), mainRun({ id: 31, run_attempt: 2 })];
    }
    if (path.includes('/attempts/')) {
      assert.ok(path.endsWith('/31/attempts/2/jobs'));
      return mainJobs.map(job => ({ ...job, run_id: 31, run_attempt: job.name === productionJob ? 1 : 2 }));
    }
    return [];
  });
  const d = await collect(api, 87, repository);
  assert.equal(d.release.validation, 'VERIFIED');
  assert.equal(d.release.deploy, 'UNKNOWN');
  assert.match(render(d), /\/actions\/runs\/31\/attempts\/2/);
});

test('a release jobs lookup error leaves the existing unavailable-evidence diagnostic', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return merged();
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path.includes('/actions/workflows/')) return [mainRun({ conclusion: 'failure' })];
    if (path.includes('/attempts/')) throw new Error('Jobs endpoint unavailable');
    return [];
  });
  const d = await collect(api, 87, repository);
  assert.equal(d.release, null);
  const body = render(d);
  assert.match(body, /Exact main delivery evidence unavailable from GitHub/);
  assert.doesNotMatch(visibleDesk(body), /\*\*Main workflow\*\* · FAIL/);
  assert.match(visibleDesk(body), /\| Deploy \| UNKNOWN \|\n\| Smoke \| UNKNOWN \|/);
});

test('active PR retries suppress stale jobs from the previous attempt', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return pr();
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path === '/graphql') return { errors: [{}] };
    if (path.includes('/actions/runs?')) return [prRun({ run_attempt: 2, status: 'in_progress' })];
    if (path.includes('/jobs?')) return [check(GATES[0][2], 'success', { run_attempt: 1 }),
      { name: GATES[1][2], status: 'in_progress', run_attempt: 2 }];
    return [];
  });
  const d = await collect(api, 87, repository);
  assert.deepEqual(summarize(d).rows.slice(0, 2).map(row => row[1]), ['NOT RUN', 'RUNNING']);
  assert.match(render(d), /PR validation workflow\*\* · ⏳ RUNNING/);
});
for (const expected of ['.github/workflows/ci.yml', '.github/workflows/modular-pr-validation.yml']) {
  for (const [actual, matches] of [
    [expected, true],
    [`${expected}@main`, true],
    [`${expected}@refs/pull/87/merge`, true],
    [`${expected}@anything`, true],
    ['.github/workflows/other.yml@main', false],
    [`${expected}.bak@main`, false],
    [undefined, false],
    [null, false],
  ]) {
    test(`workflow path ${actual} matches ${expected}: ${matches}`, () => {
      assert.equal(workflowPathMatches(actual, expected), matches);
    });
  }
}

test('workflow path rejects an unknown expected workflow', () => {
  assert.equal(workflowPathMatches('undefined@main', undefined), false);
  assert.equal(workflowPathMatches(undefined, undefined), false);
});

test('collection selects the newest relevant run with a ref-suffixed workflow path', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return pr();
    if (path.endsWith('/files')) return [{ filename: 'frontend/src/App.tsx' }];
    if (path === '/graphql') throw new Error('optional API unavailable');
    if (path.includes('/actions/runs?')) return [
      { id: 1, path: '.github/workflows/modular-pr-validation.yml' },
      { id: 2, path: '.github/workflows/modular-pr-validation.yml@refs/pull/87/merge' },
      { id: 3, path: '.github/workflows/other.yml@main' },
      { id: 4, path: '.github/workflows/modular-pr-validation.yml.bak@main' },
    ].map(run => ({ ...run, name: 'Modular PR Validation', head_sha: sha, pull_requests: [{ number: 87 }] }));
    if (path.includes('/actions/runs/2/jobs')) return [{ name: 'Modular Frontend / Frontend Checks', status: 'in_progress' }];
    if (path.includes('/actions/runs/')) throw new Error('must only read newest relevant run');
    return [];
  });
  const collected = await collect(api, 87, repository);
  assert.equal(summarize(collected).rows[0][1], 'RUNNING');
  assert.deepEqual(api.calls.filter(c => c.path.includes('/jobs')).map(c => c.path),
    [`${api.root}/actions/runs/2/jobs?filter=latest`]);
});

test('collection tolerates optional CodeRabbit API failures and prefers newest workflow jobs', async () => {
  const d = data();
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return d.pr;
    if (path.endsWith('/files')) return [{ filename: 'frontend/src/App.tsx' }];
    if (path === '/graphql') throw new Error('unsupported');
    if (path.includes('/rules/')) return [];
    if (path.includes('/check-runs')) return [
      check('Modular Frontend / Frontend Checks', 'success', { app: { slug: 'github-actions' } }),
      check('Modular Staging / Staging Deploy', 'success', { run_id: 1 }),
      check('Modular Staging / Staging Smoke', 'success', { run_id: 1 }),
    ];
    if (path.includes('/actions/runs?')) return [1, 2].map(id => ({ id, name: 'Modular PR Validation', path: '.github/workflows/modular-pr-validation.yml', head_sha: sha, pull_requests: [{ number: 87 }] }));
    if (path.includes('/actions/runs/2/jobs')) return [
      { name: 'Modular Frontend / Frontend Checks', status: 'in_progress' },
      { name: 'Modular Staging / Staging Deploy', status: 'in_progress', run_id: 2 },
    ];
    if (path.includes('/actions/runs/1/jobs')) throw new Error('must not read stale run');
    return [];
  });
  const collected = await collect(api, 87, repository);
  assert.equal(collected.threadsAvailable, false);
  const summary = summarize(collected);
  assert.equal(summary.rows[0][1], 'RUNNING');
  assert.deepEqual(stagingStates(summary), ['RUNNING', 'NOT RUN']);
});
test('collection without a matched validation run does not use commit checks for staging', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return pr();
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path.includes('/check-runs')) return [
      check('Modular Staging / Staging Deploy', 'success'),
      check('Modular Staging / Staging Smoke', 'success'),
    ];
    return [];
  });
  assert.deepEqual(stagingStates(summarize(await collect(api, 87, repository))), ['NOT RUN', 'NOT RUN']);
});
test('current Actions jobs satisfy active Actions-bound contexts using linked check identity', async () => {
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return pr();
    if (path.endsWith('/files')) return [{ filename: 'frontend/src/App.tsx' }];
    if (path === '/graphql') throw new Error('optional API unavailable');
    if (path.includes('/rules/')) return [{ type: 'required_status_checks', parameters: {
      required_status_checks: PROJECT_REQUIRED.map(r => ({ context: r.context, integration_id: 15368 })),
    } }];
    if (path.includes('/commits/') && path.includes('/check-runs')) return PROJECT_REQUIRED.map((r, i) =>
      check(r.context, 'success', { id: 40 + i, app: { id: 15368, slug: 'github-actions' } }));
    if (path.includes('/actions/runs?')) return [{ id: 2, name: 'Modular PR Validation', path: '.github/workflows/modular-pr-validation.yml', head_sha: sha, pull_requests: [{ number: 87 }] }];
    if (path.includes('/actions/runs/2/jobs')) return PROJECT_REQUIRED.map((r, i) =>
      check(r.context, 'success', { check_run_url: `https://api.github.com/repos/${repository}/check-runs/${40 + i}` }));
    return [];
  });
  const collected = await collect(api, 87, repository);
  assert.ok(collected.checks.slice(0, 3).every(c => c.app.id === 15368));
  assert.deepEqual(summarize(collected).rows.slice(0, 3).map(r => r[1]), ['PASS', 'PASS', 'PASS']);
  assert.ok(!summarize(collected).attention.some(a => a.includes('required context')));
});

test('collection preserves same-run docs-only step evidence and ignores stale skipped callers', async () => {
  const app = { id: 15368, slug: 'github-actions' };
  const classifier = check('Classify PR paths', 'success', { id: 42, app });
  const api = mockApi(path => {
    if (path.endsWith('/pulls/87')) return pr();
    if (path.endsWith('/files')) return [{ filename: 'README.md' }];
    if (path === '/graphql') throw new Error('optional API unavailable');
    if (path.includes('/rules/')) return [];
    if (path.includes('/commits/') && path.includes('/check-runs')) return [classifier,
      check('Modular E2E', 'success'), check('Modular Staging', 'success')];
    if (path.includes('/actions/runs?')) return [{ id: 2, name: 'Modular PR Validation',
      path: '.github/workflows/modular-pr-validation.yml', head_sha: sha, pull_requests: [{ number: 87 }] }];
    if (path.includes('/actions/runs/2/jobs')) return [
      check('Classify PR paths', 'success', { run_id: 2,
        check_run_url: `https://api.github.com/repos/${repository}/check-runs/42`,
        steps: [check('Record documentation-only E2E/staging skips', 'success')] }),
      check('Modular E2E', 'skipped', { run_id: 2 }), check('Modular Staging', 'skipped', { run_id: 2 }),
    ];
    return [];
  });
  const collected = await collect(api, 87, repository);
  for (const name of ['Modular E2E', 'Modular Staging']) {
    assert.equal(collected.checks.filter(c => c.name === name).length, 1);
  }
  for (const label of ['E2E (non-gating)', 'Staging deploy', 'Staging smoke']) {
    assert.equal(summarize(collected).rows.find(r => r[0] === label)[1], 'SKIPPED — EXPECTED');
  }
});
test('incomplete changed files fail closed', async () => {
  const api = mockApi(path => path.endsWith('/pulls/87') ? { ...pr(), changed_files: 3001 } :
    path === '/graphql' ? { errors: [{}] } : []);
  await assert.rejects(collect(api, 87, repository), /incomplete/);
});
test('writer routes trusted events into a serialized per-PR default-branch job', async () => {
  const workflow = (await readFile(new URL('../.github/workflows/pr-secretary.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const events = workflow.split('on:\n')[1].split('\npermissions:')[0];
  assert.deepEqual([...events.matchAll(/^  (\w+):/gm)].map(m => m[1]),
    ['pull_request_target', 'issue_comment', 'workflow_run', 'workflow_dispatch', 'schedule']);
  assert.match(events, /branches: \[main\]\n    types: \[opened, reopened, synchronize, edited, converted_to_draft, ready_for_review, closed, review_requested, review_request_removed\]/);
  assert.match(events, /workflows: \[Modular PR Validation, Modular Main Validation, PR Secretary Review Signal\]/);
  assert.match(events, /types: \[requested, in_progress, completed\]/);
  assert.match(workflow, /github\.event\.repository\.default_branch == 'main'/);
  assert.match(workflow, /github\.event_name != 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.equal((workflow.match(/ref: refs\/heads\/\$\{\{ github.event.repository.default_branch \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/uses: actions\/(?:checkout|setup-node)@[a-f0-9]{40}/g) ?? []).length, 4);
  assert.equal((workflow.match(/repository: \$\{\{ github.repository \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.equal((workflow.match(/sparse-checkout: scripts/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|head\.ref|download-artifact|npm install|pnpm/);
  assert.match(workflow, /group: pr-secretary-\$\{\{ github.repository \}\}-\$\{\{ matrix.pr \}\}\n      cancel-in-progress: false/);
  assert.equal(GATES.filter(g => g[0].startsWith('Staging')).length, 2);
});

test('review signals have no checkout, credential, payload transfer or dynamic shell code', async () => {
  const signal = (await readFile(new URL('../.github/workflows/pr-secretary-review-signal.yml', import.meta.url), 'utf8'))
    .replace(/\r\n/g, '\n');
  assert.match(signal, /^  pull_request_review:\n    types: \[submitted, edited, dismissed\]$/m);
  assert.match(signal, /^  pull_request_review_comment:\n    types: \[created, edited, deleted\]$/m);
  assert.match(signal, /^permissions: \{\}$/m);
  assert.deepEqual([...signal.matchAll(/^\s*- run: (.*)$/gm)].map(m => m[1]), ["':'"]);
  assert.doesNotMatch(signal, /uses:|secrets\.|token|env:|outputs:|artifact|cache|pull_request_target/);
});

test('only the trusted writer has the targeted PR-comment permissions', async () => {
  const workflow = (await readFile(new URL('../.github/workflows/pr-secretary.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const jobs = [...workflow.split('\njobs:\n')[1].matchAll(/^  ([\w-]+):\n/gm)].map(match => match[1]);
  const permissions = job => Object.fromEntries([...workflow.split(`  ${job}:\n`)[1]
    .split(/^  [\w-]+:\n/m)[0]
    .split('    permissions:\n')[1].split('    steps:')[0].matchAll(/^      ([\w-]+): (read|write)$/gm)]
    .map(match => [match[1], match[2]]));
  assert.deepEqual(permissions('resolve'), { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(permissions('summarize'), { contents: 'read', actions: 'read', checks: 'read',
    statuses: 'read', 'pull-requests': 'write' });
  assert.equal(permissions('summarize')['pull-requests'], 'write');
  assert.equal(permissions('summarize').issues, undefined);
  assert.deepEqual(jobs, ['resolve', 'summarize']);
  for (const job of jobs.filter(job => job !== 'summarize')) {
    assert.doesNotMatch(workflow.split(`  ${job}:\n`)[1].split(/^  [\w-]+:\n/m)[0], /:\s*write(?:\s|$)|write-all/);
  }
  assert.doesNotMatch(workflow, /^\s+issues:\s*write\s*$/m);
  assert.match(workflow, /^permissions: \{\}$/m);
});

for (const file of ['reusable-frontend.yml']) {
  test(`${file} runs Secretary regressions from root in Frontend Checks`, async () => {
    const workflow = (await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const frontend = workflow.split('  frontend:\n')[1].split(/^  [\w-]+:\n/m)[0];
    assert.match(frontend, /^    name: Frontend Checks$/m);
    assert.doesNotMatch(frontend, /^    (?:if|continue-on-error):/m);
    const steps = frontend.split(/^      - /m).slice(1);
    const setupIndex = steps.findIndex(step => step.startsWith('name: Set up Node.js\n'));
    const testIndex = steps.findIndex(step => step.startsWith('name: Run PR Secretary regression tests\n'));
    assert.ok(setupIndex >= 0 && testIndex > setupIndex);
    assert.match(steps[setupIndex], /uses: actions\/setup-node@v4/);
    assert.doesNotMatch(steps[setupIndex], /^        if:/m);
    const guard = file === 'reusable-frontend.yml'
      ? "        if: hashFiles('scripts/pr-secretary.test.mjs') != ''\n" : '';
    assert.equal(steps[testIndex].trimEnd(), 'name: Run PR Secretary regression tests\n' + guard +
      '        working-directory: .\n        run: node --test scripts/pr-secretary.test.mjs');
  });
}
