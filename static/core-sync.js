(function (root, factory) {
  let reference = root && root.TSUGUCoreReference;
  if (!reference && typeof module === 'object' && module.exports) {
    try { reference = require('./core-reference.js'); } catch {}
  }
  const api = factory(root, reference);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Reference) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DEFAULT_MAX_ATTEMPTS = 5;
  const DEFAULT_LEASE_SECONDS = 60;
  const JOB_STATUSES = new Set(['PENDING', 'LEASED', 'SUCCEEDED', 'DEAD']);
  const RECORD_STATUSES = new Set(['RECEIVED', 'PROCESSED', 'ERROR']);

  function syncError(code, message, detail) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    if (detail !== undefined) error.detail = detail;
    return error;
  }
  function requireReference() {
    if (!Reference) throw syncError('CORE_REFERENCE_REQUIRED', 'TSUGUCoreReference が必要です');
    return Reference;
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {}; for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]); return out;
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(canonical(value)); }
  function assertId(value, field) {
    const id = String(value || '').trim();
    if (!id || id.length > 250 || /[\u0000-\u001f\u007f]/.test(id)) throw syncError('INVALID_ID', `${field} が不正です`);
    return id;
  }
  function assertPositiveInt(value, field) {
    const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw syncError('INVALID_INTEGER', `${field} は正の整数である必要があります`); return n;
  }
  function assertNonNegativeInt(value, field) {
    const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw syncError('INVALID_INTEGER', `${field} は0以上の整数である必要があります`); return n;
  }
  function assertFullSha(value, field='sha') {
    const sha = String(value || '').trim().toLowerCase(); if (!/^[a-f0-9]{40}$/.test(sha)) throw syncError('INVALID_GIT_SHA', `${field} は40桁full SHAである必要があります`); return sha;
  }
  function iso(value, field='time') {
    const d = new Date(value == null ? Date.now() : value); if (Number.isNaN(d.valueOf())) throw syncError('INVALID_TIMESTAMP', `${field} が不正です`); return d.toISOString();
  }
  function epoch(value) { return new Date(value).valueOf(); }
  function normalizeRepository(repository) {
    if (!repository || typeof repository !== 'object') throw syncError('REPOSITORY_REQUIRED', 'repository metadata が必要です');
    const id = assertPositiveInt(repository.id, 'repository.id');
    const fullName = String(repository.full_name || repository.fullName || '').trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) throw syncError('INVALID_REPOSITORY', 'repository.fullName は owner/name 形式である必要があります');
    return { id, fullName };
  }
  function normalizeCommitRef(ref) {
    if (!ref || ref.type !== 'RepositoryCommitRef') throw syncError('COMMIT_REF_REQUIRED', 'RepositoryCommitRef が必要です');
    const repo = normalizeRepository(ref.repository);
    const commitSha = assertFullSha(ref.commitSha, 'commitRef.commitSha');
    return requireReference().createRepositoryCommitRef({ id: repo.id, full_name: repo.fullName }, commitSha);
  }

  function createSyncAggregate(options = {}) {
    return validateSyncAggregate({
      type: 'GitHubSyncAggregate', schemaVersion: SCHEMA_VERSION,
      projectId: assertId(options.projectId, 'projectId'), revision: options.revision == null ? 1 : options.revision,
      integrations: [], jobs: [], lastRefresh: null
    });
  }
  function validateSyncAggregate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw syncError('SYNC_AGGREGATE_REQUIRED', 'GitHubSyncAggregate が必要です');
    if (input.type !== 'GitHubSyncAggregate' || Number(input.schemaVersion) !== SCHEMA_VERSION) throw syncError('UNSUPPORTED_SYNC_SCHEMA', 'GitHubSyncAggregate schemaが不正です');
    const projectId = assertId(input.projectId, 'projectId');
    const revision = assertPositiveInt(input.revision, 'revision');
    const integrations = (input.integrations || []).map(raw => {
      const commitRef = normalizeCommitRef(raw.commitRef);
      const status = String(raw.status || '').toUpperCase(); if (!RECORD_STATUSES.has(status)) throw syncError('INVALID_INTEGRATION_STATUS', status);
      const branch = assertId(raw.branch, 'IntegrationRecord.branch');
      const id = assertId(raw.id, 'IntegrationRecord.id');
      const expectedId = `integration:github:${commitRef.repository.id}:${commitRef.commitSha}`;
      if (id !== expectedId) throw syncError('INTEGRATION_ID_MISMATCH', `${id} != ${expectedId}`);
      return {
        type:'IntegrationRecord', id, projectId, repositoryId:commitRef.repository.id, branch, commitRef,
        status, receivedAt:iso(raw.receivedAt, 'receivedAt'), processedAt:raw.processedAt == null ? null : iso(raw.processedAt, 'processedAt'),
        lastError:raw.lastError == null ? null : String(raw.lastError).slice(0,1000)
      };
    });
    const integrationIds = new Set(); for (const item of integrations) { if (integrationIds.has(item.id)) throw syncError('DUPLICATE_INTEGRATION', item.id); integrationIds.add(item.id); }
    const jobs = (input.jobs || []).map(raw => {
      const status = String(raw.status || '').toUpperCase(); if (!JOB_STATUSES.has(status)) throw syncError('INVALID_SYNC_JOB_STATUS', status);
      const integrationRecordId = assertId(raw.integrationRecordId, 'SyncJob.integrationRecordId'); if (!integrationIds.has(integrationRecordId)) throw syncError('SYNC_JOB_INTEGRATION_NOT_FOUND', integrationRecordId);
      const attempts = assertNonNegativeInt(raw.attempts == null ? 0 : raw.attempts, 'SyncJob.attempts');
      const maxAttempts = assertPositiveInt(raw.maxAttempts == null ? DEFAULT_MAX_ATTEMPTS : raw.maxAttempts, 'SyncJob.maxAttempts');
      if (attempts > maxAttempts) throw syncError('INVALID_SYNC_ATTEMPTS', 'attemptsがmaxAttemptsを超えています');
      const leaseOwner = raw.leaseOwner == null ? null : assertId(raw.leaseOwner, 'SyncJob.leaseOwner');
      const leaseExpiresAt = raw.leaseExpiresAt == null ? null : iso(raw.leaseExpiresAt, 'leaseExpiresAt');
      if (status === 'LEASED' && (!leaseOwner || !leaseExpiresAt)) throw syncError('INVALID_SYNC_LEASE', 'LEASEDにはowner/expiresAtが必要です');
      if (status !== 'LEASED' && (leaseOwner || leaseExpiresAt)) throw syncError('INVALID_SYNC_LEASE', 'LEASED以外にleaseを保持できません');
      return {
        type:'SyncJob', id:assertId(raw.id, 'SyncJob.id'), projectId, integrationRecordId, status, attempts, maxAttempts,
        leaseOwner, leaseExpiresAt, nextAttemptAt:raw.nextAttemptAt == null ? null : iso(raw.nextAttemptAt, 'nextAttemptAt'),
        lastError:raw.lastError == null ? null : String(raw.lastError).slice(0,1000),
        createdAt:iso(raw.createdAt, 'createdAt'), updatedAt:iso(raw.updatedAt, 'updatedAt')
      };
    });
    const jobIds = new Set(); const jobIntegrationIds = new Set();
    for (const job of jobs) {
      if (jobIds.has(job.id)) throw syncError('DUPLICATE_SYNC_JOB', job.id); jobIds.add(job.id);
      if (jobIntegrationIds.has(job.integrationRecordId)) throw syncError('DUPLICATE_SYNC_JOB_FOR_INTEGRATION', job.integrationRecordId); jobIntegrationIds.add(job.integrationRecordId);
    }
    const lastRefresh = input.lastRefresh == null ? null : {
      repositoryId:assertPositiveInt(input.lastRefresh.repositoryId, 'lastRefresh.repositoryId'), branch:assertId(input.lastRefresh.branch, 'lastRefresh.branch'),
      commitSha:assertFullSha(input.lastRefresh.commitSha, 'lastRefresh.commitSha'), at:iso(input.lastRefresh.at, 'lastRefresh.at')
    };
    return deepFreeze({ type:'GitHubSyncAggregate', schemaVersion:SCHEMA_VERSION, projectId, revision, integrations, jobs, lastRefresh });
  }
  function mutate(state, fn) {
    const draft = clone(validateSyncAggregate(state)); fn(draft); draft.revision += 1; return validateSyncAggregate(draft);
  }
  function receiveCommit(state, repository, commitSha, branch, options={}) {
    const validated = validateSyncAggregate(state), repo = normalizeRepository(repository), sha = assertFullSha(commitSha, 'commitSha');
    const commitRef = requireReference().createRepositoryCommitRef({ id:repo.id, full_name:repo.fullName }, sha);
    const integrationId = `integration:github:${repo.id}:${sha}`;
    const existing = validated.integrations.find(x => x.id === integrationId);
    const refreshAt = iso(options.now, 'now');
    if (existing) {
      if (existing.branch !== String(branch)) {
        // Same Git fact may be observed through another branch; identity remains repository+SHA.
      }
      const refreshed = mutate(validated, draft => { draft.lastRefresh = { repositoryId:repo.id, branch:assertId(branch,'branch'), commitSha:sha, at:refreshAt }; });
      return deepFreeze({ status:'DEDUPED', aggregate:refreshed, integrationRecord:refreshed.integrations.find(x => x.id === integrationId), syncJob:refreshed.jobs.find(x => x.integrationRecordId === integrationId) });
    }
    const receivedAt = refreshAt;
    const next = mutate(validated, draft => {
      draft.integrations.push({ type:'IntegrationRecord', id:integrationId, projectId:draft.projectId, repositoryId:repo.id, branch:assertId(branch,'branch'), commitRef, status:'RECEIVED', receivedAt, processedAt:null, lastError:null });
      draft.jobs.push({ type:'SyncJob', id:`sync-job:${integrationId}`, projectId:draft.projectId, integrationRecordId:integrationId, status:'PENDING', attempts:0, maxAttempts:options.maxAttempts == null ? DEFAULT_MAX_ATTEMPTS : options.maxAttempts, leaseOwner:null, leaseExpiresAt:null, nextAttemptAt:null, lastError:null, createdAt:receivedAt, updatedAt:receivedAt });
      draft.lastRefresh = { repositoryId:repo.id, branch:assertId(branch,'branch'), commitSha:sha, at:refreshAt };
    });
    return deepFreeze({ status:'RECEIVED', aggregate:next, integrationRecord:next.integrations.find(x => x.id === integrationId), syncJob:next.jobs.find(x => x.integrationRecordId === integrationId) });
  }

  function eligibleJob(job, nowMs) {
    if (job.status === 'PENDING') return job.nextAttemptAt == null || epoch(job.nextAttemptAt) <= nowMs;
    if (job.status === 'LEASED') return epoch(job.leaseExpiresAt) <= nowMs;
    return false;
  }
  function claimNextJob(state, options={}) {
    const validated = validateSyncAggregate(state), workerId = assertId(options.workerId, 'workerId'), now = iso(options.now, 'now'), nowMs = epoch(now);
    const target = validated.jobs.find(job => eligibleJob(job, nowMs));
    if (!target) return deepFreeze({ status:'EMPTY', aggregate:validated, job:null });
    if (target.attempts >= target.maxAttempts) {
      const dead = mutate(validated, draft => {
        const job = draft.jobs.find(x => x.id === target.id); job.status='DEAD'; job.leaseOwner=null; job.leaseExpiresAt=null; job.updatedAt=now;
        const record = draft.integrations.find(x => x.id === job.integrationRecordId); record.status='ERROR'; record.lastError=job.lastError || 'MAX_ATTEMPTS_EXCEEDED';
      });
      return deepFreeze({ status:'DEAD', aggregate:dead, job:dead.jobs.find(x => x.id === target.id) });
    }
    const leaseSeconds = assertPositiveInt(options.leaseSeconds == null ? DEFAULT_LEASE_SECONDS : options.leaseSeconds, 'leaseSeconds');
    const expires = new Date(nowMs + leaseSeconds * 1000).toISOString();
    const next = mutate(validated, draft => {
      const job = draft.jobs.find(x => x.id === target.id); job.status='LEASED'; job.attempts += 1; job.leaseOwner=workerId; job.leaseExpiresAt=expires; job.nextAttemptAt=null; job.updatedAt=now;
    });
    return deepFreeze({ status:'LEASED', aggregate:next, job:next.jobs.find(x => x.id === target.id) });
  }
  function assertOwnedLease(state, jobId, workerId, now) {
    const job = state.jobs.find(x => x.id === assertId(jobId,'jobId')); if (!job) throw syncError('SYNC_JOB_NOT_FOUND', jobId);
    if (job.status !== 'LEASED' || job.leaseOwner !== assertId(workerId,'workerId')) throw syncError('SYNC_LEASE_NOT_OWNED', jobId);
    if (epoch(job.leaseExpiresAt) <= epoch(now)) throw syncError('SYNC_LEASE_EXPIRED', jobId);
    return job;
  }
  function completeJob(state, jobId, options={}) {
    const validated = validateSyncAggregate(state), at = iso(options.now,'now'), owned = assertOwnedLease(validated, jobId, options.workerId, at);
    const next = mutate(validated, draft => {
      const job = draft.jobs.find(x => x.id === owned.id); job.status='SUCCEEDED'; job.leaseOwner=null; job.leaseExpiresAt=null; job.nextAttemptAt=null; job.lastError=null; job.updatedAt=at;
      const record = draft.integrations.find(x => x.id === job.integrationRecordId); record.status='PROCESSED'; record.processedAt=at; record.lastError=null;
    });
    return deepFreeze({ status:'SUCCEEDED', aggregate:next, job:next.jobs.find(x => x.id === owned.id) });
  }
  function failJob(state, jobId, error, options={}) {
    const validated = validateSyncAggregate(state), at = iso(options.now,'now'), owned = assertOwnedLease(validated, jobId, options.workerId, at);
    const retrySeconds = assertPositiveInt(options.retrySeconds == null ? 30 : options.retrySeconds, 'retrySeconds');
    const message = String(error && (error.code || error.message) || error || 'SYNC_FAILED').slice(0,1000);
    const next = mutate(validated, draft => {
      const job = draft.jobs.find(x => x.id === owned.id); job.leaseOwner=null; job.leaseExpiresAt=null; job.lastError=message; job.updatedAt=at;
      const record = draft.integrations.find(x => x.id === job.integrationRecordId); record.lastError=message;
      if (job.attempts >= job.maxAttempts) { job.status='DEAD'; job.nextAttemptAt=null; record.status='ERROR'; }
      else { job.status='PENDING'; job.nextAttemptAt=new Date(epoch(at)+retrySeconds*1000).toISOString(); record.status='RECEIVED'; }
    });
    const job = next.jobs.find(x => x.id === owned.id);
    return deepFreeze({ status:job.status, aggregate:next, job });
  }
  function statusSummary(state, now=Date.now()) {
    const validated = validateSyncAggregate(state), nowMs = epoch(iso(now));
    const summary = { revision:validated.revision, received:0, processed:0, errors:0, pending:0, leased:0, retryReady:0, dead:0, latestCommitSha:validated.lastRefresh && validated.lastRefresh.commitSha || null };
    for (const record of validated.integrations) { if (record.status==='RECEIVED') summary.received++; else if (record.status==='PROCESSED') summary.processed++; else summary.errors++; }
    for (const job of validated.jobs) {
      if (job.status==='PENDING') { summary.pending++; if (job.nextAttemptAt==null || epoch(job.nextAttemptAt)<=nowMs) summary.retryReady++; }
      else if (job.status==='LEASED') summary.leased++; else if (job.status==='DEAD') summary.dead++;
    }
    return deepFreeze(summary);
  }

  function base64Encode(text) { return typeof Buffer !== 'undefined' ? Buffer.from(text,'utf8').toString('base64') : btoa(unescape(encodeURIComponent(text))); }
  function base64Decode(text) { return typeof Buffer !== 'undefined' ? Buffer.from(String(text).replace(/\n/g,''),'base64').toString('utf8') : decodeURIComponent(escape(atob(String(text).replace(/\n/g,'')))); }
  async function githubJson(fetchImpl, url, options={}) {
    const r = await fetchImpl(url, options), text = await r.text(); let body=null; try { body=text?JSON.parse(text):null; } catch { body={message:text}; } return { response:r, body };
  }
  function authHeaders(options={}) {
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})}; if(options.token) headers.Authorization=`Bearer ${options.token}`; return headers;
  }
  async function refreshAndPersist(options={}) {
    const fetchImpl=options.fetch||(root&&root.fetch); if(typeof fetchImpl!=='function') throw syncError('FETCH_REQUIRED','fetch実装が必要です');
    const repositoryFullName=assertId(options.repository,'repository'); const m=repositoryFullName.match(/^([^/\s]+)\/([^/\s]+)$/); if(!m) throw syncError('INVALID_REPOSITORY','owner/name形式が必要です');
    const owner=m[1], repo=m[2], branch=assertId(options.observedBranch||'main','observedBranch'), ledgerBranch=assertId(options.ledgerBranch||branch,'ledgerBranch'), projectId=assertId(options.projectId,'projectId');
    const path=String(options.path||'data/core/github-sync.json').replace(/^\/+/, ''); const headers=authHeaders(options), base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const [repository, branchData] = await Promise.all([
      githubJson(fetchImpl, base, {headers}), githubJson(fetchImpl, `${base}/branches/${encodeURIComponent(branch)}`, {headers})
    ]);
    if(!repository.response.ok) throw syncError('GITHUB_REPOSITORY_READ_FAILED',`${repository.response.status}`,repository.body);
    if(!branchData.response.ok) throw syncError('GITHUB_BRANCH_READ_FAILED',`${branchData.response.status}`,branchData.body);
    const commitSha=assertFullSha(branchData.body.commit && branchData.body.commit.sha,'branch.commit.sha');
    const contentUrl=`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, readUrl=`${contentUrl}?ref=${encodeURIComponent(ledgerBranch)}`;
    const current=await githubJson(fetchImpl,readUrl,{headers});
    let aggregate, blobSha=null;
    if(current.response.status===404) aggregate=createSyncAggregate({projectId});
    else if(current.response.ok) { blobSha=current.body.sha; try{ aggregate=validateSyncAggregate(JSON.parse(base64Decode(current.body.content))); }catch(e){throw syncError('INVALID_SYNC_LEDGER',e.message);} }
    else throw syncError('GITHUB_SYNC_LEDGER_READ_FAILED',`${current.response.status}`,current.body);
    if(aggregate.projectId!==projectId) throw syncError('PROJECT_SCOPE_VIOLATION','sync ledger Projectが一致しません');
    const received=receiveCommit(aggregate,repository.body,commitSha,branch,{now:options.now,maxAttempts:options.maxAttempts});
    const changed = received.aggregate.revision !== aggregate.revision;
    if(!changed) return deepFreeze({status:received.status,commitRef:received.integrationRecord.commitRef,aggregate:received.aggregate,blobSha,commitSha:null});
    const payload={message:options.message||`Refresh GitHub sync ${branch}@${commitSha.slice(0,12)}`,content:base64Encode(stableStringify(received.aggregate)),branch:ledgerBranch}; if(blobSha)payload.sha=blobSha;
    const write=await githubJson(fetchImpl,contentUrl,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!write.response.ok){if(write.response.status===409||write.response.status===422)throw syncError('STALE_SYNC_LEDGER','sync ledger CAS競合。再refreshが必要です',write.body);throw syncError('GITHUB_SYNC_LEDGER_WRITE_FAILED',`${write.response.status}`,write.body);}
    const readback=await githubJson(fetchImpl,readUrl,{headers}); if(!readback.response.ok)throw syncError('GITHUB_SYNC_LEDGER_READBACK_FAILED',`${readback.response.status}`,readback.body);
    const stored=validateSyncAggregate(JSON.parse(base64Decode(readback.body.content))); if(!stored.integrations.some(x=>x.id===received.integrationRecord.id))throw syncError('SYNC_READBACK_MISMATCH','IntegrationRecordがreadbackにありません');
    return deepFreeze({status:received.status,commitRef:received.integrationRecord.commitRef,aggregate:stored,blobSha:readback.body.sha,commitSha:write.body&&write.body.commit&&write.body.commit.sha||null});
  }

  return deepFreeze({ SCHEMA_VERSION, DEFAULT_MAX_ATTEMPTS, DEFAULT_LEASE_SECONDS, createSyncAggregate, validateSyncAggregate, receiveCommit, claimNextJob, completeJob, failJob, statusSummary, stableStringify, refreshAndPersist });
});
