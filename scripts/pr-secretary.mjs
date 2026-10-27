import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- moris-pr-secretary:v1 -->';
export const TEAM = Object.freeze({
  daesaster: { name: 'Haresco', role: 'DevOps' },
  danielramos1186: { name: 'Ramos', role: 'Backend' },
  adnro2: { name: 'Ong', role: 'Frontend' },
  kleinrheepagulongsioson: { name: 'Sioson', role: 'AI' },
  myntchoc: { name: 'Belen', role: 'Integration / Full-stack' },
});
// Fallback for main only. Source: docs/devops/deployment-runbook.md, ruleset evidence.
export const PROJECT_REQUIRED = Object.freeze(['Frontend Checks', 'Database Tests', 'Edge/API Tests']
  .map(context => Object.freeze({ context, integrationId: null, integrationUnverified: true })));
const AREA_ORDER = ['Frontend', 'Backend/API', 'AI', 'Database', 'DevOps', 'Integration'];
const WORKFLOWS = ['CI', 'Modular PR Validation'];
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
const areas = values => AREA_ORDER.filter(a => values.includes(a));
const human = user => user && user.type !== 'Bot' && !user.login?.endsWith('[bot]');
export const isCodeRabbit = user => (user?.type === 'Bot' || user?.__typename === 'Bot') &&
  ['coderabbitai', 'coderabbitai[bot]'].includes(user.login?.toLowerCase());
export const reviewer = login => TEAM[login.toLowerCase()] ?? { name: login, role: null };
const migration = p => p.startsWith('supabase/migrations/');
const delivery = p => p.startsWith('.github/workflows/') || p === 'wrangler.jsonc' || p === 'supabase/config.toml';

export function classify(paths) {
  const found = [];
  for (const p of paths) {
    if (p.startsWith('frontend/')) found.push('Frontend');
    if (p.startsWith('supabase/functions/')) found.push('Backend/API');
    if (p.startsWith('supabase/functions/_shared/ai/') ||
        /^supabase\/functions\/tests\/(ai_|eval_dataset)/.test(p) ||
        p === 'fixtures/ai-extracted-recipe.json' || p === 'docs/api/ai-integration.md') found.push('AI');
    if (migration(p) || p === 'supabase/seed.sql' ||
        /^(run-migrations|test-migrations|test-rls|test-rls-guard)\.mjs$/.test(p)) {
      found.push('Database', 'Backend/API');
      if (migration(p) || p === 'run-migrations.mjs') found.push('DevOps');
    }
    if (delivery(p) || p.startsWith('docs/devops/') || p.startsWith('scripts/pr-secretary')) found.push('DevOps');
    if (p.startsWith('frontend/e2e/') || p === 'frontend/playwright.config.mjs' ||
        /^frontend\/src\/.*Integration\.test\.tsx$/.test(p) ||
        /supabase\/functions\/tests\/(auth_rls_integration|cross_user_rls_lineage)_test\.ts$/.test(p) ||
        p === 'run-local-tests.mjs') found.push('Integration');
  }
  return areas(found);
}

export function stagingEligible(pr, repository) {
  return !pr.draft && pr.head.repo?.full_name === repository &&
    ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association);
}

export function normalize(check, { expectedSkip = false, applicable = true } = {}) {
  if (!check) return applicable ? 'NOT RUN' : 'NOT REQUIRED';
  if (check.status && check.status !== 'completed') return 'RUNNING';
  const state = (check.conclusion ?? check.state ?? '').toLowerCase();
  if (['success'].includes(state)) return 'PASS';
  if (['failure', 'error', 'timed_out', 'action_required', 'startup_failure'].includes(state)) return 'FAIL';
  if (['pending', 'queued', 'in_progress', 'waiting', 'requested'].includes(state)) return 'RUNNING';
  if (state === 'skipped') return expectedSkip ? 'SKIPPED — EXPECTED' : 'SKIPPED — INVESTIGATE';
  if (state === 'cancelled') return 'CANCELLED';
  if (state === 'neutral') return 'NEUTRAL';
  if (state === 'stale') return 'STALE';
  return state ? `UNKNOWN (${state.toUpperCase()})` : 'NOT RUN';
}

