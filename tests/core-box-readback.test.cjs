const test = require('node:test');
const assert = require('node:assert/strict');
const Architecture = require('../static/core-architecture.js');
const Box = require('../static/core-box.js');
const BoxChangeSet = require('../static/core-box-changeset.js');

const BASE_SHA = 'a'.repeat(40);
const NEXT_SHA = 'b'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);

function aggregate() {
  let architecture = Architecture.createProjectArchitecture({
    projectId: 'project:b01:readback',
    name: 'B01 Readback',
    repositoryScopes: [{ repositoryId: 1, fullName: 'acme/app' }]
  });
  architecture = Architecture.addArchitectureNode(architecture, { id: 'node:root', name: 'Root' });
  return BoxChangeSet.createAggregate(Box.migrateFromStageA(architecture));
}

function laggingGitHub(initial) {
  const oldContent = BoxChangeSet.stableStringify(initial);
  let newContent = null;
  let puts = 0;
  const refs = [];
  async function fetch(url, init = {}) {
    const method = init.method || 'GET';
    if (method === 'GET') {
      const ref = new URL(url).searchParams.get('ref');
      refs.push(ref);
      if (ref === COMMIT_SHA && newContent != null) {
        return new Response(JSON.stringify({ sha: NEXT_SHA, content: Buffer.from(newContent).toString('base64') }), { status: 200 });
      }
      return new Response(JSON.stringify({ sha: BASE_SHA, content: Buffer.from(oldContent).toString('base64') }), { status: 200 });
    }
    if (method === 'PUT') {
      puts += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.sha, BASE_SHA);
      newContent = Buffer.from(body.content, 'base64').toString('utf8');
      return new Response(JSON.stringify({ content: { sha: NEXT_SHA }, commit: { sha: COMMIT_SHA } }), { status: 200 });
    }
    return new Response('{}', { status: 405 });
  }
  return { fetch, get puts() { return puts; }, refs };
}

test('Apply readback pins the write commit instead of an eventually-consistent branch ref', async () => {
  const initial = aggregate();
  const remote = laggingGitHub(initial);
  const changeSet = BoxChangeSet.createChangeSet({
    id: 'box-changeset:readback',
    projectId: initial.projectId,
    idempotencyKey: 'idem:readback',
    baseRevision: initial.revision,
    baseBlobSha: BASE_SHA,
    createdBy: 'actor:test',
    operations: [{ type: 'SEED_SYSTEM_DEFINITIONS' }]
  });
  const validation = BoxChangeSet.validateChangeSet(initial, BASE_SHA, changeSet, { now: '2026-09-11T00:00:00Z' });
  const result = await BoxChangeSet.applyWithContentApi({
    fetch: remote.fetch,
    owner: 'acme', repo: 'app', branch: 'main', path: 'data/box.json',
    changeSet, validationRecord: validation.validationRecord,
    actor: 'actor:test', now: '2026-09-11T00:01:00Z'
  });
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.commitSha, COMMIT_SHA);
  assert.equal(result.blobSha, NEXT_SHA);
  assert.equal(remote.puts, 1);
  assert.deepEqual(remote.refs, ['main', COMMIT_SHA]);
});
