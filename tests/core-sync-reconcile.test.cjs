const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../static/core-sync.js');
const Reconcile = require('../static/core-sync-reconcile.js');

const HEAD1 = '1'.repeat(40);
const HEAD2 = '2'.repeat(40);
const BLOB0 = 'a'.repeat(40);
const BLOB1 = 'b'.repeat(40);

function response(body, status = 200) {
  return new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeGitHub({ initialLedger = null, headSha = HEAD1, staleReadsAfterWrite = 2 } = {}) {
  let current = initialLedger ? Sync.stableStringify(initialLedger) : null;
  let previous = current;
  let blobSha = initialLedger ? BLOB0 : null;
  let previousBlobSha = blobSha;
  let staleReads = 0;
  let puts = 0;

  async function fetch(url, init = {}) {
    const method = init.method || 'GET';
    if (url.endsWith('/repos/example/observed') && method === 'GET') {
      return response({ id: 10, full_name: 'example/observed' });
    }
    if (url.includes('/repos/example/observed/branches/main') && method === 'GET') {
      return response({ commit: { sha: headSha } });
    }
    if (url.includes('/repos/example/ledger/contents/data/core/github-sync.json')) {
      if (method === 'GET') {
        if (current == null) return response({ message: 'Not Found' }, 404);
        const stale = staleReads > 0;
        if (staleReads > 0) staleReads -= 1;
        const text = stale ? previous : current;
        const sha = stale ? previousBlobSha : blobSha;
        return response({ sha, content: Buffer.from(text, 'utf8').toString('base64') });
      }
      if (method === 'PUT') {
        puts += 1;
        const body = JSON.parse(init.body);
        if (blobSha && body.sha !== blobSha) return response({ message: 'sha mismatch' }, 409);
        previous = current;
        previousBlobSha = blobSha;
        current = Buffer.from(body.content, 'base64').toString('utf8');
        blobSha = BLOB1;
        staleReads = previous == null ? 0 : staleReadsAfterWrite;
        return response({ content: { sha: blobSha }, commit: { sha: 'c'.repeat(40) } });
      }
    }
    return response({ message: `unexpected ${method} ${url}` }, 500);
  }
  return { fetch, get puts() { return puts; }, snapshot: () => current && JSON.parse(current) };
}

test('reconciliation readback tolerates stale previous ledger until received record/job is visible', async () => {
  let initial = Sync.createSyncAggregate({ projectId: 'project:reconcile' });
  initial = Sync.receiveCommit(initial, { id: 10, full_name: 'example/observed' }, HEAD1, 'main', { now: '2026-09-11T00:00:00Z' }).aggregate;
  const remote = fakeGitHub({ initialLedger: initial, headSha: HEAD2, staleReadsAfterWrite: 2 });
  const result = await Reconcile.refreshAndPersist({
    fetch: remote.fetch,
    observedRepository: 'example/observed',
    observedBranch: 'main',
    ledgerRepository: 'example/ledger',
    ledgerBranch: 'main',
    projectId: 'project:reconcile',
    path: 'data/core/github-sync.json',
    now: '2026-09-11T00:01:00Z',
    readbackAttempts: 4,
    readbackDelayMs: 1
  });
  assert.equal(result.status, 'RECEIVED');
  assert.equal(result.aggregate.integrations.length, 2);
  assert.equal(result.aggregate.jobs.length, 2);
  assert.equal(result.integrationRecord.commitRef.commitSha, HEAD2);
  assert.equal(result.blobSha, BLOB1);
  assert.equal(remote.puts, 1);
});

test('bootstrap reconciliation persists and reads back first IntegrationRecord and SyncJob', async () => {
  const remote = fakeGitHub({ initialLedger: null, headSha: HEAD1 });
  const result = await Reconcile.refreshAndPersist({
    fetch: remote.fetch,
    observedRepository: 'example/observed',
    observedBranch: 'main',
    ledgerRepository: 'example/ledger',
    ledgerBranch: 'main',
    projectId: 'project:reconcile',
    path: 'data/core/github-sync.json',
    now: '2026-09-11T00:00:00Z',
    readbackAttempts: 2,
    readbackDelayMs: 1
  });
  assert.equal(result.aggregate.integrations.length, 1);
  assert.equal(result.aggregate.jobs.length, 1);
  assert.equal(result.integrationRecord.status, 'RECEIVED');
  assert.equal(remote.puts, 1);
});
