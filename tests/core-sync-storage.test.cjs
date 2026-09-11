const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../static/core-sync.js');
const Storage = require('../static/core-sync-storage.js');

const SHA0 = 'a'.repeat(40);
const SHA1 = 'b'.repeat(40);

function aggregate() {
  return Sync.receiveCommit(
    Sync.createSyncAggregate({ projectId: 'project:storage' }),
    { id: 1, full_name: 'example/repo' },
    '1'.repeat(40),
    'main',
    { now: '2026-09-11T00:00:00Z' }
  ).aggregate;
}

function fakeGitHub(initial, staleReadsAfterWrite = 1) {
  let current = Sync.stableStringify(initial);
  let previous = current;
  let sha = SHA0;
  let previousSha = sha;
  let staleReads = 0;
  let puts = 0;
  async function fetch(url, init = {}) {
    if ((init.method || 'GET') === 'GET') {
      const stale = staleReads > 0;
      if (staleReads > 0) staleReads -= 1;
      const body = {
        sha: stale ? previousSha : sha,
        content: Buffer.from(stale ? previous : current, 'utf8').toString('base64')
      };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      if (body.sha !== sha) return new Response(JSON.stringify({ message: 'sha mismatch' }), { status: 409 });
      puts += 1;
      previous = current;
      previousSha = sha;
      current = Buffer.from(body.content, 'base64').toString('utf8');
      sha = SHA1;
      staleReads = staleReadsAfterWrite;
      return new Response(JSON.stringify({ content: { sha }, commit: { sha: 'c'.repeat(40) } }), { status: 200 });
    }
    return new Response('{}', { status: 405 });
  }
  return { fetch, get puts() { return puts; } };
}

test('successful CAS tolerates an immediately stale GitHub readback and converges', async () => {
  const remote = fakeGitHub(aggregate(), 2);
  const result = await Storage.transitionWithContentApi({
    fetch: remote.fetch,
    repository: 'example/repo',
    branch: 'main',
    path: 'data/core/github-sync.json',
    action: 'CLAIM',
    args: { workerId: 'worker:a', now: '2026-09-11T00:00:10Z', leaseSeconds: 30 },
    readbackAttempts: 4,
    readbackDelayMs: 1
  });
  assert.equal(result.status, 'LEASED');
  assert.equal(result.aggregate.revision, 3);
  assert.equal(result.blobSha, SHA1);
  assert.equal(remote.puts, 1);
});

test('EMPTY claim is a true no-op and does not create a Git commit', async () => {
  let state = aggregate();
  const claimed = Sync.claimNextJob(state, { workerId: 'worker:a', now: '2026-09-11T00:00:10Z', leaseSeconds: 60 });
  const remote = fakeGitHub(claimed.aggregate, 0);
  const result = await Storage.transitionWithContentApi({
    fetch: remote.fetch,
    repository: 'example/repo',
    branch: 'main',
    path: 'data/core/github-sync.json',
    action: 'CLAIM',
    args: { workerId: 'worker:b', now: '2026-09-11T00:00:20Z' }
  });
  assert.equal(result.status, 'EMPTY');
  assert.equal(remote.puts, 0);
  assert.equal(result.commitSha, null);
});
