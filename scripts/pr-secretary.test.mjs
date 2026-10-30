import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MARKER, TEAM, PROJECT_REQUIRED, GATES, classify, reviewer, normalize, normalizeRequired, stagingEligible,
  codeRabbit, humanReviews, summarize, render, createApi, resolvePRs, requiredPolicy, collectThreads,
  collect, workflowPathMatches, jobApp, ownedComment, publish } from './pr-secretary.mjs';

const repository = '2ton-exe/moris-mix-ai';
const user = login => ({ login, type: 'User' });
const bot = { login: 'coderabbitai[bot]', type: 'Bot' };
const sha = 'a'.repeat(40);
const pr = () => ({ number: 87, title: 'Delivery metadata', state: 'open', draft: false,
  updated_at: '2026-10-27T01:00:00Z', changed_files: 1, author_association: 'MEMBER',
  head: { sha, ref: 'feature', repo: { full_name: repository } },
  base: { ref: 'main', sha: 'b'.repeat(40), repo: { full_name: repository } }, requested_reviewers: [user('DaeSaster')], requested_teams: [] });
const data = () => ({ pr: pr(), repository, paths: ['docs/readme.md'], checks: [], comments: [], reviews: [],
  inlineComments: [], threads: [], required: [], requiredSource: 'test policy' });
const check = (name, conclusion, extra = {}) => ({ name, status: 'completed', conclusion, ...extra });
const review = (login, state, id = 1, extra = {}) => ({ id, user: user(login), state, commit_id: sha,
  submitted_at: `2026-10-27T01:00:0${id}Z`, ...extra });
