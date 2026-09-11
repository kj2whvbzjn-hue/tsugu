const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../static/core-reference.js');

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const DIGEST = `sha256:${'c'.repeat(64)}`;
const repoA = { id: 1, full_name: 'acme/app', html_url: 'https://github.com/acme/app' };
const repoB = { id: 2, full_name: 'acme/other', html_url: 'https://github.com/acme/other' };

function deploymentInput(overrides = {}) {
  return {
    repository: repoA,
    run: {
      id: 100,
      run_attempt: 1,
      head_sha: SHA,
      path: '.github/workflows/pages.yml',
      workflow_id: 9,
      html_url: 'https://github.com/acme/app/actions/runs/100',
      status: 'completed',
      conclusion: 'success'
    },
    artifact: {
      id: 200,
      name: 'github-pages',
      digest: DIGEST,
      size_in_bytes: 1234,
      expired: false,
      workflow_run: { id: 100, head_sha: SHA }
    },
    workflowFile: { sha: 'd'.repeat(40) },
    commit: { sha: SHA, tree: { sha: TREE } },
    publicUrl: 'https://acme.github.io/app/',
    capturedAt: '2026-09-11T00:00:00Z',
    ...overrides
  };
}

test('RepositoryCommitRef identity includes repository and full SHA', () => {
  const a = core.createRepositoryCommitRef(repoA, SHA);
  const b = core.createRepositoryCommitRef(repoB, SHA);
  assert.notEqual(a.id, b.id);
  assert.equal(a.commitSha, SHA);
  assert.equal(core.sameRepositoryCommitRef(a, b), false);
  assert.throws(() => core.createRepositoryCommitRef(repoA, 'abc'), /INVALID_GIT_SHA/);
});

test('RepositoryBaseline fixes commit and tree', () => {
  const baseline = core.createRepositoryBaseline(repoA, { sha: SHA, tree: { sha: TREE } });
  assert.equal(baseline.repositoryCommitRef.commitSha, SHA);
  assert.equal(baseline.treeSha, TREE);
  assert.ok(Object.isFrozen(baseline));
  assert.ok(Object.isFrozen(baseline.repositoryCommitRef));
});

test('Environment is explicit and HTTPS only', () => {
  const env = core.createEnvironment(repoA, { publicUrl: 'https://acme.github.io/app/' });
  assert.equal(env.provider, 'github-pages');
  assert.equal(env.repository.id, 1);
  assert.throws(() => core.createEnvironment(repoA, { publicUrl: 'http://example.com/' }), /INVALID_PUBLIC_URL/);
});

test('Deployment fixes run, artifact digest, configuration, baseline and source', () => {
  const dep = core.createDeployment(deploymentInput());
  assert.equal(dep.source.commitSha, SHA);
  assert.equal(dep.baseline.treeSha, TREE);
  assert.equal(dep.workflow.runId, 100);
  assert.equal(dep.artifact.digest, DIGEST);
  assert.equal(dep.configuration.workflowBlobSha, 'd'.repeat(40));
  assert.equal(dep.configuration.coreReferenceSchemaVersion, 1);
  assert.equal(dep.configuration.projectSchemaVersion, 1);
});

test('same commit redeployed as a different run is a different Deployment', () => {
  const a = core.createDeployment(deploymentInput());
  const bInput = deploymentInput();
  bInput.run = { ...bInput.run, id: 101, html_url: 'https://github.com/acme/app/actions/runs/101' };
  bInput.artifact = { ...bInput.artifact, id: 201, workflow_run: { id: 101, head_sha: SHA } };
  const b = core.createDeployment(bInput);
  assert.equal(a.source.id, b.source.id);
  assert.notEqual(a.id, b.id);
  assert.equal(core.sameDeployment(a, b), false);
});

test('Deployment rejects artifact from another run or commit', () => {
  const wrongRun = deploymentInput();
  wrongRun.artifact = { ...wrongRun.artifact, workflow_run: { id: 999, head_sha: SHA } };
  assert.throws(() => core.createDeployment(wrongRun), /ARTIFACT_RUN_MISMATCH/);

  const wrongSha = deploymentInput();
  wrongSha.artifact = { ...wrongSha.artifact, workflow_run: { id: 100, head_sha: 'e'.repeat(40) } };
  assert.throws(() => core.createDeployment(wrongSha), /ARTIFACT_COMMIT_MISMATCH/);
});

test('captureCurrentDeployment reads exact run and returns typed immutable facts', async () => {
  const responses = new Map([
    ['https://api.github.com/repos/acme/app', repoA],
    ['https://api.github.com/repos/acme/app/actions/runs/100', deploymentInput().run],
    [`https://api.github.com/repos/acme/app/git/commits/${SHA}`, { sha: SHA, tree: { sha: TREE } }],
    ['https://api.github.com/repos/acme/app/actions/runs/100/artifacts', { total_count: 1, artifacts: [deploymentInput().artifact] }],
    [`https://api.github.com/repos/acme/app/contents/.github/workflows/pages.yml?ref=${SHA}`, { sha: 'd'.repeat(40) }]
  ]);
  const fetch = async url => {
    if (!responses.has(url)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(responses.get(url)), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const dep = await core.captureCurrentDeployment({
    fetch,
    repository: 'acme/app',
    runId: 100,
    publicUrl: 'https://acme.github.io/app/',
    capturedAt: '2026-09-11T00:00:00Z'
  });
  assert.equal(dep.type, 'Deployment');
  assert.equal(dep.workflow.runId, 100);
  assert.equal(dep.source.repository.fullName, 'acme/app');
  assert.ok(Object.isFrozen(dep.artifact));
});
