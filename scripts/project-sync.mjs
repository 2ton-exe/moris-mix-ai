import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const CONFIG = Object.freeze({ owner: '2ton-exe', repo: 'moris-mix-ai',
  repository: '2ton-exe/moris-mix-ai', number: 2, title: '2ton.exe - Development Board' });
export const STATUSES = Object.freeze(['Todo', 'In Progress', 'In Review', 'Done']);
class SyncError extends Error {}
const requireValue = (ok, message) => { if (!ok) throw new SyncError(message); };
const one = (values, description) => {
  requireValue(values.length === 1, `Expected exactly one ${description}; found ${values.length}`);
  return values[0];
};
const id = value => typeof value === 'string' && value.length > 0;

// Parse body text only. Comments and code examples are not relationships.
export function relationships(body, native = [], rejected = null) {
  requireValue(typeof body === 'string' && Array.isArray(native), 'Incomplete relationship evidence');
  const numbers = new Set();
  const add = text => {
    // Consume a reference list, not arbitrary later numbers in explanatory prose.
    let remaining = text;
    while (remaining) {
      const match = remaining.match(/^\s*(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|([\w.-]+\/[\w.-]+)#(\d+)|#(\d+)\b)/i);
      if (!match) break;
      const repository = match[1] ?? match[3];
      if (!repository || repository.toLowerCase() === CONFIG.repository.toLowerCase()) {
        const number = Number(match[2] ?? match[4] ?? match[5]);
        if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
        else {
          // Standalone parsing stays strict; planning can quarantine this PR.
          requireValue(Array.isArray(rejected), 'Invalid issue relationship number');
          rejected.push({ issueNumber: null, reason: 'invalid issue relationship number' });
        }
      }
      remaining = remaining.slice(match[0].length);
      const separator = remaining.match(/^\s*(?:,|;|and\b|&)\s*/i);
      if (!separator) break;
      remaining = remaining.slice(separator[0].length);
    }
  };
  let relatedLevel = null;
  let fence = null;
  for (let line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t|\s*>)/.test(line)) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})(?:\s+(\S.*)?)?$/);
    if (heading) {
      const level = heading[1].length;
      const content = (heading[2] ?? '').trimEnd();
      let end = content.length;
      while (end > 0 && content[end - 1] === '#') end--;
      const title = content.slice(0, end).trimEnd();
      if (relatedLevel !== null && level <= relatedLevel) relatedLevel = null;
      if (/^Related (?:GitHub )?Issues?$/i.test(title)) relatedLevel = level;
      continue;
    }
    line = line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)\s*(?:\[[ xX]\]\s*)?/, '');
    const explicit = line.match(/^(?:Part\s+of|Refs?|Related\s+to|Closes?|Fix(?:es)?|Resolves?)\s*:?\s+(.+)$/i);
    if (explicit) add(explicit[1]);
    else if (relatedLevel !== null && /^(?:#\d+|https:\/\/github\.com\/|[\w.-]+\/[\w.-]+#)/i.test(line)) add(line);
  }
  for (const issue of native) {
    requireValue(issue && Number.isSafeInteger(issue.number) && id(issue.repository?.nameWithOwner), 'Malformed native issue relationship');
    if (issue.repository.nameWithOwner.toLowerCase() === CONFIG.repository.toLowerCase()) numbers.add(issue.number);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function desiredState(content, active = false) {
  if (content.__typename === 'Issue') {
    if (content.state === 'OPEN') return { status: active ? 'In Progress' : 'Todo', archive: false };
    requireValue(content.state === 'CLOSED', `Invalid issue state for #${content.number}`);
    if (content.stateReason === 'COMPLETED') return { status: 'Done' };
    if (content.stateReason === 'NOT_PLANNED') return { archive: true };
    throw new SyncError(`Unclassified closed issue #${content.number}: missing/unsupported state reason`);
  }
  requireValue(content.__typename === 'PullRequest', 'Unknown content type');
  if (content.state === 'MERGED') return { status: 'Done' };
  if (content.state === 'CLOSED') return { archive: true };
  requireValue(content.state === 'OPEN' && typeof content.isDraft === 'boolean', `Invalid PR state for #${content.number}`);
  return { status: content.isDraft ? 'In Progress' : 'In Review', archive: false };
}

export function discover(projects, fields) {
  const project = one(projects.filter(p => p.number === CONFIG.number), `Project number ${CONFIG.number}`);
  requireValue(project.title === CONFIG.title && project.owner?.login === CONFIG.owner &&
    project.owner.__typename === 'Organization' && id(project.id) && project.closed === false, 'Project identity mismatch or closed Project');
  one(projects.filter(p => p.title === CONFIG.title), `Project title ${CONFIG.title}`);
  const field = one(fields.filter(f => f.name === 'Status'), 'Status field');
  requireValue(field.__typename === 'ProjectV2SingleSelectField' && id(field.id) && Array.isArray(field.options), 'Status must be a single-select field');
  const options = Object.fromEntries(STATUSES.map(name => {
    const option = one(field.options.filter(o => o.name === name), `Status option ${name}`);
    requireValue(id(option.id), `Missing option ID for ${name}`);
    return [name, option.id];
  }));
  requireValue(field.options.length === STATUSES.length && new Set(Object.values(options)).size === STATUSES.length,
    'Unexpected or duplicate Status options; expected the four established values');
  return { projectId: project.id, fieldId: field.id, options };
}

export function indexItems(items) {
  const byContent = new Map();
  for (const item of items) {
    requireValue(id(item?.id) && typeof item.isArchived === 'boolean' && item.content, 'Malformed or inaccessible Project item');
    requireValue(Object.hasOwn(item, 'fieldValueByName') && (item.fieldValueByName === null ||
      (id(item.fieldValueByName?.name) && id(item.fieldValueByName?.optionId))), `Malformed Status value on item ${item.id}`);
    if (item.content.__typename === 'DraftIssue') continue;
    requireValue(['Issue', 'PullRequest'].includes(item.content.__typename), `Unsupported Project content on item ${item.id}`);
    requireValue(id(item.content.id) && id(item.content.repository?.nameWithOwner), `Incomplete content for item ${item.id}`);
    const previous = byContent.get(item.content.id);
    requireValue(!previous, `Duplicate Project content ${item.content.id}: items ${previous?.id}, ${item.id}`);
    byContent.set(item.content.id, item);
  }
  return byContent;
}

// Plan the entire repository before allowing any writes. Missing historical
// closed content is not imported, except a freshly closed event's own content.
export function plan({ issues, prs, items, eventContentId = null }, metadata) {
  const byContent = indexItems(items);
  const byNumber = new Map();
  const contents = new Map();
  for (const content of [...issues, ...prs]) {
    requireValue(id(content?.id) && Number.isSafeInteger(content.number) && content.number > 0 &&
      content.repository?.nameWithOwner === CONFIG.repository, 'Invalid repository content');
    requireValue(!contents.has(content.id) && !byNumber.has(content.number), `Duplicate repository content #${content.number}`);
    contents.set(content.id, content);
    byNumber.set(content.number, content);
  }
  const activeIssues = new Set();
  const uncertainIssues = new Set();
  const rejectedRelationships = [];
  for (const pr of prs.filter(p => p.state === 'OPEN')) {
    requireValue(Array.isArray(pr.nativeIssues), `Incomplete native relationship evidence for PR #${pr.number}`);
    const rejected = [];
    const resolved = [];
    for (const number of relationships(pr.body, pr.nativeIssues, rejected)) {
      const issue = byNumber.get(number);
      if (issue?.__typename === 'Issue') resolved.push(issue.id);
      else rejected.push({ issueNumber: number, reason: 'unresolvable issue relationship' });
    }
    const target = rejected.length ? uncertainIssues : activeIssues;
    for (const issueId of resolved) target.add(issueId);
    rejectedRelationships.push(...rejected.map(rejection => ({ prNumber: pr.number, ...rejection })));
  }
  for (const item of byContent.values()) {
    if (item.content.repository.nameWithOwner === CONFIG.repository) {
      requireValue(contents.has(item.content.id), `Project content missing from repository snapshot: ${item.content.id}`);
    }
  }
  const operations = [];
  for (const content of [...contents.values()].sort((a, b) => a.number - b.number)) {
    const item = byContent.get(content.id);
    if (!item && content.state !== 'OPEN' && content.id !== eventContentId) continue;
    if (content.__typename === 'Issue' && content.state === 'OPEN' &&
        uncertainIssues.has(content.id) && !activeIssues.has(content.id)) continue;
    const desired = desiredState(content, activeIssues.has(content.id));
    if (!item && desired.archive) continue;
    const base = { contentId: content.id, number: content.number };
    if (!item) operations.push({ ...base, kind: 'add' });
    if (desired.archive === true) {
      if (!item.isArchived) operations.push({ ...base, kind: 'archive' });
      continue;
    }
    if (desired.archive === false && item?.isArchived) operations.push({ ...base, kind: 'unarchive' });
    if (metadata ? item?.fieldValueByName?.optionId !== metadata.options[desired.status] :
      item?.fieldValueByName?.name !== desired.status) {
      operations.push({ ...base, kind: 'status', status: desired.status });
    }
  }
  return { operations, rejectedRelationships };
}

// Every connection has count and cursor validation: truncated, repeated or
// inconsistent pages fail before applying a partial snapshot.
export async function paginate(page) {
  const nodes = [];
  const seen = new Set();
  const cursors = new Set();
  let after = null;
  let expected;
  do {
    const connection = await page(after);
    requireValue(connection && Array.isArray(connection.nodes) && Number.isSafeInteger(connection.totalCount) &&
      connection.totalCount >= 0 && typeof connection.pageInfo?.hasNextPage === 'boolean', 'Malformed/incomplete connection');
    expected ??= connection.totalCount;
    requireValue(expected === connection.totalCount, 'Connection count changed during pagination; retry reconciliation');
    for (const node of connection.nodes) {
      requireValue(id(node?.id) && !seen.has(node.id), 'Missing/repeated node in connection');
      seen.add(node.id);
      nodes.push(node);
    }
    requireValue(nodes.length <= expected, 'Connection exceeded declared count');
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    requireValue(connection.nodes.length > 0 && id(after) && !cursors.has(after), 'Incomplete/repeated pagination cursor');
    cursors.add(after);
  } while (true);
  requireValue(nodes.length === expected, `Incomplete pagination: expected ${expected}, got ${nodes.length}`);
  return nodes;
}

export function createApi(token, fetcher = fetch, writable = false) {
  requireValue(id(token), 'Missing GH_TOKEN');
  return async (query, variables = {}) => {
    requireValue(writable || !/^\s*mutation\b/.test(query), 'Project mutations forbidden in read-only mode');
    const response = await fetcher('https://api.github.com/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'User-Agent': 'moris-mix-project-sync' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60000),
    });
    requireValue(response.ok, `GitHub API HTTP ${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new SyncError('Malformed GitHub JSON response'); }
    // Do not log raw API errors, bodies, titles, or credentials.
    requireValue(result && (result.errors === undefined || (Array.isArray(result.errors) && result.errors.length === 0)) &&
      result.data && typeof result.data === 'object' && !Array.isArray(result.data), 'GitHub GraphQL failure or malformed response');
    return result.data;
  };
}

const PAGE = 'totalCount pageInfo { hasNextPage endCursor }';
const CONTENT = 'id number state repository { nameWithOwner }';
const ITEM = `id isArchived fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } }
  content { __typename ... on Issue { id repository { nameWithOwner } }
    ... on PullRequest { id repository { nameWithOwner } } }`;

export function adapter(api) {
  return {
    async metadata() {
      const projects = await paginate(async after => (await api(`query($after:String) {
        organization(login: "${CONFIG.owner}") { projectsV2(first:100, after:$after) {
          ${PAGE} nodes { id number title closed owner { __typename ... on Organization { login } } }
        } } }`, { after })).organization?.projectsV2);
      const project = one(projects.filter(p => p.number === CONFIG.number), 'target Project');
      const fields = await paginate(async after => (await api(`query($id:ID!,$after:String) {
        node(id:$id) { ... on ProjectV2 { fields(first:100,after:$after) { ${PAGE}
          nodes { __typename ... on ProjectV2Field { id name }
            ... on ProjectV2IterationField { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } } }
        } } } }`, { id: project.id, after })).node?.fields);
      return discover(projects, fields);
    },
    async snapshot(projectId, event = {}) {
      // Fetch all states so archived/closed Project history and relationship
      // resolution use current repository evidence, not stale webhook bodies.
      const issues = await paginate(async after => (await api(`query($after:String) {
        repository(owner:"${CONFIG.owner}",name:"${CONFIG.repo}") {
          issues(first:100,after:$after) { ${PAGE} nodes { __typename ${CONTENT} stateReason } }
        } }`, { after })).repository?.issues);
      const prs = await paginate(async after => (await api(`query($after:String) {
        repository(owner:"${CONFIG.owner}",name:"${CONFIG.repo}") {
          pullRequests(first:100,after:$after) { ${PAGE} nodes { __typename ${CONTENT} isDraft body } }
        } }`, { after })).repository?.pullRequests);
      for (const pr of prs.filter(p => p.state === 'OPEN')) {
        pr.nativeIssues = await paginate(async after => (await api(`query($id:ID!,$after:String) {
          node(id:$id) { ... on PullRequest { closingIssuesReferences(first:100,after:$after) {
            ${PAGE} nodes { id number repository { nameWithOwner } }
          } } } }`, { id: pr.id, after })).node?.closingIssuesReferences);
      }
      const items = await paginate(async after => (await api(`query($id:ID!,$after:String) {
        node(id:$id) { ... on ProjectV2 { items(first:100,after:$after,archivedStates:[ARCHIVED,NOT_ARCHIVED]) {
          ${PAGE} nodes { ${ITEM} }
        } } } }`, { id: projectId, after })).node?.items);
      const eventContent = event.pull_request ?? event.issue;
      if (eventContent) requireValue(event.repository?.full_name === CONFIG.repository &&
        [...issues, ...prs].some(c => c.id === eventContent.node_id), 'Event content missing from repository snapshot');
      return { issues, prs, items, eventContentId: eventContent?.node_id ?? null };
    },
    async itemFor(contentId, projectId) {
      const items = await paginate(async after => (await api(`query($id:ID!,$after:String) {
        node(id:$id) {
          ... on Issue { projectItems(first:100,after:$after,includeArchived:true) { ${PAGE} nodes { ${ITEM} project { id } } } }
          ... on PullRequest { projectItems(first:100,after:$after,includeArchived:true) { ${PAGE} nodes { ${ITEM} project { id } } } }
        } }`, { id: contentId, after })).node?.projectItems);
      requireValue(items.every(item => id(item.project?.id)), 'Incomplete project membership identity');
      const relevant = items.filter(item => item.project?.id === projectId);
      indexItems(relevant);
      return relevant[0];
    },
    async mutate(operation, metadata, item) {
      const variables = { projectId: metadata.projectId };
      let query;
      let key;
      if (operation.kind === 'add') {
        key = 'addProjectV2ItemById';
        variables.contentId = operation.contentId;
        query = `mutation($projectId:ID!,$contentId:ID!) { ${key}(input:{projectId:$projectId,contentId:$contentId}) { item { id } } }`;
      } else {
        variables.itemId = item.id;
        if (operation.kind === 'status') {
          key = 'updateProjectV2ItemFieldValue';
          variables.fieldId = metadata.fieldId;
          variables.optionId = metadata.options[operation.status];
          requireValue(id(variables.optionId), 'Missing desired Status option');
          query = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!) {
            ${key}(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}) { projectV2Item { id } }
          }`;
        } else {
          requireValue(['archive', 'unarchive'].includes(operation.kind), 'Unknown mutation');
          key = `${operation.kind}ProjectV2Item`;
          query = `mutation($projectId:ID!,$itemId:ID!) { ${key}(input:{projectId:$projectId,itemId:$itemId}) { item { id } } }`;
        }
      }
      const result = (await api(query, variables))[key];
      const returned = result?.item ?? result?.projectV2Item;
      requireValue(id(returned?.id) && (operation.kind === 'add' || returned.id === item.id), `Malformed ${key} mutation result`);
      return returned;
    },
  };
}

