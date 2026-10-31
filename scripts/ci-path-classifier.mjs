import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const full = reason => ({ docs_only: 'false', frontend: 'run', database: 'run', edge_api: 'run',
  e2e: 'run', staging: 'run', reason });
const prose = path => path === 'README.md' || /^docs\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(path);

// Input is Git's --name-status -z format, not line/tab-split filenames.
// Completeness must be established by the collector, never inferred from paths.
export function parseNameStatus(input) {
  if (typeof input !== 'string' || !input.endsWith('\0')) throw new Error('Invalid diff');
  const tokens = input.slice(0, -1).split('\0');
  const changes = [];
  while (tokens.length) {
    const status = tokens.shift();
    if (!/^(?:[AMD]|R(?:100|0\d{2}))$/.test(status)) throw new Error('Unknown status');
    const paths = tokens.splice(0, status.startsWith('R') ? 2 : 1);
    if (paths.length !== (status.startsWith('R') ? 2 : 1) || paths.some(path =>
      !path || /[\x00-\x1f\x7f\\]/.test(path) || path.startsWith('/') ||
      path.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Invalid path');
    changes.push({ status, paths });
  }
  return changes;
}

export function classify(input, options = {}) {
  try {
    const { complete = false, expectedCount } = options;
    const changes = parseNameStatus(input);
    if (!complete || !Number.isSafeInteger(expectedCount) || expectedCount < 1 || changes.length !== expectedCount)
      return full('Incomplete or empty changed-file evidence');
    const allPaths = changes.flatMap(change => change.paths);
    if (new Set(allPaths).size !== allPaths.length) return full('Ambiguous duplicate paths');
    if (changes.some(change => change.status === 'D')) return full('Deletion requires full validation');
    if (!allPaths.every(prose)) return full('Changed paths are outside the Stage A prose allowlist');
    return { ...full('Complete documentation-only PR diff'), docs_only: 'true',
      frontend: 'noop', database: 'noop', edge_api: 'noop' };
  } catch {
    return full('Invalid changed-file evidence');
  }
}

// No API calls, credentials or user-controlled shell commands. Any missing object,
// shallow history, ambiguous merge base, count mismatch or buffer limit runs full.
export function classifyGit(options = {}) {
  try {
    const { base, head, expectedCount, eventName, cwd = process.cwd() } = options;
    if (eventName !== 'pull_request' || !/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? ''))
      return full('Not a verified PR base/head pair');
    const git = args => execFileSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'] });
    const text = args => new TextDecoder('utf-8', { fatal: true }).decode(git(args));
    if (text(['rev-parse', '--is-shallow-repository']).trim() !== 'false' ||
        text(['rev-parse', 'HEAD']).trim() !== head) return full('Incomplete history or wrong checkout');
    for (const sha of [base, head]) {
      if (text(['rev-parse', '--verify', `${sha}^{commit}`]).trim() !== sha) return full('Missing PR commit');
    }
    const ancestor = text(['merge-base', '--all', base, head]).trim();
    if (!/^[a-f0-9]{40}$/.test(ancestor)) return full('No unique PR merge base');
    const diff = text(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', ancestor, head, '--']);
    const result = classify(diff, { complete: true, expectedCount });
    if (result.docs_only === 'true') {
      // Prose symlinks/submodules are not approved documentation files.
      const paths = parseNameStatus(diff).map(change => change.paths.at(-1));
      const tree = text(['ls-tree', '-z', head, '--', ...paths]).split('\0').filter(Boolean);
      if (tree.length !== paths.length || tree.some(entry => !entry.startsWith('100644 blob ')))
        return full('Documentation paths are not regular prose files');
    }
    return result;
  } catch {
    return full('Git collection or classifier failure');
  }
}

export const outputLines = decision => Object.entries(decision).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let decision = full('Invalid or unavailable PR event');
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    decision = classifyGit({ base: event.pull_request?.base?.sha, head: event.pull_request?.head?.sha,
      expectedCount: event.pull_request?.changed_files, eventName: process.env.GITHUB_EVENT_NAME });
  } catch { /* Explicit full-validation decision below. */ }
  const output = outputLines(decision);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
