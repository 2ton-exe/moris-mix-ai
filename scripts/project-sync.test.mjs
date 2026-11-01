import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { CONFIG, STATUSES, relationships, desiredState, discover, plan, paginate, createApi, adapter, reconcile, main } from './project-sync.mjs';

const repository = { nameWithOwner: CONFIG.repository };
const issue = (number = 147, extra = {}) => ({ __typename: 'Issue', id: `I_${number}`, number, repository, state: 'OPEN', ...extra });
const pr = (number = 148, extra = {}) => ({ __typename: 'PullRequest', id: `PR_${number}`, number, repository,
  state: 'OPEN', isDraft: false, body: 'Part of #147', nativeIssues: [], ...extra });
const card = (content, status = 'Todo', isArchived = false) => ({ id: `ITEM_${content.id}`, content, isArchived,
  fieldValueByName: status ? { name: status, optionId: `option-${status}` } : null });
const projects = () => [{ id: 'PROJECT', number: 2, title: CONFIG.title, closed: false,
  owner: { __typename: 'Organization', login: CONFIG.owner } }];
const fields = () => [{ __typename: 'ProjectV2SingleSelectField', id: 'STATUS', name: 'Status',
  options: STATUSES.map(name => ({ name, id: `option-${name}` })) }];
const metadata = () => discover(projects(), fields());
const page = (nodes, totalCount = nodes.length, hasNextPage = false, endCursor = null) =>
  ({ nodes, totalCount, pageInfo: { hasNextPage, endCursor } });
const snapshot = (extra = {}) => ({ issues: [issue()], prs: [], items: [], ...extra });
const operationsFor = (...args) => plan(...args).operations;

for (const [name, prs, expected] of [
  ['new open issue without PR', [], 'Todo'],
  ['draft implementation', [pr(148, { isDraft: true })], 'In Progress'],
  ['ready implementation', [pr()], 'In Progress'],
  ['multiple open PRs', [pr(), pr(149)], 'In Progress'],
  ['merged partial only', [pr(148, { state: 'MERGED' })], 'Todo'],
  ['closed unmerged only', [pr(148, { state: 'CLOSED' })], 'Todo'],
  ['merged and current PR', [pr(148, { state: 'MERGED' }), pr(149)], 'In Progress'],
]) test(`issues: ${name}`, () => {
  const operations = operationsFor(snapshot({ prs }));
  assert.equal(operations.find(o => o.contentId === 'I_147' && o.kind === 'status').status, expected);
});

for (const [name, content, active, expected] of [
  ['completed issue', issue(1, { state: 'CLOSED', stateReason: 'COMPLETED' }), false, { status: 'Done' }],
  ['not-planned issue', issue(1, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }), false, { archive: true }],
  ['reopened active issue', issue(), true, { status: 'In Progress', archive: false }],
  ['reopened inactive issue', issue(), false, { status: 'Todo', archive: false }],
  ['opened draft', pr(1, { isDraft: true }), false, { status: 'In Progress', archive: false }],
  ['opened ready', pr(), false, { status: 'In Review', archive: false }],
  ['draft becomes ready', pr(1, { isDraft: false }), false, { status: 'In Review', archive: false }],
  ['ready becomes draft', pr(1, { isDraft: true }), false, { status: 'In Progress', archive: false }],
  ['merged PR', pr(1, { state: 'MERGED' }), false, { status: 'Done' }],
  ['closed unmerged PR', pr(1, { state: 'CLOSED' }), false, { archive: true }],
  ['reopened draft PR', pr(1, { isDraft: true }), false, { status: 'In Progress', archive: false }],
  ['reopened ready PR', pr(), false, { status: 'In Review', archive: false }],
]) test(`state: ${name}`, () => assert.deepEqual(desiredState(content, active), expected));

test('unknown closed issue reason and malformed state fail safely', () => {
  assert.throws(() => desiredState(issue(1, { state: 'CLOSED' })), /Unclassified/);
  assert.throws(() => desiredState(pr(1, { state: 'UNKNOWN' })), /Invalid PR/);
  assert.throws(() => desiredState(pr(1, { isDraft: null })), /Invalid PR/);
});

for (const verb of ['Part of', 'Ref', 'Refs', 'Related to', 'Closes', 'Close', 'Fixes', 'Fix', 'Resolves', 'Resolve']) {
  for (const colon of ['', ':']) {
    for (const bullet of ['', '- ', '* ', '+ ', '1. ', '- [x] ']) {
      test(`relationship: ${bullet}${verb}${colon}`, () => {
        assert.deepEqual(relationships(`${bullet}${verb.toUpperCase()}${colon}  #123`), [123]);
        assert.deepEqual(relationships(`${bullet}${verb.toLowerCase()}${colon} #123`), [123]);
      });
    }
  }
}

