const test = require('node:test');
const assert = require('node:assert/strict');
const Architecture = require('../static/core-architecture.js');
const ChangeSet = require('../static/core-changeset.js');

const BASE_SHA = 'a'.repeat(40);
const NEXT_SHA = 'b'.repeat(40);

function architecture() {
  return Architecture.createProjectArchitecture({
    projectId: 'project:a04',
    name: 'A-04',
    revision: 1,
    repositoryScopes: [{ repositoryId: 1, fullName: 'example/data' }]
  });
}
function aggregate() { return ChangeSet.createAggregate(architecture()); }
function change(overrides = {}) {
  return ChangeSet.createChangeSet({
    id: 'changeset:a04:1',
    projectId: 'project:a04',
    idempotencyKey: 'idem:a04:1',
    baseRevision: 1,
    baseBlobSha: BASE_SHA,
    createdBy: 'actor:test',
    operations: [{ type: 'ADD_NODE', id: 'node:root', name: 'Root' }],
    preconditions: [],
    ...overrides
  });
}
function validated(a = aggregate(), cs = change(), sha = BASE_SHA, now = '2026-09-11T00:00:00Z') {
  return ChangeSet.validateChangeSet(a, sha, cs, { now });
}

function fakeGitHub(initialAggregate, { conflictOnPut = false } = {}) {
  let content = ChangeSet.stableStringify(initialAggregate);
  let sha = BASE_SHA;
  let puts = 0;
  async function fetch(url, init = {}) {
    if ((init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ sha, content: Buffer.from(content, 'utf8').toString('base64') }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
    if (init.method === 'PUT') {
      puts += 1;
      if (conflictOnPut) return new Response(JSON.stringify({ message: 'sha does not match' }), { status: 409 });
      const body = JSON.parse(init.body);
      if (body.sha !== sha) return new Response(JSON.stringify({ message: 'sha does not match' }), { status: 409 });
      content = Buffer.from(body.content, 'base64').toString('utf8');
      sha = NEXT_SHA;
      return new Response(JSON.stringify({ content: { sha }, commit: { sha: 'c'.repeat(40) } }), { status: 200 });
    }
    return new Response('{}', { status: 405 });
  }
  return { fetch, get puts() { return puts; }, snapshot: () => ({ content, sha }) };
}

test('SHA-256 implementation matches known vector and canonical object ordering', () => {
  assert.equal(ChangeSet.sha256('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(ChangeSet.sha256({ b: 2, a: 1 }), ChangeSet.sha256({ a: 1, b: 2 }));
});

test('ChangeSet fixes payloadHash and rejects tampering', () => {
  const cs = change();
  assert.match(cs.payloadHash, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => ChangeSet.validateChangeSetShape({ ...cs, payloadHash: 'sha256:' + '0'.repeat(64) }), e => e.code === 'CHANGESET_PAYLOAD_HASH_MISMATCH');
});

test('ValidationRecord fixes base, candidate hash, targets and result revision', () => {
  const result = validated();
  assert.equal(result.validationRecord.status, 'PASS');
  assert.equal(result.validationRecord.baseRevision, 1);
  assert.equal(result.validationRecord.baseBlobSha, BASE_SHA);
  assert.equal(result.validationRecord.resultRevision, 2);
  assert.deepEqual(result.validationRecord.targetIds, ['node:root']);
  assert.match(result.validationRecord.candidateHash, /^sha256:[a-f0-9]{64}$/);
});

test('stale base revision or blob SHA rejects the entire ChangeSet', () => {
  assert.throws(() => ChangeSet.validateChangeSet(aggregate(), NEXT_SHA, change()), e => e.code === 'STALE_CHANGESET');
  assert.throws(() => ChangeSet.validateChangeSet(aggregate(), BASE_SHA, change({ baseRevision: 2 })), e => e.code === 'STALE_CHANGESET');
});

test('entity revision and repository scope preconditions fail closed', () => {
  const missingNode = change({ preconditions: [{ type: 'ENTITY_REVISION', entityType: 'NODE', entityId: 'node:missing', revision: 1 }] });
  assert.throws(() => ChangeSet.validateChangeSet(aggregate(), BASE_SHA, missingNode), e => e.code === 'PRECONDITION_FAILED');
  const missingRepo = change({ preconditions: [{ type: 'REPOSITORY_SCOPE', repositoryId: 999 }] });
  assert.throws(() => ChangeSet.validateChangeSet(aggregate(), BASE_SHA, missingRepo), e => e.code === 'PRECONDITION_FAILED');
});

test('candidate validation inherits Architecture fail-closed rules', () => {
  const cs = change({ operations: [
    { type: 'ADD_NODE', id: 'node:a', name: 'A' },
    { type: 'ADD_NODE', id: 'node:b', name: 'A' }
  ] });
  assert.throws(() => ChangeSet.validateChangeSet(aggregate(), BASE_SHA, cs), e => e.code === 'NODE_NAME_COLLISION');
});

test('prepareApply atomically includes entity change, applied record, AuditEvent and OutboxRecord', () => {
  const a = aggregate(), cs = change(), v = validated(a, cs);
  const prepared = ChangeSet.prepareApply(a, BASE_SHA, cs, v.validationRecord, { actor: 'actor:apply', now: '2026-09-11T00:01:00Z' });
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.aggregate.revision, 2);
  assert.equal(prepared.aggregate.architecture.architectureNodes.length, 1);
  assert.equal(prepared.aggregate.appliedChangeSets.length, 1);
  assert.equal(prepared.aggregate.auditEvents.length, 1);
  assert.equal(prepared.aggregate.outbox.length, 1);
  assert.equal(prepared.aggregate.outbox[0].status, 'PENDING');
});

test('Apply revalidates ValidationRecord and rejects a candidate mismatch', () => {
  const a = aggregate(), cs = change(), v = validated(a, cs);
  const bad = { ...v.validationRecord, candidateHash: 'sha256:' + '0'.repeat(64) };
  assert.throws(() => ChangeSet.prepareApply(a, BASE_SHA, cs, bad), e => e.code === 'VALIDATION_RECORD_MISMATCH');
});

test('same idempotency key + same payload replays; different payload is rejected', () => {
  const a = aggregate(), cs = change(), v = validated(a, cs);
  const first = ChangeSet.prepareApply(a, BASE_SHA, cs, v.validationRecord, { now: '2026-09-11T00:01:00Z' });
  const replay = ChangeSet.prepareApply(first.aggregate, NEXT_SHA, cs, v.validationRecord, { now: '2026-09-11T00:02:00Z' });
  assert.equal(replay.status, 'IDEMPOTENT_REPLAY');
  const different = change({ operations: [{ type: 'ADD_NODE', id: 'node:other', name: 'Other' }] });
  assert.throws(() => ChangeSet.prepareApply(first.aggregate, NEXT_SHA, different, v.validationRecord), e => e.code === 'IDEMPOTENCY_KEY_REUSED');
});

test('Contents API apply writes one aggregate then verifies readback', async () => {
  const a = aggregate(), cs = change(), v = validated(a, cs);
  const remote = fakeGitHub(a);
  const result = await ChangeSet.applyWithContentApi({
    fetch: remote.fetch, owner: 'example', repo: 'data', branch: 'main', path: 'data/core/project-a04.json',
    changeSet: cs, validationRecord: v.validationRecord, actor: 'actor:apply', now: '2026-09-11T00:01:00Z'
  });
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.revision, 2);
  assert.equal(result.blobSha, NEXT_SHA);
  assert.equal(remote.puts, 1);
  const stored = JSON.parse(remote.snapshot().content);
  assert.equal(stored.architecture.architectureNodes[0].id, 'node:root');
  assert.equal(stored.auditEvents.length, 1);
  assert.equal(stored.outbox.length, 1);
});

test('GitHub CAS conflict becomes STALE_CHANGESET and leaves no partial aggregate write', async () => {
  const a = aggregate(), cs = change(), v = validated(a, cs);
  const remote = fakeGitHub(a, { conflictOnPut: true });
  const before = remote.snapshot().content;
  await assert.rejects(() => ChangeSet.applyWithContentApi({
    fetch: remote.fetch, owner: 'example', repo: 'data', branch: 'main', path: 'data/core/project-a04.json',
    changeSet: cs, validationRecord: v.validationRecord, now: '2026-09-11T00:01:00Z'
  }), e => e.code === 'STALE_CHANGESET');
  assert.equal(remote.snapshot().content, before);
  assert.equal(remote.puts, 1);
});