export function normalizeRequired(requirement, checks) {
  const named = checks.filter(c => c.name === requirement.context);
  if (!named.length) return 'NOT RUN';
  if (requirement.integrationId != null) {
    // Commit statuses expose creator identity, not a trustworthy check-app ID.
    const compatible = named.find(c => !c.context && c.app?.id === requirement.integrationId);
    if (compatible) return normalize(compatible);
    return named.some(c => !c.context && Number.isSafeInteger(c.app?.id)) ?
      'INTEGRATION MISMATCH' : 'IDENTITY UNVERIFIED';
  }
  const state = normalize(named[0]);
  return state === 'PASS' && requirement.integrationUnverified ? 'PASS (fallback; integration unverified)' : state;
}

export const GATES = [
  ['Frontend', 'CI', 'Frontend Checks'],
  ['Database', 'CI', 'Database Tests'],
  ['Edge/API', 'CI', 'Edge/API Tests'],
  ['Hosted RLS', 'CI', 'Hosted RLS Integration'],
  ['E2E (non-gating)', 'CI', 'Playwright E2E (Non-gating) / Playwright E2E Tests'],
  ['Modular Frontend', 'Modular PR Validation', 'Modular Frontend / Frontend Checks'],
  ['Modular Database', 'Modular PR Validation', 'Modular Database / Database Tests'],
  ['Modular Edge/API', 'Modular PR Validation', 'Modular Edge/API / Edge/API Tests'],
  ['Modular E2E (non-gating)', 'Modular PR Validation', 'Modular E2E / Playwright E2E Tests'],
  ['Staging deploy', 'Modular PR Validation', 'Modular Staging / Staging Deploy'],
  ['Staging smoke', 'Modular PR Validation', 'Modular Staging / Staging Smoke'],
  ['Production deploy', 'CI', 'Deploy to Cloudflare'],
];

function gateChecks(checks, workflow, name) {
  const aliases = [name];
  if (name.startsWith('Modular Staging / ')) aliases.push('Modular Staging');
  if (name.startsWith('Playwright E2E (Non-gating) / ')) aliases.push('Playwright E2E (Non-gating)');
  return checks.filter(c => aliases.includes(c.name) && (!c.workflow || c.workflow === workflow) &&
    (!c.app || c.app.slug === 'github-actions') && !c.context);
}

export function codeRabbit({ comments = [], reviews = [], inlineComments = [], threads = [], threadsAvailable = true }, sha, paths) {
  const activity = [...comments, ...reviews, ...inlineComments].filter(c => isCodeRabbit(c.user));
  const open = threads.filter(t => !t.isResolved && isCodeRabbit(t.comments?.nodes?.[0]?.author));
  const openPaths = sorted(open.map(t => t.path).filter(Boolean));
  const routedPaths = openPaths.filter(p => paths.includes(p));
  const reviewed = reviews.some(r => isCodeRabbit(r.user) && r.commit_id === sha &&
    ['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(r.state));
  const times = [...activity.map(c => c.updated_at ?? c.submitted_at ?? c.created_at),
    ...threads.filter(t => isCodeRabbit(t.comments?.nodes?.[0]?.author)).map(t => t.comments.nodes[0].updatedAt)].filter(Boolean).sort();
  return { state: reviewed ? 'REVIEWED' : activity.length || times.length ? 'ACTIVITY DETECTED' : 'NOT DETECTED',
    latest: times.at(-1), count: threadsAvailable ? open.length : null, paths: openPaths,
    ownership: classify(openPaths), routedOwnership: classify(routedPaths) };
}

export function humanReviews(requested, reviews, sha) {
  const effective = new Map();
  for (const r of [...reviews].sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '') || a.id - b.id)) {
    if (!human(r.user) || r.state === 'PENDING') continue;
    const login = r.user.login.toLowerCase();
    // A comment-only review does not revoke a prior approval/change request.
    if (r.state !== 'COMMENTED' || !effective.has(login)) effective.set(login, r);
  }
  const logins = sorted([...new Map([...requested.filter(human).map(u => u.login), ...[...effective.values()].map(r => r.user.login)]
    .map(login => [login.toLowerCase(), login])).values()]);
  return logins.map(login => {
    const r = effective.get(login.toLowerCase());
    let state = r?.state?.replaceAll('_', ' ') ?? 'WAITING';
    if (r?.commit_id && r.commit_id !== sha && ['APPROVED', 'CHANGES_REQUESTED'].includes(r.state)) state += ' (earlier revision)';
    return { login, state };
  });
}