for (const heading of ['## Related Issue', '## Related GitHub Issue', '### Related Issue', '### Related GitHub Issue']) {
  test(`relationship section: ${heading}`, () => {
    assert.deepEqual(relationships(`${heading}\n\n#147\n- #148\n${heading.startsWith('###') ? '###' : '##'} Testing\n#999`), [147, 148]);
  });
}

for (const [heading, expected] of [
  ['## Related Issue', [147]],
  ['## Related Issues', [147]],
  ['## Related GitHub Issue', [147]],
  ['## Related GitHub Issues', [147]],
  ['## rElAtEd gItHuB iSsUeS', [147]],
  ['## Related Issue ##', [147]],
  ['## Related GitHub Issue ###', [147]],
  ['## Related Issue   \t', [147]],
  ['## Related GitHub Issues ###   \t', [147]],
  ['## Testing', []],
]) test(`ATX heading normalization: ${JSON.stringify(heading)}`, () => {
  assert.deepEqual(relationships(`${heading}\n#147`), expected);
});

test('ATX levels, indentation and marker spacing preserve relationship boundaries', () => {
  for (let level = 1; level <= 6; level++) {
    for (let indent = 0; indent <= 3; indent++) {
      for (const spacing of [' ', '   ', '\t']) {
        const marker = '#'.repeat(level);
        assert.deepEqual(relationships(`${' '.repeat(indent)}${marker}${spacing}Related Issue ##\n#147\n${marker} Testing\n#999`), [147]);
      }
    }
  }
  assert.deepEqual(relationships('## Related Issue\n#147\n##   \n#999'), [147]);
  for (const heading of ['####### Related Issue', '    ## Related Issue', '> ## Related Issue']) {
    assert.deepEqual(relationships(`${heading}\n#147`), []);
  }
});

test('bare ATX heading ends a Related Issue section', () => {
  assert.deepEqual(relationships('## Related Issue\n#147\n##\n#999'), [147]);
});

for (let level = 1; level <= 6; level++) {
  test(`bare ATX level ${level} preserves section boundaries with valid indentation`, () => {
    for (let indent = 0; indent <= 3; indent++) {
      for (const trailing of ['', '   ', '\t']) {
        const heading = ' '.repeat(indent) + '#'.repeat(level) + trailing;
        assert.deepEqual(relationships(`###### Related Issue\n#147\n${heading}\n#999`), [147]);
      }
    }
  });
}

test('adversarial headings finish promptly without recognizing unrelated references', () => {
  const moduleURL = new URL('./project-sync.mjs', import.meta.url).href;
  const script = `import { relationships } from ${JSON.stringify(moduleURL)};
    const bodies = [
      '## Related Issue' + ' '.repeat(50000) + 'x\\n#147',
      '## Related Issue ' + '#'.repeat(50000) + 'x\\n#147',
    ];
    process.stdout.write(JSON.stringify(bodies.map(body => relationships(body))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, 'heading parsing must complete within five seconds');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [[], []]);
});
test('multiple relationships, qualified same-repo refs, native relationships, deduplication', () => {
  assert.deepEqual(relationships('Part of #147, #148\nRefs: #147\nFixes 2ton-exe/moris-mix-ai#149\nCloses https://github.com/2ton-exe/moris-mix-ai/issues/150',
    [{ number: 151, repository }, { number: 147, repository }, { number: 10, repository: { nameWithOwner: 'other/repo' } }]),
  [147, 148, 149, 150, 151]);
});
test('arbitrary mentions, testing, changelog, comments, blockquotes and code examples ignored', () => {
  assert.deepEqual(relationships('Mention #123\n## Testing\n- testing #124\n## Changelog\n- resolved a bug #125\n#126\n<!-- Closes #127 -->\n```md\nCloses #128\n```\n> Ref #129\n    Part of #130'), []);
  assert.deepEqual(relationships('Part of #123; tested with #456\nRefs #123 and #124, #125'), [123, 124, 125]);
});
test('cross-repository references are rejected, including URL and PR links', () => {
  assert.deepEqual(relationships('Part of other/repo#123\nCloses https://github.com/other/repo/issues/124\nRef https://github.com/2ton-exe/moris-mix-ai/pull/125'), []);
});
test('unresolvable relationship is diagnosed without blocking unrelated lifecycle operations', () => {
  const result = plan(snapshot({ prs: [pr(148, { body: 'Part of #999999' })] }));
  assert.deepEqual(result.rejectedRelationships, [
    { prNumber: 148, issueNumber: 999999, reason: 'unresolvable issue relationship' },
  ]);
  assert.deepEqual(result.operations.filter(o => o.kind === 'status').map(o => [o.number, o.status]),
    [[147, 'Todo'], [148, 'In Review']]);
  const wrongType = plan(snapshot({ prs: [pr(148, { body: 'Ref #148' })] }));
  assert.equal(wrongType.rejectedRelationships[0].issueNumber, 148);
});

