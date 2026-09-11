const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../static/core-guard.js');

const endpoint = {
  owner: 'kj2whvbzjn-hue', repo: 'tsugu-data', projectId: '11111111-1111-4111-8111-111111111111',
  path: 'data/projects/11111111-1111-4111-8111-111111111111.json'
};
const user = { login: 'owner', id: 123, type: 'User' };
const adminRepo = { permissions: { admin: true, maintain: true, push: true, pull: true } };
const editorRepo = { permissions: { admin: false, maintain: false, push: true, pull: true } };

function b64(obj) { return Buffer.from(JSON.stringify(obj, null, 2)).toString('base64'); }
function record(revision = 1) {
  return {
    storageVersion: 1,
    project: {
      schemaVersion: 1, id: endpoint.projectId, name: 'A', stage: '検討', purpose: '', rules: '', focus: '', baseline: '', next: '',
      implementationApproved: false, completionApproved: false,
      core: { architectureNodes: [], tasks: [], checks: [] }, items: []
    },
    revision,
    updatedAt: '2026-09-11T00:00:00.000Z'
  };
}
const uuid = () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function prepare(nextRecord, previousRecord = null, repoMeta = adminRepo) {
  return guard.prepareProjectWrite({ endpoint, body: { message: 'x', content: b64(nextRecord), branch: 'main' }, previousRecord, user, repoMeta, now: '2026-09-11T00:00:00.000Z', randomUUID: uuid });
}

test('new project seeds authenticated actor, derived permission, and audit', async () => {
  const out = await prepare(record(1));
  assert.equal(out.role, 'PROJECT_ADMIN');
  assert.equal(out.record.project.core.actors[0].id, 'github:123');
  assert.equal(out.record.project.core.permissions[0].role, 'PROJECT_ADMIN');
  assert.equal(out.record.project.core.auditEvents[0].actorLogin, 'owner');
  assert.equal(out.record.project.core.auditEvents[0].recordRevision, 1);
  assert.match(out.payloadHash, /^sha256:[a-f0-9]{64}$/);
});

test('project path mismatch is rejected', async () => {
  const r = record(1); r.project.id = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(() => prepare(r), /PROJECT_SCOPE_VIOLATION/);
});

test('nested cross-project references are rejected', async () => {
  const r = record(1); r.project.core.tasks.push({ id: 't1', projectId: 'other' });
  await assert.rejects(() => prepare(r), /PROJECT_SCOPE_VIOLATION/);
});

test('actor spoof in a changed approval is rejected', async () => {
  const prev = record(1);
  const first = await prepare(prev);
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 2;
  next.project.implementationApproved = true;
  next.project.implementationApproval = { approvedRevision: 2, approvedAt: 'x', approvedBy: 'mallory' };
  await assert.rejects(() => prepare(next, first.record), /ACTOR_SPOOF/);
});

test('editor cannot create approval even when actor is authentic', async () => {
  const first = await prepare(record(1), null, editorRepo);
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 2;
  next.project.implementationApproved = true;
  next.project.implementationApproval = { approvedRevision: 2, approvedAt: 'x', approvedBy: 'owner' };
  await assert.rejects(() => prepare(next, first.record, editorRepo), /PERMISSION_DENIED/);
});

test('system managed permission self-elevation is rejected', async () => {
  const first = await prepare(record(1), null, editorRepo);
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 2;
  next.project.core.permissions[0].role = 'PROJECT_ADMIN';
  await assert.rejects(() => prepare(next, first.record, editorRepo), /SYSTEM_MANAGED_FIELD/);
});

test('audit history deletion is rejected', async () => {
  const first = await prepare(record(1));
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 2;
  next.project.core.auditEvents = [];
  await assert.rejects(() => prepare(next, first.record), /SYSTEM_MANAGED_FIELD/);
});

test('revision must advance exactly by one', async () => {
  const first = await prepare(record(1));
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 3;
  await assert.rejects(() => prepare(next, first.record), /REVISION_CONFLICT/);
});

test('guard-managed fields may be omitted by legacy UI and are preserved', async () => {
  const firstInput = record(1);
  const first = await prepare(firstInput);
  const next = record(2);
  next.project.focus = 'second save without reload';
  const out = await prepare(next, first.record);
  assert.equal(out.record.project.core.auditEvents.length, 2);
  assert.equal(out.record.project.core.actors[0].id, 'github:123');
});

test('non-admin writer is derived as editor and can save ordinary updates', async () => {
  const first = await prepare(record(1), null, editorRepo);
  const next = JSON.parse(JSON.stringify(first.record));
  next.revision = 2;
  next.project.focus = 'updated';
  const out = await prepare(next, first.record, editorRepo);
  assert.equal(out.role, 'EDITOR');
  assert.equal(out.record.project.core.permissions[0].role, 'EDITOR');
  assert.equal(out.record.project.core.auditEvents.length, 2);
});
