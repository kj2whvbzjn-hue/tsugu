const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('../static/core-sync.js');

const REPO = { id: 10, full_name: 'acme/app' };
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

function base(){ return Sync.createSyncAggregate({ projectId:'project:sync' }); }

test('receive persists commit identity once and deduplicates same repository+SHA', () => {
  const first = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' });
  assert.equal(first.status, 'RECEIVED');
  assert.equal(first.aggregate.integrations.length, 1);
  assert.equal(first.aggregate.jobs.length, 1);
  assert.equal(first.integrationRecord.commitRef.id, `repository-commit:github:10:${SHA1}`);
  const second = Sync.receiveCommit(first.aggregate, REPO, SHA1, 'main', { now:'2026-09-11T00:01:00Z' });
  assert.equal(second.status, 'DEDUPED');
  assert.equal(second.aggregate.integrations.length, 1);
  assert.equal(second.aggregate.jobs.length, 1);
});

test('same SHA in another repository is a distinct IntegrationRecord', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  s = Sync.receiveCommit(s, { id:20, full_name:'acme/other' }, SHA1, 'main', { now:'2026-09-11T00:01:00Z' }).aggregate;
  assert.equal(s.integrations.length, 2);
});

test('lease claim is exclusive until expiry and expired lease is recoverable', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  const one = Sync.claimNextJob(s, { workerId:'worker:a', now:'2026-09-11T00:00:10Z', leaseSeconds:30 });
  assert.equal(one.status, 'LEASED');
  assert.equal(one.job.attempts, 1);
  assert.equal(Sync.claimNextJob(one.aggregate, { workerId:'worker:b', now:'2026-09-11T00:00:20Z' }).status, 'EMPTY');
  const recovered = Sync.claimNextJob(one.aggregate, { workerId:'worker:b', now:'2026-09-11T00:00:41Z', leaseSeconds:30 });
  assert.equal(recovered.status, 'LEASED');
  assert.equal(recovered.job.leaseOwner, 'worker:b');
  assert.equal(recovered.job.attempts, 2);
});

test('successful completion marks both job and IntegrationRecord', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  const claim = Sync.claimNextJob(s, { workerId:'worker:a', now:'2026-09-11T00:00:10Z' });
  const done = Sync.completeJob(claim.aggregate, claim.job.id, { workerId:'worker:a', now:'2026-09-11T00:00:20Z' });
  assert.equal(done.job.status, 'SUCCEEDED');
  assert.equal(done.aggregate.integrations[0].status, 'PROCESSED');
});

test('failed job retries after nextAttemptAt and becomes DEAD at max attempts', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z', maxAttempts:2 }).aggregate;
  let claim = Sync.claimNextJob(s, { workerId:'worker:a', now:'2026-09-11T00:00:10Z' });
  let failed = Sync.failJob(claim.aggregate, claim.job.id, new Error('boom'), { workerId:'worker:a', now:'2026-09-11T00:00:20Z', retrySeconds:30 });
  assert.equal(failed.status, 'PENDING');
  assert.equal(Sync.claimNextJob(failed.aggregate, { workerId:'worker:a', now:'2026-09-11T00:00:40Z' }).status, 'EMPTY');
  claim = Sync.claimNextJob(failed.aggregate, { workerId:'worker:a', now:'2026-09-11T00:00:51Z' });
  failed = Sync.failJob(claim.aggregate, claim.job.id, 'again', { workerId:'worker:a', now:'2026-09-11T00:01:00Z' });
  assert.equal(failed.status, 'DEAD');
  assert.equal(failed.aggregate.integrations[0].status, 'ERROR');
});

test('completion requires current lease owner and unexpired lease', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  const claim = Sync.claimNextJob(s, { workerId:'worker:a', now:'2026-09-11T00:00:10Z', leaseSeconds:10 });
  assert.throws(() => Sync.completeJob(claim.aggregate, claim.job.id, { workerId:'worker:b', now:'2026-09-11T00:00:15Z' }), e => e.code==='SYNC_LEASE_NOT_OWNED');
  assert.throws(() => Sync.completeJob(claim.aggregate, claim.job.id, { workerId:'worker:a', now:'2026-09-11T00:00:21Z' }), e => e.code==='SYNC_LEASE_EXPIRED');
});

test('statusSummary exposes admin-facing pending, leased, dead and latest commit state', () => {
  let s = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  s = Sync.receiveCommit(s, REPO, SHA2, 'main', { now:'2026-09-11T00:01:00Z' }).aggregate;
  const claim = Sync.claimNextJob(s, { workerId:'worker:a', now:'2026-09-11T00:01:10Z' });
  const summary = Sync.statusSummary(claim.aggregate, '2026-09-11T00:01:11Z');
  assert.equal(summary.received, 2);
  assert.equal(summary.pending, 1);
  assert.equal(summary.leased, 1);
  assert.equal(summary.latestCommitSha, SHA2);
});

test('hydrate validation rejects duplicate business integrations and orphan jobs', () => {
  const received = Sync.receiveCommit(base(), REPO, SHA1, 'main', { now:'2026-09-11T00:00:00Z' }).aggregate;
  const dup = JSON.parse(JSON.stringify(received)); dup.integrations.push(dup.integrations[0]);
  assert.throws(() => Sync.validateSyncAggregate(dup), e => e.code==='DUPLICATE_INTEGRATION');
  const orphan = JSON.parse(JSON.stringify(received)); orphan.jobs[0].integrationRecordId='missing';
  assert.throws(() => Sync.validateSyncAggregate(orphan), e => e.code==='SYNC_JOB_INTEGRATION_NOT_FOUND');
});

require('./core-sync-storage.test.cjs');
require('./core-sync-reconcile.test.cjs');