test('mixed valid/unresolved relationships quarantine every referenced open issue without mutations', () => {
  for (const status of [null, 'Todo', 'In Progress', 'In Review', 'Done']) {
    for (const archived of [false, true]) {
      const result = plan(snapshot({ issues: [issue(), issue(2)],
        prs: [pr(148, { body: 'Refs #147, #999999' }), pr(149, { body: '' })],
        items: [card(issue(), status, archived)] }));
      assert.ok(!result.operations.some(o => o.contentId === 'I_147'));
      assert.ok(result.operations.some(o => o.number === 2 && o.status === 'Todo'));
      assert.ok(result.operations.some(o => o.number === 149 && o.status === 'In Review'));
      assert.equal(result.rejectedRelationships.length, 1);
    }
  }
  const missing = plan(snapshot({ prs: [pr(148, { body: 'Refs #147, #999999' })] }));
  assert.ok(!missing.operations.some(o => o.contentId === 'I_147'), 'do not create a card with inferred state');
});

test('independent valid PR evidence establishes activity despite another quarantined PR', () => {
  const malformed = pr(148, { body: 'Refs #147, #999999' });
  const valid = pr(149, { body: 'Part of #147' });
  for (const prs of [[malformed, valid], [valid, malformed]]) {
    const result = plan(snapshot({ prs }));
    assert.ok(result.operations.some(o => o.number === 147 && o.status === 'In Progress'));
    assert.equal(result.rejectedRelationships.length, 1);
  }
});

for (const isDraft of [false, true]) test(`quarantined PR lifecycle remains independent: draft=${isDraft}`, () => {
  const result = plan(snapshot({ prs: [pr(148, { isDraft, body: 'Refs #147, #999999' })] }));
  assert.equal(result.operations.find(o => o.number === 148 && o.kind === 'status').status,
    isDraft ? 'In Progress' : 'In Review');
});

test('invalid numeric relationship quarantines resolvable body/native targets, without logging raw input', () => {
  for (const invalid of ['0', '9'.repeat(100)]) {
    const result = plan(snapshot({ issues: [issue(), issue(2)], prs: [pr(148, {
      body: `Refs #147, #${invalid}, #2`, nativeIssues: [{ number: 147, repository }],
    })] }));
    assert.deepEqual(result.rejectedRelationships, [
      { prNumber: 148, issueNumber: null, reason: 'invalid issue relationship number' },
    ]);
    assert.ok(!result.operations.some(o => o.contentId.startsWith('I_')));
    assert.throws(() => relationships(`Ref #${invalid}`), /Invalid issue relationship number/);
  }
});

test('closed issue state stays authoritative despite a malformed PR relationship', () => {
  const content = issue(147, { state: 'CLOSED', stateReason: 'COMPLETED' });
  const result = plan(snapshot({ issues: [content], prs: [pr(148, { body: 'Refs #147, #999999' })],
    items: [card(content)] }));
  assert.ok(result.operations.some(o => o.number === 147 && o.status === 'Done'));
});