const thread = (path, isResolved = false, author = { login: 'coderabbitai', __typename: 'Bot' }) =>
  ({ path, isResolved, comments: { nodes: [{ author, updatedAt: '2026-10-27T02:00:00Z' }] } });

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
  const d = data(); d.checks = [check('Deploy to Cloudflare', 'skipped')];
  assert.deepEqual(summarize(d).rows.at(-1), ['Production deploy', 'SKIPPED — EXPECTED']);
  assert.ok(!summarize(d).attention.some(a => a.includes('not completed/skipped')));
});
for (const observed of [
  { status: 'queued' }, { status: 'requested' }, { status: 'waiting' }, { status: 'in_progress' },
  { status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' },
  { status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: null },
  { status: 'queued', conclusion: 'skipped' },
]) test(`production PR job ${observed.status}/${observed.conclusion ?? 'null'} raises attention`, () => {
  const d = data(); d.checks = [{ name: 'Deploy to Cloudflare', ...observed }];
  assert.ok(summarize(d).attention.some(a => a.includes('Production deploy: observed PR job is not completed/skipped')));
});
test('a skipped production result cannot hide another observed non-skipped PR job', () => {
  const d = data(); d.checks = [check('Deploy to Cloudflare', 'skipped'), { name: 'Deploy to Cloudflare', status: 'queued' }];
  assert.equal(summarize(d).rows.at(-1)[1], 'RUNNING');
  assert.ok(summarize(d).attention.some(a => a.includes('not completed/skipped')));
});
test('eligible staging unexpected skip needs investigation', () => {
  const d = data(); d.checks = [check('Modular Staging / Staging Deploy', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Staging deploy')[1], 'SKIPPED — INVESTIGATE');
});
for (const reason of ['draft', 'fork']) test(`ineligible ${reason} staging skip is expected`, () => {
  const d = data();
  if (reason === 'draft') d.pr.draft = true;
  if (reason === 'fork') d.pr.head.repo.full_name = 'fork/repo';
  assert.equal(stagingEligible(d.pr, repository), false);
  d.checks = [check('Modular Staging', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Staging deploy')[1], 'SKIPPED — EXPECTED');
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
test('hosted RLS fork skip expected; internal skip investigated', () => {
  const d = data(); d.checks = [check('Hosted RLS Integration', 'skipped')];
  assert.equal(summarize(d).rows.find(r => r[0] === 'Hosted RLS')[1], 'SKIPPED — INVESTIGATE');
  d.pr.head.repo.full_name = 'fork/repo';
  assert.equal(summarize(d).rows.find(r => r[0] === 'Hosted RLS')[1], 'SKIPPED — EXPECTED');
});
test('missing/failed known required checks produce attention; pending does not', () => {
  const d = data(); d.required = [...PROJECT_REQUIRED];
  d.checks = [check('Frontend Checks', 'failure'), { name: 'Database Tests', status: 'queued' }];
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
test('app-bound required check passes only with correct context and integration', () => {
  const requirement = { context: 'Frontend Checks', integrationId: 15368 };
  const evidence = [check('Frontend Checks', 'success', { app: { id: 15368, slug: 'github-actions' } })];
  assert.equal(normalizeRequired(requirement, evidence), 'PASS');
  assert.equal(normalizeRequired({ ...requirement, context: 'Other' }, evidence), 'NOT RUN');
  const d = data(); d.required = [requirement]; d.checks = evidence;
  assert.deepEqual(summarize(d).rows[0], ['Frontend', 'PASS']);
  assert.equal(summarize(d).attention.length, 0);
});
test('same context with wrong app cannot satisfy app-bound requirement', () => {
  const d = data(); d.required = [{ context: 'Frontend Checks', integrationId: 15368 }];
  d.checks = [check('Frontend Checks', 'success', { app: { id: 999, slug: 'github-actions' } })];
  assert.equal(summarize(d).rows[0][1], 'INTEGRATION MISMATCH');
  assert.match(summarize(d).attention.join('\n'), /INTEGRATION MISMATCH.*integration 15368/);
});
test('same-context statuses and jobs without app identity cannot masquerade as bound success', () => {
  const requirement = { context: 'Frontend Checks', integrationId: 15368 };
  for (const evidence of [check('Frontend Checks', 'success'),
    check('Frontend Checks', 'success', { app: { slug: 'github-actions' } }),
    { name: 'Frontend Checks', context: 'Frontend Checks', state: 'success', creator: { id: 15368 } }]) {
    assert.equal(normalizeRequired(requirement, [evidence]), 'IDENTITY UNVERIFIED');
  }
  const d = data(); d.required = [requirement]; d.checks = [check('Frontend Checks', 'success')];
  assert.equal(summarize(d).rows[0][1], 'IDENTITY UNVERIFIED');
  assert.match(summarize(d).attention.join('\n'), /IDENTITY UNVERIFIED/);
});
test('matching app is selected over a same-name external success or failure', () => {
  const requirement = { context: 'Frontend Checks', integrationId: 15368 };
  assert.equal(normalizeRequired(requirement, [check('Frontend Checks', 'success', { app: { id: 999 } }),
    check('Frontend Checks', 'failure', { app: { id: 15368 } })]), 'FAIL');
});
test('external name lookalikes do not establish GitHub Actions delivery gates', () => {
  const d = data(); d.checks = [check('Frontend Checks', 'success', { app: { slug: 'other-app' } }),
    { name: 'Database Tests', context: 'Database Tests', state: 'success' }];
  assert.equal(summarize(d).rows[0][1], 'NOT RUN');
  assert.equal(summarize(d).rows[1][1], 'NOT RUN');
});
test('no requested reviewer produces no reviewer-specific section', () => {
  const d = data(); d.pr.requested_reviewers = []; d.reviews = [review('myntchoc', 'APPROVED')];
  assert.doesNotMatch(render(d), /### Belen —/); assert.match(render(d), /Belen — APPROVED/);
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
  assert.doesNotMatch(render(d), /- \[ \] inspect unresolved/);
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
test('empty Attention section is omitted', () => assert.doesNotMatch(render(data()), /### Attention/));

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
  const event = { workflow_run: { name: 'CI', event: 'pull_request', repository: { full_name: repository },
    head_repository: { full_name: repository }, head_sha: sha, pull_requests: [{ number: 87 }] } };
  assert.deepEqual(await resolvePRs(mockApi(() => pr()), 'workflow_run', event, repository), [87]);
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { event: 'push' }, { repository: { full_name: 'other/repo' } }, { name: 'PR Secretary' }]) {
    assert.deepEqual(await resolvePRs(mockApi(() => pr()), 'workflow_run', { workflow_run: { ...event.workflow_run, ...patch } }, repository), []);
  }
});
test('workflow with empty PR list uses commit association and verifies head/repo', async () => {
  const api = mockApi(path => path.includes('/commits/') ? [{ number: 87 }] : pr());
  const event = { workflow_run: { name: 'Modular PR Validation', event: 'pull_request', repository: { full_name: repository },
    head_repository: { full_name: repository }, head_sha: sha, pull_requests: [] } };
  assert.deepEqual(await resolvePRs(api, 'workflow_run', event, repository), [87]);
});
test('closed/non-main events produce no writes or PR candidates', async () => {
  for (const p of [{ ...pr(), state: 'closed' }, { ...pr(), base: { ref: 'other', repo: { full_name: repository } } }])
    assert.deepEqual(await resolvePRs(mockApi(() => p), 'issue_comment', { issue: { number: 87, pull_request: {} }, comment: { user: bot } }, repository), []);
});
test('schedule enumerates and validates open PRs', async () => {
  const api = mockApi(path => path.includes('?state=open') ? [{ number: 87 }] : pr());
  assert.deepEqual(await resolvePRs(api, 'schedule', {}, repository), [87]);
});
test('dispatch and unsupported events never read or write', async () => {
  const api = mockApi(() => { throw new Error('must not read'); });
  for (const eventName of ['workflow_dispatch', 'unsupported']) {
    assert.deepEqual(await resolvePRs(api, eventName, {}, repository), []);
  }
  assert.equal(api.calls.length, 0);
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
  assert.deepEqual(policy.required.map(r => r.context), ['Frontend Checks', 'Database Tests', 'Edge/API Tests']);
  assert.ok(policy.required.every(r => r.integrationId === null && r.integrationUnverified));
  const d = { ...data(), ...policy, checks: [check('Frontend Checks', 'success')] };
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
  const job = { name: 'Frontend Checks', check_run_url: `https://api.github.com${api.root}/check-runs/42` };
  const app = { id: 15368, slug: 'github-actions' };
  assert.deepEqual(await jobApp(api, job, [check(job.name, 'success', { id: 41, app: { id: 999 } }),
    check(job.name, 'success', { id: 42, app })]), app);
});
test('job identity fetch constructs a local endpoint; unavailable or unsafe identity is unknown', async () => {
  const app = { id: 15368, slug: 'github-actions' };
  const api = mockApi(() => check('Frontend Checks', 'success', { id: 42, app }));
  const job = { name: 'Frontend Checks', check_run_url: `https://api.github.com${api.root}/check-runs/42` };
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
      { id: 1, path: '.github/workflows/ci.yml' },
      { id: 2, path: '.github/workflows/ci.yml@refs/pull/87/merge' },
      { id: 3, path: '.github/workflows/other.yml@main' },
      { id: 4, path: '.github/workflows/ci.yml.bak@main' },
    ].map(run => ({ ...run, name: 'CI', head_sha: sha, pull_requests: [{ number: 87 }] }));
    if (path.includes('/actions/runs/2/jobs')) return [{ name: 'Frontend Checks', status: 'in_progress' }];
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
    if (path.includes('/check-runs')) return [check('Frontend Checks', 'success', { app: { slug: 'github-actions' } })];
    if (path.includes('/actions/runs?')) return [1, 2].map(id => ({ id, name: 'CI', path: '.github/workflows/ci.yml', head_sha: sha, pull_requests: [{ number: 87 }] }));
    if (path.includes('/actions/runs/2/jobs')) return [{ name: 'Frontend Checks', status: 'in_progress' }];
    if (path.includes('/actions/runs/1/jobs')) throw new Error('must not read stale run');
    return [];
  });
  const collected = await collect(api, 87, repository);
  assert.equal(collected.threadsAvailable, false);
  assert.equal(summarize(collected).rows[0][1], 'RUNNING');
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
    if (path.includes('/actions/runs?')) return [{ id: 2, name: 'CI', path: '.github/workflows/ci.yml', head_sha: sha, pull_requests: [{ number: 87 }] }];
    if (path.includes('/actions/runs/2/jobs')) return PROJECT_REQUIRED.map((r, i) =>
      check(r.context, 'success', { check_run_url: `https://api.github.com/repos/${repository}/check-runs/${40 + i}` }));
    return [];
  });
  const collected = await collect(api, 87, repository);
  assert.ok(collected.checks.slice(0, 3).every(c => c.app.id === 15368));
  assert.deepEqual(summarize(collected).rows.slice(0, 3).map(r => r[1]), ['PASS', 'PASS', 'PASS']);
  assert.ok(!summarize(collected).attention.some(a => a.includes('required context')));
});
test('incomplete changed files fail closed', async () => {
  const api = mockApi(path => path.endsWith('/pulls/87') ? { ...pr(), changed_files: 3001 } :
    path === '/graphql' ? { errors: [{}] } : []);
  await assert.rejects(collect(api, 87, repository), /incomplete/);
});
test('workflow uses only the three trusted metadata/reconciliation events and default-branch code', async () => {
  const workflow = (await readFile(new URL('../.github/workflows/pr-secretary.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const events = workflow.split('on:\n')[1].split('\npermissions:')[0];
  assert.deepEqual([...events.matchAll(/^  (\w+):/gm)].map(m => m[1]), ['issue_comment', 'workflow_run', 'schedule']);
  assert.match(events, /workflows: \[CI, Modular PR Validation\]/);
  assert.match(events, /types: \[in_progress, completed\]/);
  assert.equal((workflow.match(/ref: \$\{\{ github.event.repository.default_branch \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/repository: \$\{\{ github.repository \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.equal((workflow.match(/sparse-checkout: scripts/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|head\.ref|download-artifact|npm install|pnpm/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(GATES.filter(g => g[0].startsWith('Staging')).length, 2);
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

for (const file of ['ci.yml', 'reusable-frontend.yml']) {
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
