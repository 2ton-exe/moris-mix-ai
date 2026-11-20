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
// Intended modular-only fallback for main; live branch rules take precedence.
// Source: docs/devops/modular-workflows.md; this does not assert policy handoff.
export const PROJECT_REQUIRED = Object.freeze(['Modular Frontend / Frontend Checks', 'Modular Database / Database Tests', 'Modular Edge/API / Edge/API Tests']
  .map(context => Object.freeze({ context, integrationId: null, integrationUnverified: true })));
const AREA_ORDER = ['Frontend', 'Backend/API', 'AI', 'Database', 'DevOps', 'Integration'];
const WORKFLOWS = ['Modular PR Validation'];
const MAIN_VALIDATION = 'Modular Main Validation';
const REVIEW_SIGNAL = 'PR Secretary Review Signal';
const WORKFLOW_PATHS = new Map([
  [WORKFLOWS[0], '.github/workflows/modular-pr-validation.yml'],
  [MAIN_VALIDATION, '.github/workflows/modular-main.yml'],
  [REVIEW_SIGNAL, '.github/workflows/pr-secretary-review-signal.yml'],
]);
const REVIEW_EVENTS = ['pull_request_review', 'pull_request_review_comment'];
const PR_ACTIONS = ['opened', 'reopened', 'synchronize', 'edited', 'converted_to_draft', 'ready_for_review',
  'closed', 'review_requested', 'review_request_removed'];
const validId = value => Number.isSafeInteger(value) && value > 0;
const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validRepo = value => typeof value === 'string' && /^[\w-]+\/[\w.-]+$/.test(value) && !/\/\.{1,2}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const eligiblePR = (pr, repository, number) => pr?.number === number && validId(number) &&
  ['open', 'closed'].includes(pr.state) && validSha(pr.head?.sha) &&
  pr.base?.ref === 'main' && pr.base.repo?.full_name === repository;
const mainRun = (run, repository) => run?.name === MAIN_VALIDATION && validId(run.id) &&
  workflowPathMatches(run.path, WORKFLOW_PATHS.get(MAIN_VALIDATION)) &&
  run.repository?.full_name === repository && run.head_repository?.full_name === repository &&
  run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) && validSha(run.head_sha);
const headMatches = (run, pr) => validSha(run.head_sha) && pr.head.sha === run.head_sha &&
  typeof run.head_branch === 'string' && run.head_branch === pr.head.ref &&
  typeof run.head_repository?.full_name === 'string' && run.head_repository.full_name === pr.head.repo?.full_name;
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
const areas = values => AREA_ORDER.filter(a => values.includes(a));
const human = user => user?.type === 'User' && typeof user.login === 'string' && user.login.length > 0 && !user.login.endsWith('[bot]');
export const isCodeRabbit = user => (user?.type === 'Bot' || user?.__typename === 'Bot') &&
  ['coderabbitai', 'coderabbitai[bot]'].includes(user.login?.toLowerCase());
export const reviewer = login => Object.hasOwn(TEAM, login.toLowerCase()) ? TEAM[login.toLowerCase()] : { name: login, role: null };
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
    pr.user?.login?.toLowerCase() !== 'dependabot[bot]';
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

const STAGING_CALLER = 'Modular Staging';
const STAGING_DEPLOY = 'Modular Staging / Staging Deploy';
const STAGING_SMOKE = 'Modular Staging / Staging Smoke';

export const GATES = [
  ['Frontend', 'Modular PR Validation', 'Modular Frontend / Frontend Checks'],
  ['Database', 'Modular PR Validation', 'Modular Database / Database Tests'],
  ['Edge/API', 'Modular PR Validation', 'Modular Edge/API / Edge/API Tests'],
  ['Hosted RLS', 'Modular PR Validation', 'Modular Edge/API / Hosted RLS Integration'],
  ['E2E (non-gating)', 'Modular PR Validation', 'Modular E2E / Playwright E2E Tests'],
  ['Staging deploy', 'Modular PR Validation', STAGING_DEPLOY],
  ['Staging smoke', 'Modular PR Validation', STAGING_SMOKE],
  ['Production deploy', 'Modular Main Validation', 'Modular Main Production / Deploy to Supabase and Cloudflare'],
];