test('incomplete native/API relationship evidence still fails visibly', () => {
  assert.throws(() => operationsFor(snapshot({ prs: [pr(148, { nativeIssues: undefined })] })), /Incomplete/);
  assert.throws(() => operationsFor(snapshot({ prs: [pr(148, { nativeIssues: [{}] })] })), /Malformed native/);
  assert.throws(() => operationsFor(snapshot({ prs: [pr(148, { body: null })] })), /Incomplete/);
});
test('one PR can move several issues; several PRs can relate to one issue', () => {
  const operations = operationsFor(snapshot({ issues: [issue(1), issue(2)], prs: [pr(3, { body: 'Ref #1, #2' }), pr(4, { body: 'Part of #1' })] }));
  assert.deepEqual(operations.filter(o => o.contentId.startsWith('I_') && o.kind === 'status').map(o => o.status), ['In Progress', 'In Progress']);
});
test('November 1 baseline issue and PR fixtures', () => {
  const issues = [100, 116, 124, 130, 147].map(n => issue(n));
  const prs = [pr(136, { body: 'Closes #100' }), pr(144, { body: 'Part of #124' }),
    pr(145, { body: '## Related Issue\n#116' }), pr(146, { state: 'MERGED' })];
  const operations = operationsFor({ issues, prs, items: [card(prs[3], 'In Review')] });
  assert.deepEqual(operations.filter(o => o.kind === 'status').map(o => [o.number, o.status]),
    [[100, 'In Progress'], [116, 'In Progress'], [124, 'In Progress'], [130, 'Todo'],
      [136, 'In Review'], [144, 'In Review'], [145, 'In Review'], [146, 'Done'], [147, 'Todo']]);
});
for (const number of [6, 20, 24, 26, 29, 68, 119, 139, 141]) {
  test(`historical closed unmerged #${number} is archived when present, never bulk-added/Done`, () => {
    const content = pr(number, { state: 'CLOSED' });
    assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content] })), []);
    assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content], items: [card(content, 'Done')] })).map(o => o.kind), ['archive']);
    assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content], items: [card(content, 'Done', true)] })), []);
  });
}
test('history is preserved; absent merged PRs are not backfilled; fresh merge event can add', () => {
  const content = pr(146, { state: 'MERGED' });
  assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content] })), []);
  assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content], eventContentId: content.id })).map(o => o.kind), ['add', 'status']);
  assert.deepEqual(operationsFor(snapshot({ issues: [], prs: [content], items: [card(content, 'Done')] })), []);
});
test('not-planned archives, completed remains Done, reopened archived items unarchive', () => {
  const done = issue(1, { state: 'CLOSED', stateReason: 'COMPLETED' });
  const abandoned = issue(2, { state: 'CLOSED', stateReason: 'NOT_PLANNED' });
  assert.deepEqual(operationsFor(snapshot({ issues: [done, abandoned], items: [card(done, 'Todo'), card(abandoned)] })).map(o => [o.number, o.kind, o.status]),
    [[1, 'status', 'Done'], [2, 'archive', undefined]]);
  for (const content of [issue(), pr(148, { body: '' })]) {
    assert.deepEqual(operationsFor(snapshot({ issues: content.__typename === 'Issue' ? [content] : [],
      prs: content.__typename === 'PullRequest' ? [content] : [], items: [card(content, 'Done', true)] })).map(o => o.kind), ['unarchive', 'status']);
  }
});
test('correct status no mutation, wrong status one mutation, missing item add+status', () => {
  assert.deepEqual(operationsFor(snapshot({ items: [card(issue())] })), []);
  assert.deepEqual(operationsFor(snapshot({ items: [card(issue(), 'Done')] })).map(o => o.kind), ['status']);
  assert.deepEqual(operationsFor(snapshot()).map(o => o.kind), ['add', 'status']);
});
test('duplicate content fails with content and both item IDs; other repositories untouched', () => {
  assert.throws(() => operationsFor(snapshot({ items: [card(issue()), { ...card(issue()), id: 'SECOND' }] })), /I_147.*ITEM_I_147, SECOND/);
  const other = issue(5, { repository: { nameWithOwner: 'other/repo' } });
  assert.deepEqual(operationsFor(snapshot({ issues: [], items: [card(other)] })), []);
});
test('malformed item/status/membership evidence fails instead of risking a duplicate add', async () => {
  const missing = card(issue());
  delete missing.fieldValueByName;
  for (const item of [missing, { ...card(issue()), content: null }, { ...card(issue()), fieldValueByName: {} }]) {
    assert.throws(() => operationsFor(snapshot({ items: [item] })), /Malformed/);
  }
  const client = adapter(async () => ({ node: { projectItems: page([card(issue())]) } }));
  await assert.rejects(() => client.itemFor('I_147', 'PROJECT'), /membership/);
});

