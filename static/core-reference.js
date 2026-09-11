(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreReference = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const CORE_REFERENCE_SCHEMA_VERSION = 1;
  const PROJECT_SCHEMA_VERSION = 1;
  const DEFAULT_CODE_REPOSITORY = 'kj2whvbzjn-hue/tsugu';
  const DEFAULT_WORKFLOW_PATH = '.github/workflows/pages.yml';
  const DEFAULT_ENVIRONMENT_NAME = 'github-pages';
  const DEFAULT_PUBLIC_URL = 'https://kj2whvbzjn-hue.github.io/tsugu/';

  function refError(code, message) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
    return value;
  }

  function assertFullSha(value, fieldName) {
    const sha = String(value || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha)) {
      throw refError('INVALID_GIT_SHA', `${fieldName || 'sha'} は40桁のfull SHAである必要があります`);
    }
    return sha;
  }

  function assertSha256(value, fieldName) {
    const digest = String(value || '').toLowerCase();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw refError('INVALID_SHA256', `${fieldName || 'digest'} はsha256:<64 hex>である必要があります`);
    }
    return digest;
  }

  function assertPositiveInteger(value, fieldName) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw refError('INVALID_INTEGER', `${fieldName || 'value'} は正の整数である必要があります`);
    }
    return n;
  }

  function normalizeRepository(repository) {
    if (!repository || typeof repository !== 'object') {
      throw refError('REPOSITORY_REQUIRED', 'GitHub repository metadata が必要です');
    }
    const id = assertPositiveInteger(repository.id, 'repository.id');
    const fullName = String(repository.full_name || repository.fullName || '').trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
      throw refError('INVALID_REPOSITORY', 'repository.full_name は owner/name 形式である必要があります');
    }
    return {
      id,
      fullName,
      htmlUrl: repository.html_url || repository.htmlUrl || `https://github.com/${fullName}`
    };
  }

  function createRepositoryCommitRef(repository, commitSha) {
    const repo = normalizeRepository(repository);
    const sha = assertFullSha(commitSha, 'commitSha');
    return deepFreeze({
      type: 'RepositoryCommitRef',
      schemaVersion: CORE_REFERENCE_SCHEMA_VERSION,
      id: `repository-commit:github:${repo.id}:${sha}`,
      repository: repo,
      commitSha: sha
    });
  }

  function createRepositoryBaseline(repository, commit) {
    if (!commit || typeof commit !== 'object') {
      throw refError('COMMIT_REQUIRED', 'Git commit metadata が必要です');
    }
    const commitSha = assertFullSha(commit.sha || commit.commitSha, 'commit.sha');
    const treeSha = assertFullSha(commit.tree && commit.tree.sha ? commit.tree.sha : commit.treeSha, 'commit.tree.sha');
    const commitRef = createRepositoryCommitRef(repository, commitSha);
    return deepFreeze({
      type: 'RepositoryBaseline',
      schemaVersion: CORE_REFERENCE_SCHEMA_VERSION,
      id: `repository-baseline:${commitRef.id}:${treeSha}`,
      repositoryCommitRef: commitRef,
      treeSha
    });
  }

  function createEnvironment(repository, options = {}) {
    const repo = normalizeRepository(repository);
    const name = String(options.name || DEFAULT_ENVIRONMENT_NAME);
    const publicUrl = String(options.publicUrl || DEFAULT_PUBLIC_URL);
    let parsed;
    try { parsed = new URL(publicUrl); }
    catch { throw refError('INVALID_PUBLIC_URL', 'Environment publicUrl がURLではありません'); }
    if (parsed.protocol !== 'https:') throw refError('INVALID_PUBLIC_URL', 'Environment publicUrl はHTTPSである必要があります');
    return deepFreeze({
      type: 'Environment',
      schemaVersion: CORE_REFERENCE_SCHEMA_VERSION,
      id: `environment:github-pages:${repo.id}:${name}`,
      provider: 'github-pages',
      name,
      repository: repo,
      publicUrl: parsed.toString()
    });
  }

  function createDeployment(input) {
    if (!input || typeof input !== 'object') throw refError('DEPLOYMENT_REQUIRED', 'Deployment facts が必要です');
    const repo = normalizeRepository(input.repository);
    const run = input.run || {};
    const artifact = input.artifact || {};
    const workflowFile = input.workflowFile || {};
    const commit = input.commit || {};

    const runId = assertPositiveInteger(run.id, 'run.id');
    const runAttempt = assertPositiveInteger(run.run_attempt || run.runAttempt || 1, 'run.run_attempt');
    const sourceSha = assertFullSha(run.head_sha || run.headSha, 'run.head_sha');
    const baseline = createRepositoryBaseline(repo, {
      sha: commit.sha || sourceSha,
      tree: commit.tree
    });
    if (baseline.repositoryCommitRef.commitSha !== sourceSha) {
      throw refError('DEPLOYMENT_COMMIT_MISMATCH', 'workflow runとGit commitのSHAが一致しません');
    }
    if ((run.status && run.status !== 'completed') || (run.conclusion && run.conclusion !== 'success')) {
      throw refError('DEPLOYMENT_NOT_SUCCESSFUL', 'Deployment workflow run がsuccessではありません');
    }
    if (String(run.path || '') !== String(input.workflowPath || DEFAULT_WORKFLOW_PATH)) {
      throw refError('DEPLOYMENT_WORKFLOW_MISMATCH', 'Deployment workflow path が期待値と一致しません');
    }
    const artifactRun = artifact.workflow_run || artifact.workflowRun || {};
    if (artifactRun.id != null && Number(artifactRun.id) !== runId) {
      throw refError('ARTIFACT_RUN_MISMATCH', 'artifactとworkflow runのIDが一致しません');
    }
    if (artifactRun.head_sha && assertFullSha(artifactRun.head_sha, 'artifact.workflow_run.head_sha') !== sourceSha) {
      throw refError('ARTIFACT_COMMIT_MISMATCH', 'artifactとworkflow runのcommitが一致しません');
    }
    if (artifact.expired === true) throw refError('ARTIFACT_EXPIRED', 'Deployment artifact は期限切れです');

    const artifactId = assertPositiveInteger(artifact.id, 'artifact.id');
    if (String(artifact.name || '') !== 'github-pages') throw refError('INVALID_DEPLOYMENT_ARTIFACT', 'artifact.name はgithub-pagesである必要があります');
    const artifactDigest = assertSha256(artifact.digest, 'artifact.digest');
    const artifactSize = assertPositiveInteger(artifact.size_in_bytes || artifact.sizeBytes, 'artifact.size_in_bytes');
    const configBlobSha = assertFullSha(workflowFile.sha, 'workflowFile.sha');
    const environment = createEnvironment(repo, {
      name: input.environmentName || DEFAULT_ENVIRONMENT_NAME,
      publicUrl: input.publicUrl || DEFAULT_PUBLIC_URL
    });
    const capturedAt = new Date(input.capturedAt || Date.now());
    if (Number.isNaN(capturedAt.valueOf())) throw refError('INVALID_CAPTURE_TIME', 'capturedAt が不正です');

    return deepFreeze({
      type: 'Deployment',
      schemaVersion: CORE_REFERENCE_SCHEMA_VERSION,
      id: `deployment:github-actions:${repo.id}:${runId}:${runAttempt}`,
      environment,
      source: baseline.repositoryCommitRef,
      baseline,
      workflow: {
        path: String(run.path),
        runId,
        runAttempt,
        workflowId: run.workflow_id == null ? null : Number(run.workflow_id),
        htmlUrl: run.html_url || null,
        conclusion: run.conclusion || null
      },
      artifact: {
        id: artifactId,
        name: String(artifact.name || ''),
        digest: artifactDigest,
        sizeBytes: artifactSize,
        expired: false
      },
      configuration: {
        workflowBlobSha: configBlobSha,
        coreReferenceSchemaVersion: CORE_REFERENCE_SCHEMA_VERSION,
        projectSchemaVersion: PROJECT_SCHEMA_VERSION
      },
      capturedAt: capturedAt.toISOString()
    });
  }

  function sameRepositoryCommitRef(a, b) {
    return Boolean(a && b && a.type === 'RepositoryCommitRef' && b.type === 'RepositoryCommitRef' && a.id === b.id);
  }

  function sameDeployment(a, b) {
    return Boolean(a && b && a.type === 'Deployment' && b.type === 'Deployment' && a.id === b.id);
  }

  function splitRepository(fullName) {
    const value = String(fullName || '').trim();
    const m = value.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (!m) throw refError('INVALID_REPOSITORY', 'repository は owner/name 形式で指定してください');
    return { owner: m[1], repo: m[2] };
  }

  async function fetchJson(fetchImpl, url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } });
    const text = await response.text();
    if (!response.ok) throw refError('GITHUB_API_ERROR', `${response.status} ${url}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async function captureCurrentDeployment(options = {}) {
    const fetchImpl = options.fetch || (root && root.fetch ? root.fetch.bind(root) : null);
    if (!fetchImpl) throw refError('FETCH_UNAVAILABLE', 'GitHub APIを取得するfetchがありません');
    const fullName = options.repository || DEFAULT_CODE_REPOSITORY;
    const { owner, repo } = splitRepository(fullName);
    const workflowPath = options.workflowPath || DEFAULT_WORKFLOW_PATH;
    const publicUrl = options.publicUrl || DEFAULT_PUBLIC_URL;
    const repoBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    const repository = await fetchJson(fetchImpl, repoBase);
    let run;
    if (options.runId) {
      run = await fetchJson(fetchImpl, `${repoBase}/actions/runs/${assertPositiveInteger(options.runId, 'runId')}`);
    } else {
      const runs = await fetchJson(fetchImpl, `${repoBase}/actions/runs?branch=main&status=success&per_page=50`);
      run = (runs.workflow_runs || []).find(item => item.status === 'completed' && item.conclusion === 'success' && item.path === workflowPath);
      if (!run) throw refError('DEPLOYMENT_NOT_FOUND', `成功済み ${workflowPath} run が見つかりません`);
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      throw refError('DEPLOYMENT_NOT_SUCCESSFUL', 'Deployment workflow run がsuccessではありません');
    }
    if (run.path !== workflowPath) throw refError('DEPLOYMENT_WORKFLOW_MISMATCH', 'run.path が対象workflowではありません');

    const sourceSha = assertFullSha(run.head_sha, 'run.head_sha');
    const [commit, artifactList, workflowFile] = await Promise.all([
      fetchJson(fetchImpl, `${repoBase}/git/commits/${sourceSha}`),
      fetchJson(fetchImpl, `${repoBase}/actions/runs/${run.id}/artifacts`),
      fetchJson(fetchImpl, `${repoBase}/contents/${workflowPath}?ref=${sourceSha}`)
    ]);
    const artifact = (artifactList.artifacts || []).find(item => item.name === 'github-pages' && item.expired !== true && item.digest);
    if (!artifact) throw refError('DEPLOYMENT_ARTIFACT_NOT_FOUND', '有効なgithub-pages artifactが見つかりません');

    return createDeployment({
      repository,
      run,
      artifact,
      workflowFile,
      commit: { sha: commit.sha, tree: commit.tree },
      workflowPath,
      publicUrl,
      environmentName: options.environmentName || DEFAULT_ENVIRONMENT_NAME,
      capturedAt: options.capturedAt || Date.now()
    });
  }

  return deepFreeze({
    CORE_REFERENCE_SCHEMA_VERSION,
    PROJECT_SCHEMA_VERSION,
    DEFAULT_CODE_REPOSITORY,
    DEFAULT_WORKFLOW_PATH,
    DEFAULT_ENVIRONMENT_NAME,
    DEFAULT_PUBLIC_URL,
    createRepositoryCommitRef,
    createRepositoryBaseline,
    createEnvironment,
    createDeployment,
    sameRepositoryCommitRef,
    sameDeployment,
    captureCurrentDeployment
  });
});
