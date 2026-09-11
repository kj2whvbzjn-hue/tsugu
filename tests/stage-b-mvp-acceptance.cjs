'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'static', 'stage-b-mvp-scenarios.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.taskId, 'B-07');
assert.equal(manifest.scenarios.length, 10, 'B-07 must execute exactly ten Chapter 9 scenarios');
assert.deepEqual(manifest.scenarios.map(x => x.id), Array.from({length:10}, (_,i) => `MVP-${String(i+1).padStart(2,'0')}`));

const uniqueContracts = [...new Set(manifest.scenarios.flatMap(x => x.contracts || []))];
const contractResults = new Map();
for (const rel of uniqueContracts) {
  const abs = path.join(root, rel);
  assert.ok(fs.existsSync(abs), `Missing scenario contract: ${rel}`);
  const r = spawnSync(process.execPath, ['--test', rel], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env }
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const tail = `${stdout}\n${stderr}`.trim().split(/\r?\n/).slice(-12).join('\n');
  contractResults.set(rel, { exitCode: r.status == null ? 1 : r.status, tail });
  console.log(`[contract] ${r.status === 0 ? 'PASS' : 'FAIL'} ${rel}`);
}

const scenarios = manifest.scenarios.map(s => {
  const contracts = (s.contracts || []).map(rel => ({ path: rel, ...contractResults.get(rel) }));
  const status = contracts.every(x => x.exitCode === 0) ? 'PASS' : 'FAIL';
  console.log(`[${s.id}] ${status} ${s.title}`);
  return {
    id: s.id,
    title: s.title,
    expected: s.expected,
    status,
    contracts,
    requiredLiveChecks: s.liveChecks || []
  };
});

const overall = scenarios.every(x => x.status === 'PASS') ? 'PASS_CONTRACT' : 'FAIL';
const report = {
  type: 'StageBMvpAcceptanceEvidence',
  schemaVersion: 1,
  taskId: 'B-07',
  sourceSha: process.env.SOURCE_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  generatedAt: new Date().toISOString(),
  overall,
  scenarios
};
const output = process.env.STAGE_B_EVIDENCE_PATH || path.join(root, 'stage-b-mvp-evidence.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (overall !== 'PASS_CONTRACT') process.exitCode = 1;