test('Project/Status metadata discovery validates all identities and four unique options', () => {
  assert.equal(metadata().options.Done, 'option-Done');
  for (const projectsValue of [[], [...projects(), ...projects()], [{ ...projects()[0], title: 'Wrong' }],
    [{ ...projects()[0], closed: true }], [{ ...projects()[0], owner: { __typename: 'User', login: CONFIG.owner } }]]) {
    assert.throws(() => discover(projectsValue, fields()));
  }
  for (const fieldsValue of [[], [...fields(), ...fields()], [{ ...fields()[0], __typename: 'ProjectV2Field' }],
    [{ ...fields()[0], options: fields()[0].options.slice(1) }],
    [{ ...fields()[0], options: [...fields()[0].options, { name: 'Other', id: 'other' }] }]]) {
    assert.throws(() => discover(projects(), fieldsValue));
  }
});
test('pagination retrieves >100 items, including the last page', async () => {
  const nodes = Array.from({ length: 203 }, (_, n) => ({ id: `node-${n}` }));
  const requests = [];
  const result = await paginate(async cursor => {
    requests.push(cursor);
    const start = Number(cursor ?? 0);
    return page(nodes.slice(start, start + 100), 203, start + 100 < 203, String(start + 100));
  });
  assert.equal(result.length, 203);
  assert.deepEqual(requests, [null, '100', '200']);
});
for (const [name, first, second] of [
  ['truncated page', page([{ id: '1' }], 2)],
  ['missing pageInfo', { nodes: [], totalCount: 0 }],
  ['null node', page([null])],
  ['missing cursor', page([{ id: '1' }], 2, true)],
  ['repeated node', page([{ id: '1' }], 2, true, 'cursor'), page([{ id: '1' }], 2)],
  ['changing count', page([{ id: '1' }], 2, true, 'cursor'), page([{ id: '2' }], 3)],
  ['repeated cursor', page([{ id: '1' }], 3, true, 'cursor'), page([{ id: '2' }], 3, true, 'cursor')],
]) test(`pagination fails: ${name}`, async () => {
  await assert.rejects(() => paginate(async after => after ? second : first));
});
test('API HTTP/auth/permission/GraphQL/malformed JSON/network failures propagate', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(() => createApi('test', async () => ({ ok: false, status }))('query {}'), /HTTP/);
  }
  for (const result of [{}, null, { data: null }, { data: [] }, { data: {}, errors: {} }, { data: {}, errors: [{ message: 'secret untrusted text' }] }]) {
    await assert.rejects(() => createApi('test', async () => ({ ok: true, json: async () => result }))('query {}'), /GraphQL/);
  }
  await assert.rejects(() => createApi('test', async () => ({ ok: true, json: async () => { throw Error(); } }))('query {}'), /JSON/);
  await assert.rejects(() => createApi('test', async () => { throw Error('offline'); })('query {}'), /offline/);
});
test('read-only API refuses mutations before making any network call', async () => {
  let calls = 0;
  await assert.rejects(() => createApi('test', async () => { calls++; })('mutation { anything }'), /forbidden/);
  assert.equal(calls, 0);
});

function fakeClient(initial = snapshot()) {
  const data = structuredClone(initial);
  const mutations = [];
  return {
    data, mutations,
    metadata: async () => metadata(), snapshot: async () => data,
    itemFor: async contentId => data.items.find(i => i.content.id === contentId),
    async mutate(operation) {
      mutations.push(operation);
      let item = data.items.find(i => i.content.id === operation.contentId);
      if (operation.kind === 'add') {
        item = card([...data.issues, ...data.prs].find(c => c.id === operation.contentId), null);
        data.items.push(item);
      } else if (operation.kind === 'status') item.fieldValueByName = { name: operation.status, optionId: `option-${operation.status}` };
      else item.isArchived = operation.kind === 'archive';
      return item;
    },
  };
}
const options = { mode: 'reconcile', enabled: 'true', log: () => {} };
test('dry-run proposes changes and never calls itemFor or mutate', async () => {
  const client = fakeClient();
  client.itemFor = client.mutate = () => { throw Error('write path reached'); };
  assert.deepEqual(await reconcile(client, { ...options, mode: 'dry-run', enabled: undefined }),
    { proposed: 2, applied: 0, rejectedRelationships: [] });
});