export function checklist(login, ownership, rabbitOwnership) {
  const { role } = reviewer(login);
  const has = a => ownership.includes(a);
  const bullets = [];
  const route = { DevOps: ['DevOps'], Backend: ['Backend/API', 'Database'], Frontend: ['Frontend'], AI: ['AI'],
    'Integration / Full-stack': AREA_ORDER }[role] ?? [];
  for (const a of route.filter(a => rabbitOwnership.includes(a))) bullets.push(`inspect unresolved automated-review finding in ${a === 'DevOps' ? 'CI/CD configuration' : `${a} code`}`);
  if (role === 'DevOps') {
    if (has('DevOps')) bullets.push('pipeline/gating behavior and required validation remain intentional', 'PR cannot unexpectedly deploy production; environment/secrets handling remains safe');
    if (has('Database') || has('DevOps')) bullets.push('staging/production, rollback, and verification impact is understood');
  } else if (role === 'Backend' && (has('Backend/API') || has('Database'))) {
    bullets.push('API/auth/RLS behavior remains correct');
    if (has('Database')) bullets.push('migration/schema impact is understood');
    bullets.push('backend tests cover the changed behavior');
  } else if (role === 'Frontend' && has('Frontend')) {
    bullets.push('UI behavior and loading/empty/error states match the intended contract', 'frontend/API integration and tests/build cover the change');
  } else if (role === 'AI' && has('AI')) {
    bullets.push('prompt/provider/output-schema behavior and output validation remain intentional', 'mocks/evaluation coverage matches the change; ordinary CI uses no live paid AI calls');
  } else if (role === 'Integration / Full-stack') {
    if (has('Frontend') || has('Backend/API')) bullets.push('frontend/backend contracts remain aligned');
    if (has('Integration') || (has('Frontend') && has('Backend/API'))) bullets.push('cross-layer tests and E2E/critical journey impact are understood');
    if (has('DevOps') || has('Database')) bullets.push('release-readiness impact is understood');
  }
  if (!bullets.length) bullets.push('review the changed areas and relevant test evidence');
  return bullets;
}

