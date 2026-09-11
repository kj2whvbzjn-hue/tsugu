const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../static/core-task-governance.js');
const Hash = require('../static/core-changeset.js');

function h(label) { return Hash.sha256(label); }
function ref(id='target-1', version=1, hash=h(`${id}@${version}`)) { return { type:'BOX_INSTANCE', id, version, contentHash:hash }; }
function taskInput(id='task-1') {
  return {
    id, title:'B03 lifecycle task', targetRef:ref(),
    requirementSnapshotRef:{ type:'REQUIREMENT_SNAPSHOT', id:'snapshot-1', version:1, contentHash:h('snapshot-1@1') },
    startCriteria:[{id:'baseline-ready',kind:'BASELINE'}],
    completionCriteria:[{id:'checks-pass',kind:'CHECK'}]
  };
}
function code(fn, expected) {
  assert.throws(fn, e => e && e.code === expected);
}

test('Task keeps start and completion gates separate and fail-closed', () => {
  let s = G.createState('p1');
  code(() => G.createTask(s, { ...taskInput(), completionCriteria:[{id:'baseline-ready',kind:'CHECK'}] }, 'alice', '2026-09-11T00:00:00Z'), 'TASK_GATE_NOT_SEPARATED');
  s = G.createTask(s, taskInput(), 'alice', '2026-09-11T00:00:00Z');
  code(() => G.startTask(s, 'task-1', 'alice', { at:'2026-09-11T00:01:00Z', gateResults:{'baseline-ready':'UNKNOWN'} }), 'TASK_GATE_BLOCKED');
  s = G.startTask(s, 'task-1', 'alice', { at:'2026-09-11T00:01:00Z', gateResults:{'baseline-ready':'PASS'} });
  assert.equal(s.tasks[0].status, 'ACTIVE');
  code(() => G.completeTask(s, 'task-1', 'alice', { at:'2026-09-11T00:02:00Z', gateResults:{'checks-pass':'FAIL'} }), 'TASK_GATE_BLOCKED');
  s = G.completeTask(s, 'task-1', 'alice', { at:'2026-09-11T00:03:00Z', gateResults:{'checks-pass':'PASS'} });
  assert.equal(s.tasks[0].status, 'COMPLETED');
  assert.deepEqual(s.tasks[0].history.map(x => x.action), ['START','COMPLETE']);
  code(() => G.resumeTask(s, 'task-1', 'alice', { at:'2026-09-11T00:04:00Z' }), 'TASK_TERMINAL');
});

test('Task Hold / Interrupt / Resume / Cancel append history without erasing prior states', () => {
  let s = G.createState('p1');
  s = G.createTask(s, taskInput(), 'alice', '2026-09-11T00:00:00Z');
  s = G.startTask(s, 'task-1', 'alice', { at:'2026-09-11T00:01:00Z', gateResults:{'baseline-ready':'PASS'} });
  s = G.holdTask(s, 'task-1', 'bob', { at:'2026-09-11T00:02:00Z', reason:'external dependency' });
  s = G.resumeTask(s, 'task-1', 'bob', { at:'2026-09-11T00:03:00Z' });
  s = G.interruptTask(s, 'task-1', 'alice', { at:'2026-09-11T00:04:00Z', reason:'incident' });
  s = G.resumeTask(s, 'task-1', 'alice', { at:'2026-09-11T00:05:00Z' });
  s = G.cancelTask(s, 'task-1', 'alice', { at:'2026-09-11T00:06:00Z', reason:'superseded' });
  assert.equal(s.tasks[0].status, 'CANCELLED');
  assert.deepEqual(s.tasks[0].history.map(x => x.to), ['ACTIVE','ON_HOLD','ACTIVE','INTERRUPTED','ACTIVE','CANCELLED']);
  assert.deepEqual(s.tasks[0].history.map(x => x.seq), [1,2,3,4,5,6]);
});

test('Task target reference is fixed by version and content hash', () => {
  let s = G.createState('p1');
  s = G.createTask(s, taskInput(), 'alice', '2026-09-11T00:00:00Z');
  const saved = structuredClone(s);
  saved.tasks[0].targetRef.version = 2;
  code(() => G.validateState(saved), 'TASK_TARGET_HASH_MISMATCH');
});