test('quarantine warnings are visible, unrelated writes continue, and corrected relationships recover', async () => {
  const logs = [];
  const client = fakeClient(snapshot({ issues: [issue(), issue(2)],
    prs: [pr(148, { body: 'Refs #147, #999999\nPRIVATE_BODY_DO_NOT_LOG' })],
    items: [card(issue())] }));
  const runOptions = { ...options, log: line => logs.push(line) };
  const first = await reconcile(client, runOptions);
  assert.equal(first.rejectedRelationships.length, 1);
  assert.equal(first.applied, 4);
  assert.ok(!client.mutations.some(o => o.contentId === 'I_147'));
  assert.ok(logs.some(line => line.startsWith('::warning::') && line.includes('PR #148') && line.includes('#999999')));
  assert.ok(!logs.some(line => line.includes('PRIVATE_BODY_DO_NOT_LOG') || line.includes('Refs #147')));
  client.data.prs[0].body = 'Part of #147';
  assert.deepEqual((await reconcile(client, runOptions)).rejectedRelationships, []);
  assert.equal(client.data.items.find(i => i.content.id === 'I_147').fieldValueByName.name, 'In Progress');
  client.data.prs[0].body = '';
  await reconcile(client, runOptions);
  assert.equal(client.data.items.find(i => i.content.id === 'I_147').fieldValueByName.name, 'Todo');
});
test('exact activation guard blocks missing, false, TRUE, True, whitespace and 1 before API access', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', 'True', ' true', 'true ', '1']) {
    assert.equal((await reconcile({}, { ...options, enabled })).disabled, true);
    await main({ PROJECT_SYNC_MODE: 'reconcile', PROJECT_AUTOMATION_ENABLED: enabled });
  }
  await assert.rejects(() => reconcile({}, { ...options, mode: 'apply' }), /Mode/);
});
test('reconciliation twice and duplicate event yield zero second-pass writes', async () => {
  const client = fakeClient(snapshot({ prs: [pr()] }));
  assert.equal((await reconcile(client, options)).applied, 4);
  assert.equal((await reconcile(client, options)).applied, 0);
  assert.equal(client.data.items.length, 2);
});
test('PR edit removing relationship reconciles prior issue even without previous-body evidence', async () => {
  const client = fakeClient(snapshot({ prs: [pr()] }));
  await reconcile(client, options);
  client.data.prs[0].body = '';
  await reconcile(client, { ...options, event: { action: 'edited', pull_request: { number: 148 } } });
  assert.equal(client.data.items.find(i => i.content.id === 'I_147').fieldValueByName.name, 'Todo');
});
test('full reconciliation converges through archive, reopen, ready, merge and completion', async () => {
  const client = fakeClient(snapshot({ prs: [pr(148, { isDraft: true })] }));
  await reconcile(client, options);
  client.data.prs[0].state = 'CLOSED';
  await reconcile(client, options);
  assert.equal(client.data.items.find(i => i.content.id === 'PR_148').isArchived, true);
  assert.equal(client.data.items.find(i => i.content.id === 'I_147').fieldValueByName.name, 'Todo');
  client.data.prs[0].state = 'OPEN';
  client.data.prs[0].isDraft = false;
  await reconcile(client, options);
  assert.equal(client.data.items.find(i => i.content.id === 'PR_148').isArchived, false);
  assert.equal(client.data.items.find(i => i.content.id === 'PR_148').fieldValueByName.name, 'In Review');
  client.data.prs[0].state = 'MERGED';
  client.data.issues[0].state = 'CLOSED';
  client.data.issues[0].stateReason = 'COMPLETED';
  await reconcile(client, options);
  assert.ok(client.data.items.every(i => i.fieldValueByName.name === 'Done'));
  assert.equal((await reconcile(client, options)).applied, 0);
});
test('fresh state before each write avoids duplicating concurrent add/status', async () => {
  const client = fakeClient();
  client.itemFor = async () => card(issue());
  assert.equal((await reconcile(client, options)).applied, 0);
});
test('missing status, snapshot/API failures and mutation failures cannot report success', async () => {
  for (const method of ['metadata', 'snapshot', 'itemFor', 'mutate']) {
    const client = fakeClient();
    client[method] = async () => { throw Error(`${method} failed`); };
    await assert.rejects(() => reconcile(client, options), /failed/);
  }
});