function gateChecks(checks, workflow, name) {
  const aliases = [name];
  if (name.startsWith('Modular E2E / ')) aliases.push('Modular E2E');
  return checks.filter(c => aliases.includes(c.name) && (!c.workflow || c.workflow === workflow) &&
    (!c.app || c.app.slug === 'github-actions') && !c.context);
}

function docsOnlySkip(checks, check) {
  return Number.isSafeInteger(check?.run_id) && checks.some(c =>
    c.name === 'Classify PR paths' && c.workflow === 'Modular PR Validation' &&
    c.app?.slug === 'github-actions' && c.run_id === check.run_id &&
    c.status === 'completed' && c.conclusion === 'success' &&
    c.steps?.some(s => s.name === 'Record documentation-only E2E/staging skips' &&
      s.status === 'completed' && s.conclusion === 'success'));
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
    if (!human(r.user) || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED'].includes(r.state) ||
        !timestamp(r.submitted_at)) continue;
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
  const requiredRows = new Set();
  const stagingDeploy = gateChecks(checks, WORKFLOWS[0], STAGING_DEPLOY)[0];
  const stagingSmoke = gateChecks(checks, WORKFLOWS[0], STAGING_SMOKE)[0];
  const stagingCaller = gateChecks(checks, WORKFLOWS[0], STAGING_CALLER)[0];
  const skippedStagingCaller = !stagingDeploy && !stagingSmoke &&
    stagingCaller?.status === 'completed' && stagingCaller.conclusion === 'skipped' ? stagingCaller : undefined;
  if (stagingCaller?.status === 'completed' && normalize(stagingCaller) === 'FAIL') {
    attention.push('Staging caller: FAIL (inspect workflow execution)');
  }
  const rows = GATES.map(([label, workflow, name]) => {
    const staging = name === STAGING_DEPLOY || name === STAGING_SMOKE;
    const evidence = gateChecks(checks, workflow, name);
    const unexpectedProduction = label === 'Production deploy' ? evidence.find(c =>
      !(c.status === 'completed' && c.conclusion === 'skipped')) : undefined;
    const check = staging ? (evidence[0]?.status ? evidence[0] : skippedStagingCaller) : unexpectedProduction ?? evidence[0];
    const expectedSkip = label === 'Production deploy' ||
      (staging && skippedStagingCaller && (!stagingEligible(pr, repository) || docsOnlySkip(checks, skippedStagingCaller))) ||
      (label === 'E2E (non-gating)' && docsOnlySkip(checks, check)) ||
      label === 'Hosted RLS';
    const applicable = pr.base.ref === 'main';
    let state = normalize(check, { expectedSkip, applicable });
    if (name === STAGING_SMOKE && state === 'SKIPPED — INVESTIGATE' &&
      Number.isSafeInteger(check.run_id) && stagingDeploy?.run_id === check.run_id &&
      Number.isSafeInteger(check.run_attempt) &&
      stagingDeploy.run_attempt === check.run_attempt && stagingDeploy.status === 'completed' &&
      normalize(stagingDeploy) === 'FAIL') state = 'SKIPPED — DEPLOY FAILED';
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
    if (gateIndex >= 0 && required.filter(r => r.context === context).length === 1) {
      rows[gateIndex][1] = state;
      requiredRows.add(rows[gateIndex]);
    } else {
      const row = [`${context} (required${identity})`, state];
      requiredRows.add(row);
      rows.push(row);
    }
  }
  if (paths.some(delivery)) attention.push('workflow/deployment configuration changed; inspect delivery and secrets boundaries');
  if (paths.some(migration)) attention.push('migration files changed; inspect schema and environment delivery safety');
  if (rabbit.count) attention.push(`${rabbit.count} unresolved CodeRabbit review thread${rabbit.count === 1 ? '' : 's'}`);
  const requested = pr.requested_reviewers.filter(human);
  const humans = humanReviews(pr.state === 'open' ? requested : [], data.reviews, pr.head.sha);
  if (pr.state === 'open' && !pr.draft) {
    if (humans.some(r => r.state === 'CHANGES REQUESTED')) attention.push('Review the current-revision changes requested');
    else if (!requested.length && !pr.requested_teams?.length && !humans.some(r => r.state === 'APPROVED')) {
      attention.push('Ready PR has no requested human reviewer and no recorded current-revision human approval');
    }
  }
  if (ownership.length >= 4) attention.push(`Changes span ${ownership.length} ownership areas; coordinate cross-layer verification`);
  if (data.collectionNotes?.length) attention.push(...data.collectionNotes);
  return { ownership, rabbit, attention: sorted(attention), rows, requested, humans, requiredRows };
}

const indicator = state => state.startsWith('PASS') || ['VERIFIED', 'APPROVED', 'MERGED'].includes(state) ? '✅' :
  ['RUNNING', 'WAITING', 'PENDING', 'OPEN', 'DRAFT'].includes(state) ? '⏳' :
  ['FAIL', 'CHANGES REQUESTED', 'CANCELLED', 'STALE', 'INTEGRATION MISMATCH'].includes(state) ||
  state.startsWith('CHANGES REQUESTED (') || state.includes('INVESTIGATE') ? '❌' : '➖';
const displayed = state => `${indicator(state)} ${md(state)}`;
const linkRun = (repository, run) => validId(run?.id) && validId(run?.run_attempt)
  ? `[run ${run.id}, attempt ${run.run_attempt}](https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt})` : null;

export function render(data) {
  const { pr } = data;
  const s = summarize(data);
  const open = pr.state === 'open';
  const merged = !open && pr.merged === true;
  const lifecycle = open ? (pr.draft ? 'DRAFT' : 'OPEN') : merged ? 'MERGED' : 'CLOSED WITHOUT MERGE';
  const requestedNames = [...s.requested.map(u => reviewer(u.login).name), ...(pr.requested_teams ?? []).map(t => `team: ${t.slug}`)];
  const required = s.rows.filter(row => s.requiredRows.has(row));
  const delivery = s.rows.filter(row => !s.requiredRows.has(row));
  const headRun = linkRun(data.repository, data.validationRun);
  const out = [MARKER, '', '## PR Secretary', '', `**${displayed(lifecycle)}** · #${pr.number} — ${md(pr.title)}`, '',
    `**${open ? 'PR head' : 'Final PR head'}** · \`${md(pr.head.sha)}\``];
  if (merged) out.push(`**Merge on main** · ${validSha(pr.merge_commit_sha) ? `\`${pr.merge_commit_sha}\`` : 'SHA unknown'} · ${timestamp(pr.merged_at) ? pr.merged_at : 'time unknown'}`);
  else if (!open && timestamp(pr.closed_at)) out.push(`**Closed** · ${pr.closed_at}`);
  if (headRun) out.push(`**PR validation workflow** · ${displayed(normalize(data.validationRun))} · ${headRun}`);
  out.push('', open ? '### Human reviews' : '### Historical human reviews', '');
  if (open) out.push(`**Requested reviewers:** ${requestedNames.map(md).join(', ') || 'None'}`, '');
  if (s.humans.length) out.push(...s.humans.map(r => `- ${md(reviewer(r.login).name)} — ${displayed(r.state)}`));
  else out.push('➖ No submitted human reviews recorded.');
  out.push('', '<sub>Review history is separate from GitHub’s merge decision.</sub>');
  const table = rows => ['| Evidence | Status |', '| --- | --- |', ...rows.map(([label, state]) => `| ${md(label)} | ${displayed(state)} |`)];
  out.push('', open ? '### Required checks' : '### Required checks on final PR head', '',
    ...(required.length ? table(required) : ['➖ No required contexts established.']), '', `Policy source · ${md(data.requiredSource)}`);
  const optionalDelivery = delivery.filter(([label]) => ['E2E (non-gating)', 'Staging deploy', 'Staging smoke'].includes(label));
  if (optionalDelivery.length) out.push('', `**Other PR delivery** · ${optionalDelivery.map(([label, state]) =>
    `${md(label)} ${displayed(state)}`).join(' · ')}`);
  if (merged) {
    const release = data.release ?? {};
    const mainLink = linkRun(data.repository, release.run);
    out.push('', '### Main delivery for this merge', '',
      mainLink ? `**Main workflow** · ${displayed(normalize(release.run))} · ${mainLink}` : '➖ No exact main workflow run established.', '',
      ...table([['Main validation', release.validation], ['Main E2E', release.e2e],
        ['Production deployment', release.deploy], ['Production smoke', release.smoke]]
        .map(([label, state]) => [label, state ?? 'UNKNOWN'])));
  }
  out.push('', '### Automated review', '', `**CodeRabbit (optional)** · ${s.rabbit.state}`,
    `**Open threads:** ${s.rabbit.count ?? 'Unavailable'}`);
  if (open && s.attention.length) out.push('', '### Attention', '', ...s.attention.map(a => `- ${md(a)}`));
  out.push('', '<details>', '<summary>Detailed evidence</summary>', '',
    `**Affected ownership** · ${md(s.ownership.join(', ') || 'Unclassified')}`, '', '#### Other PR-head checks', '', ...table(delivery));
  if (s.rabbit.latest) out.push('', `**Latest CodeRabbit activity** · ${md(s.rabbit.latest)}`);
  if (s.rabbit.paths.length) out.push('', `**Thread paths** · ${s.rabbit.paths.slice(0, 5).map(md).join(', ')}${s.rabbit.paths.length > 5 ? ` (+${s.rabbit.paths.length - 5} more)` : ''}`);
  for (const u of open ? s.requested : []) {
    const r = reviewer(u.login);
    out.push('', `#### ${md(r.name)} — ${md(r.role ?? 'General')} review`, '', ...checklist(u.login, s.ownership, s.rabbit.routedOwnership).map(b => `- ${b}`));
  }
  if (!open && data.collectionNotes?.length) out.push('', ...data.collectionNotes.map(note => `- ${md(note)}`));
  out.push('', '</details>');
  return out.join('\n');
}