test('Approval fixes target, actor and immutable content hash', () => {
  let s = G.createState('p1');
  s = G.createApproval(s, { id:'approval-1', targetRef:ref(), decision:'APPROVED', rationale:'reviewed exact target' }, 'reviewer', '2026-09-11T01:00:00Z');
  const a = s.approvals[0];
  assert.equal(a.actorId, 'reviewer');
  assert.match(a.contentHash, /^sha256:/);
  const tampered = structuredClone(s); tampered.approvals[0].rationale = 'changed later';
  code(() => G.validateState(tampered), 'APPROVAL_CONTENT_HASH_MISMATCH');
});

test('Waiver applies only to exact Rule version/hash and exact target, and can be revoked', () => {
  let s = G.createState('p1');
  const ruleRef = { id:'rule-1', version:3, contentHash:h('rule-1@3') };
  s = G.createWaiver(s, { id:'waiver-1', ruleRef, targetRef:ref(), reason:'approved exception', expiresAt:'2026-09-12T00:00:00Z' }, 'owner', '2026-09-11T00:00:00Z');
  assert.equal(G.isWaiverApplicable(s.waivers[0], ruleRef, ref(), '2026-09-11T12:00:00Z'), true);
  assert.equal(G.isWaiverApplicable(s.waivers[0], { ...ruleRef, version:4 }, ref(), '2026-09-11T12:00:00Z'), false);
  assert.equal(G.isWaiverApplicable(s.waivers[0], ruleRef, ref('target-2'), '2026-09-11T12:00:00Z'), false);
  assert.equal(G.isWaiverApplicable(s.waivers[0], ruleRef, ref(), '2026-09-12T00:00:00Z'), false);
  s = G.revokeWaiver(s, 'waiver-1', 'owner', 'exception withdrawn', '2026-09-11T13:00:00Z');
  assert.equal(G.isWaiverApplicable(s.waivers[0], ruleRef, ref(), '2026-09-11T13:01:00Z'), false);
});

test('Decision finalization fixes selected option, rationale, actor and hash', () => {
  let s = G.createState('p1');
  s = G.createDecision(s, { id:'decision-1', targetRef:ref(), question:'Which path?', options:['A','B'] }, 'alice', '2026-09-11T00:00:00Z');
  s = G.finalizeDecision(s, 'decision-1', 'B', 'meets constraints', 'architect', '2026-09-11T02:00:00Z');
  assert.equal(s.decisions[0].status, 'FINAL');
  const tampered = structuredClone(s); tampered.decisions[0].selected = 'A';
  code(() => G.validateState(tampered), 'DECISION_CONTENT_HASH_MISMATCH');
  code(() => G.finalizeDecision(s, 'decision-1', 'A', 'again', 'architect', '2026-09-11T03:00:00Z'), 'DECISION_ALREADY_FINAL');
});

test('Issue resolve/reopen/close history is append-only', () => {
  let s = G.createState('p1');
  s = G.createIssue(s, { id:'issue-1', targetRef:ref(), title:'Verification failure', severity:'HIGH' }, 'alice', '2026-09-11T00:00:00Z');
  s = G.transitionIssue(s, 'issue-1', 'RESOLVE', 'alice', 'fixed once', '2026-09-11T01:00:00Z');
  s = G.transitionIssue(s, 'issue-1', 'REOPEN', 'bob', 'regressed', '2026-09-11T02:00:00Z');
  s = G.transitionIssue(s, 'issue-1', 'RESOLVE', 'bob', 'fixed again', '2026-09-11T03:00:00Z');
  s = G.transitionIssue(s, 'issue-1', 'CLOSE', 'owner', 'verified', '2026-09-11T04:00:00Z');
  assert.equal(s.issues[0].status, 'CLOSED');
  assert.deepEqual(s.issues[0].history.map(x => x.action), ['RESOLVE','REOPEN','RESOLVE','CLOSE']);
  assert.equal(s.issues[0].history[0].reason, 'fixed once');
  assert.equal(s.issues[0].history[2].reason, 'fixed again');
  code(() => G.transitionIssue(s, 'issue-1', 'REOPEN', 'owner', 'no', '2026-09-11T05:00:00Z'), 'INVALID_ISSUE_TRANSITION');
});

test('Project scope and duplicate IDs fail closed', () => {
  let s = G.createState('p1');
  s = G.createTask(s, taskInput(), 'alice', '2026-09-11T00:00:00Z');
  code(() => G.createTask(s, taskInput(), 'alice', '2026-09-11T00:00:01Z'), 'DUPLICATE_ENTITY_ID');
  const foreign = structuredClone(s); foreign.tasks[0].projectId = 'p2';
  code(() => G.validateState(foreign), 'PROJECT_SCOPE_VIOLATION');
});