// Escape all untrusted text as inert Markdown; never copy comment/review prose.
const md = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/@/g, '&#64;').replace(/[\\`*_[\]{}|#!]/g, '\\$&').replace(/[\r\n]+/g, ' ');

export function summarize(data) {
  const { pr, repository, paths, checks, required, requiredSource } = data;
  const ownership = classify(paths);
  const rabbit = codeRabbit(data, pr.head.sha, paths);
  const attention = [];
  const rows = GATES.map(([label, workflow, name]) => {
    const evidence = gateChecks(checks, workflow, name);
    const unexpectedProduction = label === 'Production deploy' ? evidence.find(c =>
      !(c.status === 'completed' && c.conclusion === 'skipped')) : undefined;
    const check = unexpectedProduction ?? evidence[0];
    const staging = label.startsWith('Staging');
    const expectedSkip = label === 'Production deploy' || (staging && !stagingEligible(pr, repository)) ||
      (label === 'Hosted RLS' && pr.head.repo?.full_name !== repository);
    const applicable = pr.base.ref === 'main';
    const state = normalize(check, { expectedSkip, applicable });
    if (state === 'SKIPPED — INVESTIGATE') attention.push(`${label}: unexpected skip${staging ? ' (check upstream validation and staging eligibility)' : ''}`);
    if (unexpectedProduction) {
      attention.push('Production deploy: observed PR job is not completed/skipped; inspect immediately');
    }
    return [label, state];
  });
  for (const requirement of required) {
    const { context, integrationId } = requirement;
    const state = normalizeRequired(requirement, checks);
    const identity = integrationId == null ? '' : `; integration ${integrationId}`;
    if (['FAIL', 'NOT RUN', 'SKIPPED — INVESTIGATE', 'CANCELLED', 'STALE', 'INTEGRATION MISMATCH', 'IDENTITY UNVERIFIED'].includes(state)) {
      attention.push(`${context}: ${state} (required context${identity}; ${requiredSource})`);
    }
    const gateIndex = GATES.findIndex(g => g[2] === context);
    if (gateIndex >= 0 && required.filter(r => r.context === context).length === 1) rows[gateIndex][1] = state;
    else rows.push([`${context} (required${identity})`, state]);
  }
  if (paths.some(delivery)) attention.push('workflow/deployment configuration changed; inspect delivery and secrets boundaries');
  if (paths.some(migration)) attention.push('migration files changed; inspect schema and environment delivery safety');
  if (rabbit.count) attention.push(`${rabbit.count} unresolved CodeRabbit review thread${rabbit.count === 1 ? '' : 's'}`);
  const requested = pr.requested_reviewers.filter(human);
  if (!pr.draft && !requested.length && !pr.requested_teams?.length && !humanReviews([], data.reviews, pr.head.sha).some(r => r.state === 'APPROVED')) attention.push('Ready PR has no requested human reviewer and no recorded current-revision human approval');
  if (ownership.length >= 4) attention.push(`Changes span ${ownership.length} ownership areas; coordinate cross-layer verification`);
  if (data.collectionNotes?.length) attention.push(...data.collectionNotes);
  return { ownership, rabbit, attention: sorted(attention), rows, requested };
}

export function render(data) {
  const { pr } = data;
  const s = summarize(data);
  const requestedNames = [...s.requested.map(u => reviewer(u.login).name), ...(pr.requested_teams ?? []).map(t => `team: ${t.slug}`)];
  const out = [MARKER, '', '## PR Ops Summary', '', `**PR:** #${pr.number} — ${md(pr.title)}`,
    `**State:** ${pr.draft ? 'Draft' : 'Ready for review'}`, `**Revision:** ${md(pr.head.sha.slice(0, 7))}`,
    `**Changed areas:** ${md(s.ownership.join(', ') || 'Unclassified')}`,
    `**Requested reviewers:** ${requestedNames.map(md).join(', ') || 'None'}`,
    `**Affected ownership:** ${md(s.ownership.join(', ') || 'Unclassified')}`,
    '', '### Delivery state', '', '| Gate | State |', '| --- | --- |',
    ...s.rows.map(([label, state]) => `| ${md(label)} | ${md(state)} |`), '',
    `<sub>Required contexts: ${md(data.requiredSource)}. Validation does not establish deployment success.</sub>`,
    '', '### Automated review', '', `**CodeRabbit:** ${s.rabbit.state}`];
  if (s.rabbit.latest) out.push(`**Latest activity:** ${md(s.rabbit.latest)}`);
  out.push(`**Open threads:** ${s.rabbit.count ?? 'Unavailable'}`);
  if (s.rabbit.ownership.length) out.push(`**Affected areas:** ${s.rabbit.ownership.join(', ')}`);
  if (s.rabbit.paths.length) out.push(`**Thread paths:** ${s.rabbit.paths.slice(0, 5).map(p => md(p)).join(', ')}${s.rabbit.paths.length > 5 ? ` (+${s.rabbit.paths.length - 5} more)` : ''}`);
  const humans = humanReviews(s.requested, data.reviews, pr.head.sha);
  if (humans.length) out.push('', '### Human review', '', ...humans.map(r => `${md(reviewer(r.login).name)} — ${r.state}  `));
  for (const u of s.requested) {
    const r = reviewer(u.login);
    out.push('', `### ${md(r.name)} — ${md(r.role ?? 'General')} review`, '', ...checklist(u.login, s.ownership, s.rabbit.routedOwnership).map(b => `- [ ] ${b}`));
  }
  if (s.attention.length) out.push('', '### Attention', '', ...s.attention.map(a => `- ${md(a)}`));
  out.push('', '<sub>PR Secretary reports repository state only. It does not approve, merge, or deploy.</sub>');
  return out.join('\n');
}