export async function reconcile(client, { mode, enabled, event = {}, log = console.log }) {
  requireValue(['dry-run', 'reconcile'].includes(mode), 'Mode must be dry-run or reconcile');
  if (mode === 'reconcile' && enabled !== 'true') {
    log('Project synchronization is disabled: PROJECT_AUTOMATION_ENABLED must be exactly true.');
    return { disabled: true, proposed: 0, applied: 0 };
  }
  const metadata = await client.metadata();
  const { operations, rejectedRelationships } = plan(await client.snapshot(metadata.projectId, event), metadata);
  for (const rejection of rejectedRelationships) {
    const reference = rejection.issueNumber === null ? 'invalid issue number' : `#${rejection.issueNumber}`;
    log(`::warning::PR #${rejection.prNumber}: rejected ${reference} (${rejection.reason}); relationship evidence quarantined.`);
  }
  // Plans contain only numeric references, node IDs, fixed verbs and statuses.
  for (const operation of operations) log(JSON.stringify(operation));
  let applied = 0;
  if (mode === 'reconcile') {
    for (const operation of operations) {
      // Re-read before each write: tolerate earlier adds or another writer,
      // never deliberately duplicate cards or reapply correct fields.
      const item = await client.itemFor(operation.contentId, metadata.projectId);
      if (operation.kind === 'add' && item) continue;
      requireValue(operation.kind === 'add' || item, `Project item disappeared: ${operation.contentId}; retry reconciliation`);
      if (operation.kind === 'archive' && item.isArchived) continue;
      if (operation.kind === 'unarchive' && !item.isArchived) continue;
      if (operation.kind === 'status' && item.fieldValueByName?.optionId === metadata.options[operation.status]) continue;
      await client.mutate(operation, metadata, item);
      applied++;
    }
  }
  log(`${mode}: ${operations.length} proposed, ${applied} applied, ${rejectedRelationships.length} rejected relationships. Configuration is not runtime proof.`);
  return { proposed: operations.length, applied, rejectedRelationships };
}

export async function main(env = process.env) {
  const mode = env.PROJECT_SYNC_MODE ?? 'dry-run';
  requireValue(['dry-run', 'reconcile'].includes(mode), 'Mode must be dry-run or reconcile');
  if (mode === 'reconcile' && env.PROJECT_AUTOMATION_ENABLED !== 'true') {
    console.log('Project synchronization is disabled: PROJECT_AUTOMATION_ENABLED must be exactly true.');
    return;
  }
  requireValue(env.GITHUB_REPOSITORY === CONFIG.repository, 'Unexpected repository');
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  await reconcile(adapter(createApi(env.GH_TOKEN, fetch, mode === 'reconcile' && env.PROJECT_AUTOMATION_ENABLED === 'true')),
    { mode, enabled: env.PROJECT_AUTOMATION_ENABLED, event });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Details from our validation errors are safe; network exceptions may carry
    // request data, so keep the CLI failure message fixed. Plans identify work.
    console.error(error instanceof SyncError ? error.message : 'Project synchronization API/network/input failure.');
    console.error('Project synchronization failed; reconciliation is incomplete. No success is claimed; repair the failure and rerun reconciliation.');
    process.exitCode = 1;
  });
}