test('adapter requests archived items, native links and validates mutation payloads', async () => {
  const calls = [];
  const client = adapter(async (query, variables) => {
    calls.push({ query, variables });
    if (query.includes('organization(login:')) return { organization: { projectsV2: page(projects()) } };
    if (query.includes('fields(first:')) return { node: { fields: page(fields()) } };
    if (query.includes('issues(first:')) return { repository: { issues: page([issue()]) } };
    if (query.includes('pullRequests(first:')) return { repository: { pullRequests: page([pr()]) } };
    if (query.includes('closingIssuesReferences(first:')) return { node: { closingIssuesReferences: page([{ id: 'I_147', number: 147, repository }]) } };
    if (query.includes('items(first:')) return { node: { items: page([card(issue())]) } };
    if (query.includes('projectItems(first:')) return { node: { projectItems: page([{ ...card(issue()), project: { id: 'PROJECT' } }]) } };
    return {};
  });
  assert.equal((await client.metadata()).projectId, 'PROJECT');
  const data = await client.snapshot('PROJECT');
  assert.equal(data.prs[0].nativeIssues[0].number, 147);
  assert.equal((await client.itemFor('I_147', 'PROJECT')).id, 'ITEM_I_147');
  assert.ok(calls.some(c => c.query.includes('archivedStates:[ARCHIVED,NOT_ARCHIVED]')));
  assert.ok(calls.some(c => c.query.includes('includeArchived:true')));
  await assert.rejects(() => client.mutate({ kind: 'add', contentId: 'I_147' }, metadata()), /Malformed/);
});
test('adapter emits only documented operations and discovered Status IDs', async () => {
  for (const [kind, key] of [['add', 'addProjectV2ItemById'], ['status', 'updateProjectV2ItemFieldValue'],
    ['archive', 'archiveProjectV2Item'], ['unarchive', 'unarchiveProjectV2Item']]) {
    const client = adapter(async (query, variables) => {
      assert.ok(query.startsWith('mutation'));
      assert.ok(query.includes(key));
      assert.equal(variables.projectId, 'PROJECT');
      if (kind === 'status') assert.equal(variables.optionId, 'option-Done');
      return { [key]: kind === 'status' ? { projectV2Item: { id: 'ITEM_I_147' } } : { item: { id: 'ITEM_I_147' } } };
    });
    await client.mutate({ kind, contentId: 'I_147', status: 'Done' }, metadata(), card(issue()));
  }
});

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint', { paths: ['./frontend'] }))('js-yaml');
const source = readFileSync('.github/workflows/project-sync.yml', 'utf8');
const workflow = load(source);
test('workflow YAML parses with exactly the specified lifecycle events and dispatch choices', () => {
  assert.deepEqual(Object.keys(workflow.on), ['issues', 'pull_request_target', 'workflow_dispatch', 'schedule']);
  assert.deepEqual(workflow.on.issues.types, ['opened', 'reopened', 'closed']);
  assert.deepEqual(workflow.on.pull_request_target.types, ['opened', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited', 'closed']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.mode.options, ['dry-run', 'reconcile']);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, 'dry-run');
  assert.equal(workflow.on.schedule[0].cron, '17 * * * *');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'development-board-${{ github.repository }}', 'cancel-in-progress': false, queue: 'max',
  });
});
test('trusted-base security: checkout only default repository/branch, no PR execution or credentials persistence', () => {
  const steps = workflow.jobs.synchronize.steps;
  const checkout = steps.find(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.repository, '${{ github.repository }}');
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.deepEqual(steps.filter(s => s.uses).map(s => s.uses), ['actions/checkout@v4', 'actions/setup-node@v4', 'actions/create-github-app-token@v3']);
  assert.deepEqual(steps.filter(s => s.run).map(s => s.run).filter(s => /node /.test(s)), ['node scripts/project-sync.mjs']);
  assert.doesNotMatch(source, /pull_request\.head|pull_request\.(title|body)|npm |pnpm |yarn |git config|actions\/download-artifact|uses: \.\//);
  assert.equal(workflow.on.pull_request, undefined);
});
test('App credentials stay in action inputs/output env; no application/deployment secrets or token echo', () => {
  const steps = workflow.jobs.synchronize.steps;
  const app = steps.find(s => s.id === 'app');
  assert.equal(app.with['client-id'], '${{ vars.PROJECT_AUTOMATION_APP_CLIENT_ID }}');
  assert.equal(app.with['private-key'], '${{ secrets.PROJECT_AUTOMATION_APP_PRIVATE_KEY }}');
  assert.equal(app.with['permission-issues'], 'read');
  assert.equal(app.with['permission-pull-requests'], 'read');
  assert.equal(app.with['permission-metadata'], 'read');
  assert.match(app.with['permission-organization-projects'], /dry-run.*'read'.*'write'/);
  assert.equal(steps.at(-1).env.GH_TOKEN, '${{ steps.app.outputs.token }}');
  assert.deepEqual([...source.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]),
    ['PROJECT_AUTOMATION_APP_PRIVATE_KEY', 'PROJECT_AUTOMATION_APP_PRIVATE_KEY']);
  assert.doesNotMatch(source, /echo.*(?:\$GH_TOKEN|outputs\.token|\$APP_PRIVATE_KEY)|skip-token-revoke|\n\s+token:\s*\$\{/);
});

test('exact activation validation gates write-token minting; dry-run retains read-only access', () => {
  const steps = workflow.jobs.synchronize.steps;
  const guard = steps.find(s => s.name === 'Require exact activation before write token');
  const app = steps.find(s => s.uses === 'actions/create-github-app-token@v3');
  assert.ok(guard && steps.indexOf(guard) < steps.indexOf(app));
  assert.equal(guard.shell, 'bash');
  assert.deepEqual(guard.env, { ENABLED: '${{ vars.PROJECT_AUTOMATION_ENABLED }}' });
  assert.match(guard.run, /if \[ "\$ENABLED" != 'true' \]; then/);
  assert.match(guard.run, /exit 1/);
  assert.equal(guard['continue-on-error'], undefined);
  assert.equal(app.if, undefined, 'token step retains implicit success() after the guard');
  assert.equal(app['continue-on-error'], undefined);
  const required = (event_name, mode) => Function('github', 'inputs', `return (${guard.if});`)(
    { event_name }, { mode });
  const permission = (event_name, mode) => Function('github', 'inputs',
    `return (${app.with['permission-organization-projects'].replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`)(
    { event_name }, { mode });
  for (const event of ['issues', 'pull_request_target', 'schedule']) {
    for (const mode of [undefined, 'reconcile', 'dry-run']) {
      assert.equal(required(event, mode), true);
      assert.equal(permission(event, mode), 'write');
    }
  }
  assert.equal(required('workflow_dispatch', 'reconcile'), true);
  assert.equal(required('workflow_dispatch', undefined), true);
  assert.equal(permission('workflow_dispatch', 'reconcile'), 'write');
  assert.equal(required('workflow_dispatch', 'dry-run'), false);
  assert.equal(permission('workflow_dispatch', 'dry-run'), 'read');

  const bash = process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe') : 'bash';
  for (const enabled of ['true', 'TRUE', 'True', '1', '', 'false', ' true', 'true ']) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-s'], {
      input: guard.run + "\nprintf '%s\\n' token-step-reached\n", encoding: 'utf8',
      env: { ...process.env, ENABLED: enabled }, timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, enabled === 'true' ? 0 : 1, `${enabled}: ${result.stderr}`);
    assert.equal(result.stdout.includes('token-step-reached'), enabled === 'true');
    if (enabled !== 'true') assert.match(result.stdout, /::error::PROJECT_AUTOMATION_ENABLED must be exactly true/);
  }
});
test('automatic writer job is gated and dispatch restricted to default branch', () => {
  assert.match(workflow.jobs.synchronize.if, /vars\.PROJECT_AUTOMATION_ENABLED == 'true'/);
  assert.match(workflow.jobs.synchronize.if, /inputs\.mode == 'dry-run'/);
  assert.match(workflow.jobs.synchronize.if, /github\.ref == format\('refs\/heads\/\{0\}'/);
  const evaluate = (enabled, event, mode = '', branch = 'refs/heads/main') => Function('vars', 'github', 'inputs', 'format',
    `return (${workflow.jobs.synchronize.if});`)({ PROJECT_AUTOMATION_ENABLED: enabled },
    { repository: CONFIG.repository, event_name: event, ref: branch, event: { repository: { default_branch: 'main' } } },
    { mode }, (pattern, value) => pattern.replace('{0}', value));
  for (const event of ['issues', 'pull_request_target', 'schedule']) {
    assert.equal(evaluate('', event), false);
    assert.equal(evaluate('false', event), false);
    assert.equal(evaluate('true', event), true);
  }
  assert.equal(evaluate('', 'workflow_dispatch', 'dry-run'), true);
  assert.equal(evaluate('', 'workflow_dispatch', 'reconcile'), false);
  assert.equal(evaluate('true', 'workflow_dispatch', 'reconcile', 'refs/heads/untrusted'), false);
});
test('runtime has no fixed opaque option IDs or shell execution; template relationships are optional comments', () => {
  const script = readFileSync('scripts/project-sync.mjs', 'utf8');
  assert.doesNotMatch(script, /f75ad846|47fc9ee4|a7d87188|98236657|child_process|execSync|spawn\(/);
  const template = readFileSync('.github/pull_request_template.md', 'utf8');
  assert.match(template, /## Related GitHub Issue/);
  assert.match(template, /Optional/);
  assert.deepEqual(relationships(template), []);
});