export function createApi(token, repository, fetcher = fetch) {
  if (!validRepo(repository)) throw new Error('Invalid repository');
  const root = `/repos/${repository}`;
  let requests = 0;
  const exhausted = new Set();
  const diagnosticText = value => {
    if (typeof value !== 'string') return '';
    let text = token ? value.split(token).join('[REDACTED]') : value;
    text = text.replace(/\bauthorization\s*:[^\r\n]*/gi, '[REDACTED authorization]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[REDACTED]');
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 400);
  };
  async function request(path, method = 'GET', body) {
    if (++requests > 120) throw new Error('PR Secretary API request budget exceeded');
    const resource = path === '/graphql' ? 'GraphQL' : 'REST';
    if (exhausted.has(resource)) throw new Error(`GitHub ${resource} rate limit exhausted; wait for reconciliation`);
    // All endpoints are constructed locally. Never follow an API-provided URL with the token.
    const response = await fetcher(`https://api.github.com${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (response.headers?.get('x-ratelimit-remaining') === '0') exhausted.add(resource);
    if (!response.ok) {
      // Allowlist diagnostic fields only. Never log the request body/headers,
      // arbitrary response fields, raw HTML, or JSON parse errors with excerpts.
      let details;
      try { details = await response.json(); } catch { /* Status is still useful. */ }
      const message = diagnosticText(details?.message);
      let documentation;
      try {
        const url = new URL(details?.documentation_url);
        if (url.origin === 'https://docs.github.com' && !url.username && !url.password && !url.search) {
          documentation = diagnosticText(url.href);
        }
      } catch { /* Ignore absent/untrusted documentation URLs. */ }
      const fields = [];
      if (message) fields.push(`message=${JSON.stringify(message)}`);
      if (documentation) fields.push(`documentation_url=${JSON.stringify(documentation)}`);
      const accepted = response.headers?.get('x-accepted-github-permissions');
      if (accepted && accepted.length <= 400 && /^[a-z_]+=(?:read|write|admin)(?:[;,]\s*[a-z_]+=(?:read|write|admin))*$/.test(accepted)) {
        fields.push(`accepted_permissions=${JSON.stringify(accepted)}`);
      }
      const requestId = response.headers?.get('x-github-request-id');
      if (/^[A-Z0-9:]{1,100}$/.test(requestId ?? '')) fields.push(`request_id=${requestId}`);
      const retryAfter = response.headers?.get('retry-after');
      if (/^\d{1,8}$/.test(retryAfter ?? '')) {
        exhausted.add(resource);
        fields.push(`retry_after_seconds=${retryAfter}`);
      }
      const error = new Error(`GitHub ${method} ${path.split('?')[0]}: ${response.status}${fields.length ? `; ${fields.join('; ')}` : ''}`);
      error.status = response.status;
      if (message) error.githubMessage = message;
      if (documentation) error.documentation_url = documentation;
      throw error;
    }
    return response.json();
  }
  async function list(path, key) {
    const all = [];
    for (let page = 1; page <= 32; page++) {
      const result = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = key ? result[key] : result;
      if (!Array.isArray(items)) throw new Error('Invalid paginated API response');
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw new Error('PR Secretary API pagination limit exceeded');
  }
  return { root, request, list };
}

export async function resolvePRs(api, eventName, event, repository, { ref, now = Date.now() } = {}) {
  if (!event || (event.repository && event.repository.full_name !== repository)) return [];
  let candidates = [];
  let fallback = false;
  const run = event.workflow_run;
  if (eventName === 'pull_request_target') {
    if (event.repository?.full_name !== repository || !PR_ACTIONS.includes(event.action) ||
      event.pull_request?.number !== event.number || event.pull_request?.base?.repo?.full_name !== repository ||
      event.pull_request?.base?.ref !== 'main') return [];
    candidates = [event.number];
  } else if (eventName === 'issue_comment') {
    if (!event.issue?.pull_request || !isCodeRabbit(event.comment?.user)) return [];
    candidates = [event.issue.number];
  } else if (eventName === 'workflow_run') {
    if (!run || !validId(run.id) || !validSha(run.head_sha) || run.repository?.full_name !== repository ||
        !workflowPathMatches(run.path, WORKFLOW_PATHS.get(run.name)) ||
        !['requested', 'in_progress', 'completed'].includes(event.action)) return [];
    if (run.name === MAIN_VALIDATION) {
      if (!mainRun(run, repository)) return [];
    } else if (run.name === REVIEW_SIGNAL) {
      if (!REVIEW_EVENTS.includes(run.event) || event.action !== 'completed' || run.conclusion !== 'success') return [];
    } else if (run.name !== WORKFLOWS[0] || run.event !== 'pull_request') return [];
    if (run.name !== MAIN_VALIDATION && (!validRepo(run.head_repository?.full_name) ||
        typeof run.head_branch !== 'string' || !run.head_branch || run.head_branch.length > 1024)) return [];
    const associations = run.pull_requests ?? [];
    if (!Array.isArray(associations)) return [];
    if (run.name === MAIN_VALIDATION || associations.length === 0) {
      // Only GitHub's structured associations can supply a candidate. The
      // commit association can include other PRs that happen to contain a SHA.
      fallback = run.name !== MAIN_VALIDATION;
      try {
        candidates = (await api.list(`${api.root}/commits/${run.head_sha}/pulls`)).map(p => p.number);
      } catch (error) { if (error.status !== 404) throw error; }
      if (fallback && !candidates.length) {
        const owner = run.head_repository.full_name.split('/')[0];
        const head = encodeURIComponent(`${owner}:${run.head_branch}`);
        candidates = (await api.list(`${api.root}/pulls?state=all&base=main&head=${head}`)).map(p => p.number);
      }
    } else candidates = associations.map(p => p?.number);
    if (candidates.length > 20) throw new Error('Too many associated PRs for one workflow run');
  } else if (eventName === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main' || event.repository?.full_name !== repository ||
      typeof event.inputs?.pr !== 'string' || !/^[1-9]\d{0,9}$/.test(event.inputs.pr)) return [];
    candidates = [Number(event.inputs.pr)];
  } else if (eventName === 'schedule') {
    const [open, closed] = await Promise.all([
      api.list(`${api.root}/pulls?state=open&base=main`),
      api.request(`${api.root}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=30`),
    ]);
    const recent = closed.filter(p => timestamp(p.closed_at) && Date.parse(p.closed_at) >= now - 7 * 86_400_000)
      .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at)).slice(0, 10);
    const numbers = [...new Set([...open, ...recent].map(p => p.number))].filter(validId);
    if (numbers.length > 256) throw new Error('More than 256 eligible PRs; split reconciliation before running');
    return numbers.sort((a, b) => a - b);
  } else return [];
  const result = [];
  for (const number of [...new Set(candidates)].filter(validId)) {
    let pr;
    try { pr = await api.request(`${api.root}/pulls/${number}`); }
    catch (error) { if (error.status === 404) continue; throw error; }
    if (!eligiblePR(pr, repository, number)) continue;
    if (eventName === 'workflow_run') {
      if (run.name === MAIN_VALIDATION) {
        if (pr.state !== 'closed' || pr.merged !== true || pr.merge_commit_sha !== run.head_sha) continue;
      } else if (!headMatches(run, pr)) continue;
    }
    result.push(number);
  }
  if (fallback && result.length !== 1) return [];
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
  for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
    const [owner, name] = api.root.slice('/repos/'.length).split('/');
    const result = await api.request('/graphql', 'POST', { query: `query($owner:String!,$name:String!,$number:Int!,$after:String) {
      repository(owner:$owner,name:$name) { pullRequest(number:$number) { reviewThreads(first:100,after:$after) {
        nodes { isResolved path comments(first:1) { nodes { author { login __typename } updatedAt } } }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, variables: { owner, name, number, after } });
    if (result.errors) throw new Error('Review thread data unavailable');
    const page = result.data?.repository?.pullRequest?.reviewThreads;
    if (!page || (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === after))) {
      throw new Error('Review thread data unavailable or pagination stalled');
    }
    threads.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return threads;
    after = page.pageInfo.endCursor;
  }
  throw new Error('Review thread pagination limit exceeded');
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

const MAIN_CORE_JOBS = ['Modular Main Frontend / Frontend Checks', 'Modular Main Database / Database Tests',
  'Modular Main Edge/API / Edge/API Tests', 'Modular Main Edge/API / Hosted RLS Integration'];
const MAIN_PRODUCTION_JOB = 'Modular Main Production / Deploy to Supabase and Cloudflare';
const ESSENTIAL_DEPLOY_STEPS = ['Deploy recipes Edge Function', 'Deploy extract-recipe Edge Function',
  'Deploy generate-recipe Edge Function', 'Deploy recipe-image-attach Edge Function', 'Deploy to Cloudflare Workers'];
const SMOKE_STEPS = ['Verify production deployment URL', 'Verify deployed AI routes', 'Production runtime smoke'];

export function releaseEvidence(run, jobs) {
  const pending = run.status !== 'completed';
  const state = check => check ? normalize(check, { expectedSkip: true }) : pending ? 'PENDING' : 'UNKNOWN';
  const group = states => {
    for (const verdict of ['FAIL', 'CANCELLED', 'RUNNING', 'PENDING', 'SKIPPED — EXPECTED']) {
      if (states.includes(verdict)) return verdict === 'SKIPPED — EXPECTED' ? 'SKIPPED' : verdict;
    }
    return states.every(item => item === 'PASS') ? 'VERIFIED' : 'UNKNOWN';
  };
  const job = name => jobs.find(item => item.name === name);
  const production = job(MAIN_PRODUCTION_JOB);
  const skipped = state(production ?? job('Modular Main Production')) === 'SKIPPED — EXPECTED';
  const steps = production?.steps ?? [];
  const step = name => steps.find(item => item.name === name);
  // Feature-gated deploy steps may legitimately skip, but a failed deploy
  // step still counts even when it is outside the essential set.
  const deploySteps = [...ESSENTIAL_DEPLOY_STEPS.map(step),
    ...steps.filter(item => item.name.startsWith('Deploy ') && !ESSENTIAL_DEPLOY_STEPS.includes(item.name) &&
      state(item) !== 'SKIPPED — EXPECTED')];
  const deploy = skipped ? 'SKIPPED' : group(deploySteps.map(state));
  const smoke = skipped ? 'SKIPPED' : group(SMOKE_STEPS.map(name => state(step(name))));
  return { run, validation: group(MAIN_CORE_JOBS.map(name => state(job(name)))),
    e2e: group([state(job('Modular Main E2E / Playwright E2E Tests'))]),
    deploy, smoke: smoke === 'VERIFIED' && deploy !== 'VERIFIED' ? 'UNKNOWN' : smoke };
}

async function collectRelease(api, pr, repository) {
  if (pr.state !== 'closed' || pr.merged !== true || !validSha(pr.merge_commit_sha) || !timestamp(pr.merged_at)) return null;
  const runs = await api.list(`${api.root}/actions/workflows/modular-main.yml/runs?branch=main&head_sha=${pr.merge_commit_sha}`, 'workflow_runs');
  const run = runs.filter(item => mainRun(item, repository) && item.head_sha === pr.merge_commit_sha)
    .sort((a, b) => b.id - a.id)[0];
  if (!run || !validId(run.run_attempt)) return null;
  const jobs = await api.list(`${api.root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
  return releaseEvidence(run, jobs.filter(job => job.run_id === run.id && job.run_attempt === run.run_attempt));
}

export async function collect(api, number, repository) {
  if (!validId(number)) return null;
  const pr = await api.request(`${api.root}/pulls/${number}`);
  if (!eligiblePR(pr, repository, number)) return null;
  const notes = [];
  async function optional(fn, fallback, note) {
    try { return await fn(); } catch { if (note) notes.push(note); return fallback; }
  }
  const [files, comments, reviews, inlineComments, checkRuns, statuses, runs, policy, threadResult, release] = await Promise.all([
    api.list(`${api.root}/pulls/${number}/files`), api.list(`${api.root}/issues/${number}/comments`),
    api.list(`${api.root}/pulls/${number}/reviews`),
    optional(() => api.list(`${api.root}/pulls/${number}/comments`), [], 'Inline automated-review activity unavailable'),
    api.list(`${api.root}/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs'),
    api.list(`${api.root}/commits/${pr.head.sha}/statuses`),
    api.list(`${api.root}/actions/runs?event=pull_request&head_sha=${pr.head.sha}`, 'workflow_runs'),
    requiredPolicy(api, pr.base.ref),
    optional(async () => ({ threads: await collectThreads(api, number), threadsAvailable: true }),
      { threads: [], threadsAvailable: false }, 'CodeRabbit thread data unavailable; open-thread count is unknown'),
    optional(() => collectRelease(api, pr, repository), null, 'Exact main delivery evidence unavailable from GitHub'),
  ]);
  if (files.length !== pr.changed_files) throw new Error('Changed-file listing is incomplete or PR changed during collection; retry');
  // Prefer jobs in the newest run, not old successful checks during a rerun.
  const relevant = runs.filter(r => r.name === WORKFLOWS[0] && validId(r.id) &&
    workflowPathMatches(r.path, WORKFLOW_PATHS.get(WORKFLOWS[0])) && r.head_sha === pr.head.sha &&
    (r.pull_requests?.some(p => p.number === number) ||
     (r.head_repository?.full_name === pr.head.repo?.full_name && r.head_branch === pr.head.ref)));
  const newest = [];
  for (const run of relevant.sort((a, b) => b.id - a.id)) {
    if (!newest.some(r => r.name === run.name)) newest.push(run);
  }
  const runChecks = (await Promise.all(newest.map(async run => {
    const jobs = await api.list(`${api.root}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    const current = run.status && run.status !== 'completed' && validId(run.run_attempt)
      ? jobs.filter(job => job.run_attempt === run.run_attempt) : jobs;
    return Promise.all(current.map(async job => ({ ...job, workflow: run.name, app: await jobApp(api, job, checkRuns) })));
  }))).flat();
  // Staging rows must come from the selected run; head-SHA checks can mix runs.
  const namesForActiveRuns = new Set([STAGING_CALLER, STAGING_DEPLOY, STAGING_SMOKE,
    ...GATES.filter(g => newest.some(r => r.name === g[1])).map(g => g[2])]);
  if (newest.some(r => r.name === 'Modular PR Validation')) namesForActiveRuns.add('Modular E2E');
  const checks = [...runChecks, ...checkRuns.filter(c => !namesForActiveRuns.has(c.name)),
    ...statuses.filter((c, i, all) => all.findIndex(s => s.context === c.context) === i).map(c => ({ ...c, name: c.context }))];
  return { pr, repository, paths: sorted(files.flatMap(f => [f.filename, f.previous_filename].filter(Boolean))),
    comments, reviews, inlineComments, checks, ...policy, ...threadResult, validationRun: newest[0], release, collectionNotes: notes };
}

export function ownedComment(comments) {
  return comments.find(c => c.user?.login === 'github-actions[bot]' && c.user.type === 'Bot' && c.body?.startsWith(MARKER));
}

function lifecycleKey(pr) {
  // updated_at also changes for unrelated comment/review/metadata activity.
  // Guard render inputs and terminal identity without tying a merge to today's main tip.
  return JSON.stringify([pr.state, pr.head.sha, pr.head.repo?.full_name, pr.head.ref,
    pr.state === 'open' ? pr.base.sha : null, pr.title, pr.draft, pr.merged,
    pr.state === 'closed' ? pr.merge_commit_sha : null, pr.merged_at, pr.closed_at,
    sorted((pr.requested_reviewers ?? []).filter(human).map(u => u.login)),
    sorted((pr.requested_teams ?? []).map(t => t.slug))]);
}

const publicationFooter = /(?:\n\n<sub>Last dashboard update · ([\dTZ:.\-]+)<\/sub>)?\n<!-- secretary-run:(\d+) -->$/;

export async function publish(api, data, generation, observedAt = Date.now()) {
  const number = data.pr.number;
  if (!validId(generation) || !validId(observedAt)) throw new Error('Invalid snapshot generation');
  const freshEnough = async () => {
    const current = await api.request(`${api.root}/pulls/${number}`);
    return eligiblePR(current, data.repository, number) && current.base.ref === data.pr.base.ref &&
      current.base.repo.full_name === data.pr.base.repo.full_name && lifecycleKey(current) === lifecycleKey(data.pr);
  };
  if (!await freshEnough()) return 'stale';
  const comments = await api.list(`${api.root}/issues/${number}/comments`);
  const existing = ownedComment(comments);
  const footer = existing?.body.match(publicationFooter);
  const previousGeneration = Number(footer?.[2] ?? 0);
  const previousObservation = Date.parse(footer?.[1]);
  if (previousObservation > observedAt ||
      ((!Number.isFinite(previousObservation) || previousObservation === observedAt) && previousGeneration > generation)) return 'superseded';
  const content = render(data);
  const oldContent = existing?.body.replace(publicationFooter, '');
  if (oldContent === content) return 'unchanged';
  const body = `${content}\n\n<sub>Last dashboard update · ${new Date(observedAt).toISOString()}</sub>\n<!-- secretary-run:${generation} -->`;
  if (body.length > 65000) throw new Error('Summary exceeds comment limit; refusing truncated state');
  if (!await freshEnough()) return 'stale';
  if (existing && !validId(existing.id)) throw new Error('Invalid owned comment ID');
  if (existing) await api.request(`${api.root}/issues/comments/${existing.id}`, 'PATCH', { body });
  else await api.request(`${api.root}/issues/${number}/comments`, 'POST', { body });
  return existing ? 'updated' : 'created';
}

export async function refresh(api, number, repository, generation, now = Date.now) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const observedAt = now();
    const data = await collect(api, number, repository);
    if (!data) return 'No eligible main-target PR';
    const result = await publish(api, data, generation, observedAt);
    if (result !== 'stale') return result;
  }
  return 'stale';
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = createApi(process.env.GH_TOKEN, repository);
  if (process.argv[2] === 'resolve') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const prs = await resolvePRs(api, process.env.GITHUB_EVENT_NAME, event, repository, { ref: process.env.GITHUB_REF });
    await appendFile(process.env.GITHUB_OUTPUT, `prs=${JSON.stringify(prs)}\n`);
    console.log(`Resolved ${prs.length} PR(s)`);
  } else if (process.argv[2] === 'summarize') {
    const number = Number(process.env.SECRETARY_PR);
    const generation = Number(process.env.GITHUB_RUN_ID);
    if (!validId(number) || !validId(generation)) throw new Error('Invalid PR/run number');
    console.log(await refresh(api, number, repository, generation));
  } else throw new Error('Usage: pr-secretary.mjs resolve|summarize');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