export function createApi(token, repository, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const root = `/repos/${repository}`;
  async function request(path, method = 'GET', body) {
    // All endpoints are constructed locally. Never follow an API-provided URL with the token.
    const response = await fetcher(`https://api.github.com${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { const error = new Error(`GitHub ${method} ${path.split('?')[0]}: ${response.status}`); error.status = response.status; throw error; }
    return response.json();
  }
  async function list(path, key) {
    const all = [];
    for (let page = 1; ; page++) {
      const result = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = key ? result[key] : result;
      if (!Array.isArray(items)) throw new Error('Invalid paginated API response');
      all.push(...items);
      if (items.length < 100) return all;
    }
  }
  return { root, request, list };
}

export async function resolvePRs(api, eventName, event, repository) {
  let candidates = [];
  if (eventName === 'issue_comment') {
    if (!event.issue?.pull_request || !isCodeRabbit(event.comment?.user)) return [];
    candidates = [event.issue.number];
  } else if (eventName === 'workflow_run') {
    const run = event.workflow_run;
    if (!run || !WORKFLOWS.includes(run.name) || run.event !== 'pull_request' ||
        run.repository?.full_name !== repository) return [];
    candidates = (run.pull_requests ?? []).map(p => p.number);
    if (!candidates.length && /^[a-f0-9]{40}$/i.test(run.head_sha ?? '')) candidates =
      (await api.list(`${api.root}/commits/${run.head_sha}/pulls`)).map(p => p.number);
  } else if (eventName === 'schedule') candidates =
    (await api.list(`${api.root}/pulls?state=open&base=main`)).map(p => p.number);
  else return [];
  const result = [];
  for (const number of [...new Set(candidates)].filter(n => Number.isSafeInteger(n) && n > 0)) {
    const pr = await api.request(`${api.root}/pulls/${number}`);
    if (pr.state !== 'open' || pr.base.repo.full_name !== repository || pr.base.ref !== 'main') continue;
    if (eventName === 'workflow_run' && (pr.head.sha !== event.workflow_run.head_sha ||
        pr.head.repo?.full_name !== event.workflow_run.head_repository?.full_name)) continue;
    result.push(number);
  }
  // GitHub matrix maximum is 256; fail visibly rather than silently omit PRs.
  if (result.length > 256) throw new Error('More than 256 open PRs; split reconciliation before running');
  return result.sort((a, b) => a - b);
}

export async function requiredPolicy(api, branch) {
  try {
    const rules = await api.list(`${api.root}/rules/branches/${encodeURIComponent(branch)}`);
    const statusRules = rules.filter(r => r.type === 'required_status_checks');
    if (statusRules.length) {
      const requirements = statusRules.flatMap(r => r.parameters.required_status_checks.map(c => {
        const integrationId = c.integration_id ?? null;
        if (integrationId !== null && (!Number.isSafeInteger(integrationId) || integrationId <= 0)) throw new Error('Invalid required-check integration ID');
        return { context: c.context, integrationId };
      }));
      // Multiple active rules can bind the same context to different apps.
      const unique = new Map(requirements.map(r => [JSON.stringify([r.context, r.integrationId]), r]));
      return { required: [...unique.values()].sort((a, b) => a.context.localeCompare(b.context, 'en') ||
        (a.integrationId ?? 0) - (b.integrationId ?? 0)), requiredSource: 'active GitHub branch rules' };
    }
  } catch (error) {
    if (![403, 404, 422].includes(error.status)) throw error;
  }
  // Branch rules do not cover legacy branch protection. Do not treat an empty
  // result as evidence that no checks are required or widen token permissions.
  return branch === 'main' ? { required: [...PROJECT_REQUIRED], requiredSource: 'documented main policy fallback; live enforcement unconfirmed' } :
    { required: [], requiredSource: 'unknown for this base branch' };
}

export async function collectThreads(api, number) {
  const threads = [];
  let after = null;
  do {
    const [owner, name] = api.root.slice('/repos/'.length).split('/');
    const result = await api.request('/graphql', 'POST', { query: `query($owner:String!,$name:String!,$number:Int!,$after:String) {
      repository(owner:$owner,name:$name) { pullRequest(number:$number) { reviewThreads(first:100,after:$after) {
        nodes { isResolved path comments(first:1) { nodes { author { login __typename } updatedAt } } }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, variables: { owner, name, number, after } });
    if (result.errors) throw new Error('Review thread data unavailable');
    const page = result.data?.repository?.pullRequest?.reviewThreads;
    if (!page) throw new Error('Review thread data unavailable');
    threads.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

export async function jobApp(api, job, checkRuns) {
  // Extract only a numeric ID from an exact same-repository GitHub API URL;
  // construct our own endpoint rather than following a returned URL.
  const prefix = `https://api.github.com${api.root}/check-runs/`;
  const suffix = job.check_run_url?.startsWith(prefix) ? job.check_run_url.slice(prefix.length) : '';
  if (!/^\d+$/.test(suffix)) return null;
  const id = Number(suffix);
  if (!Number.isSafeInteger(id)) return null;
  let linked = checkRuns.find(c => c.id === id);
  if (!linked) {
    try { linked = await api.request(`${api.root}/check-runs/${id}`); } catch { return null; }
  }
  // Check identity must belong to this job, not merely share its name.
  if (linked.id !== id || linked.name !== job.name || !Number.isSafeInteger(linked.app?.id)) return null;
  return linked.app;
}

export function workflowPathMatches(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' &&
    (actual === expected || actual.startsWith(`${expected}@`));
}

export async function collect(api, number, repository) {
  const pr = await api.request(`${api.root}/pulls/${number}`);
  if (pr.state !== 'open' || pr.base.repo.full_name !== repository || pr.base.ref !== 'main') return null;
  const notes = [];
  async function optional(fn, fallback, note) {
    try { return await fn(); } catch { if (note) notes.push(note); return fallback; }
  }
  const [files, comments, reviews, inlineComments, checkRuns, statuses, runs, policy, threadResult] = await Promise.all([
    api.list(`${api.root}/pulls/${number}/files`), api.list(`${api.root}/issues/${number}/comments`),
    api.list(`${api.root}/pulls/${number}/reviews`),
    optional(() => api.list(`${api.root}/pulls/${number}/comments`), [], 'Inline automated-review activity unavailable'),
    api.list(`${api.root}/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs'),
    api.list(`${api.root}/commits/${pr.head.sha}/statuses`),
    api.list(`${api.root}/actions/runs?event=pull_request&head_sha=${pr.head.sha}`, 'workflow_runs'),
    requiredPolicy(api, pr.base.ref),
    optional(async () => ({ threads: await collectThreads(api, number), threadsAvailable: true }),
      { threads: [], threadsAvailable: false }, 'CodeRabbit thread data unavailable; open-thread count is unknown'),
  ]);
  if (files.length !== pr.changed_files) throw new Error('Changed-file listing is incomplete or PR changed during collection; retry');
  // Prefer jobs in the newest run, not old successful checks during a rerun.
  const workflowPaths = { CI: '.github/workflows/ci.yml', 'Modular PR Validation': '.github/workflows/modular-pr-validation.yml' };
  const relevant = runs.filter(r => workflowPathMatches(r.path, workflowPaths[r.name]) && r.head_sha === pr.head.sha &&
    (r.pull_requests?.some(p => p.number === number) ||
     (r.head_repository?.full_name === pr.head.repo?.full_name && r.head_branch === pr.head.ref)));
  const newest = [];
  for (const run of relevant.sort((a, b) => b.id - a.id)) {
    if (!newest.some(r => r.name === run.name)) newest.push(run);
  }
  const runChecks = (await Promise.all(newest.map(async run => {
    const jobs = await api.list(`${api.root}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    return Promise.all(jobs.map(async job => ({ ...job, workflow: run.name, app: await jobApp(api, job, checkRuns) })));
  }))).flat();
  const namesForActiveRuns = new Set(GATES.filter(g => newest.some(r => r.name === g[1])).map(g => g[2]));
  if (newest.some(r => r.name === 'CI')) namesForActiveRuns.add('Playwright E2E (Non-gating)');
  if (newest.some(r => r.name === 'Modular PR Validation')) namesForActiveRuns.add('Modular Staging');
  const checks = [...runChecks, ...checkRuns.filter(c => !namesForActiveRuns.has(c.name)),
    ...statuses.filter((c, i, all) => all.findIndex(s => s.context === c.context) === i).map(c => ({ ...c, name: c.context }))];
  return { pr, repository, paths: sorted(files.flatMap(f => [f.filename, f.previous_filename].filter(Boolean))),
    comments, reviews, inlineComments, checks, ...policy, ...threadResult, collectionNotes: notes };
}

export function ownedComment(comments) {
  return comments.find(c => c.user?.login === 'github-actions[bot]' && c.user.type === 'Bot' && c.body?.startsWith(MARKER));
}

export async function publish(api, data, generation) {
  const fresh = await api.request(`${api.root}/pulls/${data.pr.number}`);
  if (fresh.state !== 'open' || fresh.head.sha !== data.pr.head.sha || fresh.updated_at !== data.pr.updated_at ||
      fresh.base.ref !== data.pr.base.ref) return 'stale';
  const comments = await api.list(`${api.root}/issues/${data.pr.number}/comments`);
  const existing = ownedComment(comments);
  const previousGeneration = Number(existing?.body.match(/<!-- secretary-run:(\d+) -->/)?.[1] ?? 0);
  if (previousGeneration > generation) return 'superseded';
  const content = render(data);
  const oldContent = existing?.body.replace(/\n<!-- secretary-run:\d+ -->$/, '');
  if (oldContent === content) return 'unchanged';
  const body = `${content}\n<!-- secretary-run:${generation} -->`;
  if (body.length > 65000) throw new Error('Summary exceeds comment limit; refusing truncated state');
  if (existing) await api.request(`${api.root}/issues/comments/${existing.id}`, 'PATCH', { body });
  else await api.request(`${api.root}/issues/${data.pr.number}/comments`, 'POST', { body });
  return existing ? 'updated' : 'created';
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = createApi(process.env.GH_TOKEN, repository);
  if (process.argv[2] === 'resolve') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const prs = await resolvePRs(api, process.env.GITHUB_EVENT_NAME, event, repository);
    await appendFile(process.env.GITHUB_OUTPUT, `prs=${JSON.stringify(prs)}\n`);
    console.log(`Resolved ${prs.length} PR(s)`);
  } else if (process.argv[2] === 'summarize') {
    const number = Number(process.env.SECRETARY_PR);
    const generation = Number(process.env.GITHUB_RUN_ID);
    if (!Number.isSafeInteger(number) || number <= 0 || !Number.isSafeInteger(generation) || generation <= 0) throw new Error('Invalid PR/run number');
    const data = await collect(api, number, repository);
    console.log(data ? await publish(api, data, generation) : 'No eligible open PR');
  } else throw new Error('Usage: pr-secretary.mjs resolve|summarize');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
