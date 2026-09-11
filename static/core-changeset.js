(function (root, factory) {
  let architecture = root && root.TSUGUCoreArchitecture;
  if (!architecture && typeof module === 'object' && module.exports) {
    try { architecture = require('./core-architecture.js'); } catch {}
  }
  const api = factory(root, architecture);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreChangeSet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Architecture) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const AGGREGATE_SCHEMA_VERSION = 1;
  const PUBLIC_APPLY_ENABLED = true;
  const OP_TYPES = new Set(['ADD_NODE','RENAME_NODE','MOVE_NODE','ADD_PATH','RENAME_PATH','MOVE_PATH','ADD_BINDING','DEACTIVATE_BINDING']);
  const PRECONDITION_TYPES = new Set(['ENTITY_REVISION','REPOSITORY_SCOPE']);

  function domainError(code, message, detail) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    if (detail !== undefined) error.detail = detail;
    return error;
  }
  function requireArchitecture() {
    if (!Architecture) throw domainError('ARCHITECTURE_CORE_REQUIRED', 'TSUGUCoreArchitecture が必要です');
    return Architecture;
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
  function assertObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError(code, `${label} が必要です`); return value;
  }
  function assertId(value, field) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) throw domainError('INVALID_ID', `${field} が不正です`); return id;
  }
  function assertRevision(value, field) {
    const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_REVISION', `${field} は1以上の整数である必要があります`); return n;
  }
  function assertBlobSha(value, field='baseBlobSha') {
    const sha = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw domainError('INVALID_BLOB_SHA', `${field} は40桁Git blob SHAである必要があります`); return sha;
  }
  function assertIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) throw domainError('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey が不正です'); return key;
  }
  function nowIso(now) {
    const raw = now == null ? new Date() : new Date(now); if (Number.isNaN(raw.getTime())) throw domainError('INVALID_TIMESTAMP', '時刻が不正です'); return raw.toISOString();
  }

  function sha256Hex(input) {
    const text = unescape(encodeURIComponent(String(input)));
    const maxWord = Math.pow(2, 32), words = [], k = [];
    let hash = [];
    let primeCounter = 0, candidate = 2;
    while (primeCounter < 64) {
      let isPrime = true;
      for (let factor = 2; factor * factor <= candidate; factor++) if (candidate % factor === 0) { isPrime = false; break; }
      if (isPrime) {
        if (primeCounter < 8) hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter] = (Math.pow(candidate, 1/3) * maxWord) | 0; primeCounter++;
      }
      candidate++;
    }
    const asciiBitLength = text.length * 8;
    let ascii = text + '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i); if (j >> 8) throw domainError('HASH_ENCODING_ERROR', 'hash入力をUTF-8へ変換できません');
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0; words[words.length] = asciiBitLength | 0;
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16), oldHash = hash.slice(0); hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        const temp1 = (hash[7] + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] + (w[i] = i < 16 ? w[i] : ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3)) + w[i - 16] + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10)) + w[i - 7] | 0)) | 0;
        const temp2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))) | 0;
        hash = [(temp1 + temp2) | 0].concat(hash); hash[4] = (hash[4] + temp1) | 0; hash.pop();
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    let result = '';
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) result += ((hash[i] >> (j * 8)) & 255).toString(16).padStart(2, '0');
    return result;
  }
  function sha256(value) { return `sha256:${sha256Hex(typeof value === 'string' ? value : stableStringify(value))}`; }

  function normalizeOperation(input) {
    const op = clone(assertObject(input, 'OPERATION_REQUIRED', 'operation'));
    const type = String(op.type || '').toUpperCase();
    if (!OP_TYPES.has(type)) throw domainError('UNSUPPORTED_OPERATION', `operation.type ${type || '<empty>'} は未対応です`);
    delete op.type; return deepFreeze({ type, ...op });
  }
  function normalizePrecondition(input) {
    const p = clone(assertObject(input, 'PRECONDITION_REQUIRED', 'precondition'));
    const type = String(p.type || '').toUpperCase();
    if (!PRECONDITION_TYPES.has(type)) throw domainError('UNSUPPORTED_PRECONDITION', `precondition.type ${type || '<empty>'} は未対応です`);
    if (type === 'ENTITY_REVISION') return deepFreeze({ type, entityType: String(p.entityType || '').toUpperCase(), entityId: assertId(p.entityId, 'precondition.entityId'), revision: assertRevision(p.revision, 'precondition.revision') });
    return deepFreeze({ type, repositoryId: Number(p.repositoryId) });
  }
  function payloadProjection(changeSetLike) {
    return {
      type: 'ArchitectureChangeSet', schemaVersion: SCHEMA_VERSION,
      id: changeSetLike.id, projectId: changeSetLike.projectId, idempotencyKey: changeSetLike.idempotencyKey,
      baseRevision: changeSetLike.baseRevision, baseBlobSha: changeSetLike.baseBlobSha, createdBy: changeSetLike.createdBy,
      operations: changeSetLike.operations, preconditions: changeSetLike.preconditions
    };
  }
  function createChangeSet(input) {
    const raw = assertObject(input, 'CHANGESET_REQUIRED', 'ChangeSet');
    const out = {
      type: 'ArchitectureChangeSet', schemaVersion: SCHEMA_VERSION,
      id: assertId(raw.id, 'ChangeSet.id'), projectId: assertId(raw.projectId, 'ChangeSet.projectId'),
      idempotencyKey: assertIdempotencyKey(raw.idempotencyKey), baseRevision: assertRevision(raw.baseRevision, 'ChangeSet.baseRevision'),
      baseBlobSha: assertBlobSha(raw.baseBlobSha), createdBy: assertId(raw.createdBy, 'ChangeSet.createdBy'),
      operations: (raw.operations || []).map(normalizeOperation), preconditions: (raw.preconditions || []).map(normalizePrecondition)
    };
    if (!out.operations.length) throw domainError('EMPTY_CHANGESET', 'ChangeSetには1件以上のoperationが必要です');
    out.payloadHash = sha256(payloadProjection(out));
    return deepFreeze(out);
  }
  function validateChangeSetShape(input) {
    const cs = createChangeSet(input);
    if (input.payloadHash != null && input.payloadHash !== cs.payloadHash) throw domainError('CHANGESET_PAYLOAD_HASH_MISMATCH', 'payloadHashがChangeSet内容と一致しません');
    return cs;
  }

  function validateAggregate(input) {
    const a = requireArchitecture(); const raw = clone(assertObject(input, 'AGGREGATE_REQUIRED', 'ArchitectureAggregate'));
    if (raw.type !== 'ArchitectureAggregate' || Number(raw.schemaVersion) !== AGGREGATE_SCHEMA_VERSION) throw domainError('UNSUPPORTED_AGGREGATE_SCHEMA', 'ArchitectureAggregate契約が不正です');
    const architecture = a.validateState(raw.architecture);
    const projectId = assertId(raw.projectId, 'aggregate.projectId');
    const revision = assertRevision(raw.revision, 'aggregate.revision');
    if (architecture.project.id !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'aggregateとarchitectureのProjectが一致しません');
    if (architecture.project.revision !== revision) throw domainError('AGGREGATE_REVISION_MISMATCH', 'aggregate.revisionとarchitecture.project.revisionが一致しません');
    return deepFreeze({
      type: 'ArchitectureAggregate', schemaVersion: AGGREGATE_SCHEMA_VERSION, projectId, revision,
      architecture, appliedChangeSets: Array.isArray(raw.appliedChangeSets) ? raw.appliedChangeSets : [],
      auditEvents: Array.isArray(raw.auditEvents) ? raw.auditEvents : [], outbox: Array.isArray(raw.outbox) ? raw.outbox : []
    });
  }
  function createAggregate(architectureState) {
    const a = requireArchitecture(); const architecture = a.validateState(architectureState);
    return validateAggregate({ type:'ArchitectureAggregate', schemaVersion:AGGREGATE_SCHEMA_VERSION, projectId:architecture.project.id, revision:architecture.project.revision, architecture, appliedChangeSets:[], auditEvents:[], outbox:[] });
  }

  function entityByType(state, entityType, id) {
    const type = String(entityType || '').toUpperCase();
    if (type === 'PROJECT') return state.project.id === id ? state.project : null;
    if (type === 'ARCHITECTURE_NODE' || type === 'NODE') return state.architectureNodes.find(x => x.id === id) || null;
    if (type === 'PATH_ENTRY' || type === 'PATH') return state.pathEntries.find(x => x.id === id) || null;
    if (type === 'ARCHITECTURE_BINDING' || type === 'BINDING') return state.bindings.find(x => x.id === id) || null;
    throw domainError('UNSUPPORTED_PRECONDITION_ENTITY', `entityType ${type} は未対応です`);
  }
  function assertPreconditions(architecture, preconditions) {
    for (const p of preconditions) {
      if (p.type === 'ENTITY_REVISION') {
        const entity = entityByType(architecture, p.entityType, p.entityId);
        if (!entity || entity.revision !== p.revision) throw domainError('PRECONDITION_FAILED', `${p.entityType}:${p.entityId} のrevision条件が一致しません`);
      } else if (p.type === 'REPOSITORY_SCOPE') {
        if (!Number.isSafeInteger(p.repositoryId) || p.repositoryId <= 0 || !architecture.repositoryScopes.some(x => x.repositoryId === p.repositoryId)) throw domainError('PRECONDITION_FAILED', `repositoryId ${p.repositoryId} は現在のProject範囲にありません`);
      }
    }
  }
  function targetIdsFromOperation(op) {
    const values = [];
    for (const key of ['id','nodeId','pathEntryId','bindingId','parentNodeId','parentPathEntryId','architectureNodeId']) if (op[key] != null) values.push(String(op[key]));
    return values;
  }
  function applyOperation(state, op) {
    const a = requireArchitecture();
    switch (op.type) {
      case 'ADD_NODE': return a.addArchitectureNode(state, op);
      case 'RENAME_NODE': return a.renameArchitectureNode(state, op.nodeId, op.name);
      case 'MOVE_NODE': return a.moveArchitectureNode(state, op.nodeId, op.parentNodeId == null ? null : op.parentNodeId);
      case 'ADD_PATH': return a.addPathEntry(state, op);
      case 'RENAME_PATH': return a.renamePathEntry(state, op.pathEntryId, op.name);
      case 'MOVE_PATH': return a.movePathEntry(state, op.pathEntryId, op.parentPathEntryId == null ? null : op.parentPathEntryId);
      case 'ADD_BINDING': return a.addBinding(state, op);
      case 'DEACTIVATE_BINDING': return a.deactivateBinding(state, op.bindingId, op.inactiveFromRevision);
      default: throw domainError('UNSUPPORTED_OPERATION', op.type);
    }
  }
  function validateChangeSet(aggregateInput, blobSha, changeSetInput, options={}) {
    const aggregate = validateAggregate(aggregateInput), changeSet = validateChangeSetShape(changeSetInput), currentBlobSha = assertBlobSha(blobSha, 'currentBlobSha');
    if (aggregate.projectId !== changeSet.projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'ChangeSetとaggregateのProjectが一致しません');
    if (aggregate.revision !== changeSet.baseRevision || currentBlobSha !== changeSet.baseBlobSha) throw domainError('STALE_CHANGESET', 'ChangeSetのbase revision/blob SHAが現在状態と一致しません');
    assertPreconditions(aggregate.architecture, changeSet.preconditions);
    let candidate = aggregate.architecture;
    for (const op of changeSet.operations) candidate = applyOperation(candidate, op);
    candidate = requireArchitecture().validateState(candidate);
    const targetIds = [...new Set(changeSet.operations.flatMap(targetIdsFromOperation))].sort();
    const record = {
      type:'ValidationRecord', schemaVersion:SCHEMA_VERSION,
      id: options.validationId ? assertId(options.validationId, 'validationId') : `validation:${changeSet.id}`,
      changeSetId: changeSet.id, projectId: changeSet.projectId, baseRevision: changeSet.baseRevision, baseBlobSha: changeSet.baseBlobSha,
      payloadHash: changeSet.payloadHash, candidateHash: sha256(requireArchitecture().serialize(candidate)), targetIds,
      resultRevision: candidate.project.revision, status:'PASS', issues:[], validatedAt: nowIso(options.now)
    };
    return deepFreeze({ validationRecord: record, candidate });
  }
  function validateValidationRecord(recordInput, changeSet, candidate) {
    const r = assertObject(recordInput, 'VALIDATION_RECORD_REQUIRED', 'ValidationRecord');
    if (r.type !== 'ValidationRecord' || r.status !== 'PASS') throw domainError('VALIDATION_NOT_PASS', 'PASSのValidationRecordが必要です');
    if (r.changeSetId !== changeSet.id || r.projectId !== changeSet.projectId || r.payloadHash !== changeSet.payloadHash || r.baseRevision !== changeSet.baseRevision || r.baseBlobSha !== changeSet.baseBlobSha) throw domainError('VALIDATION_RECORD_MISMATCH', 'ValidationRecordがChangeSet対象と一致しません');
    const expectedCandidate = sha256(requireArchitecture().serialize(candidate));
    if (r.candidateHash !== expectedCandidate || r.resultRevision !== candidate.project.revision) throw domainError('VALIDATION_RECORD_MISMATCH', 'ValidationRecordのcandidateが再検証結果と一致しません');
    return r;
  }

  function prepareApply(aggregateInput, currentBlobSha, changeSetInput, validationRecordInput, options={}) {
    const aggregate = validateAggregate(aggregateInput), changeSet = validateChangeSetShape(changeSetInput), blobSha = assertBlobSha(currentBlobSha, 'currentBlobSha');
    const existing = aggregate.appliedChangeSets.find(x => x.idempotencyKey === changeSet.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== changeSet.payloadHash) throw domainError('IDEMPOTENCY_KEY_REUSED', '同一idempotency keyが異なるpayloadで使用済みです');
      return deepFreeze({ status:'IDEMPOTENT_REPLAY', expectedBlobSha:blobSha, aggregate, result:{ changeSetId:existing.changeSetId, revision:existing.resultRevision, candidateHash:existing.candidateHash, idempotencyKey:existing.idempotencyKey } });
    }
    const rerun = validateChangeSet(aggregate, blobSha, changeSet, { now: options.now, validationId: validationRecordInput && validationRecordInput.id });
    validateValidationRecord(validationRecordInput, changeSet, rerun.candidate);
    const appliedAt = nowIso(options.now), actor = assertId(options.actor || changeSet.createdBy, 'actor');
    const applied = { type:'AppliedChangeSet', changeSetId:changeSet.id, idempotencyKey:changeSet.idempotencyKey, payloadHash:changeSet.payloadHash, candidateHash:rerun.validationRecord.candidateHash, baseRevision:changeSet.baseRevision, resultRevision:rerun.candidate.project.revision, actor, appliedAt };
    const audit = { type:'AuditEvent', action:'APPLY_CHANGESET', changeSetId:changeSet.id, actor, baseRevision:changeSet.baseRevision, resultRevision:rerun.candidate.project.revision, payloadHash:changeSet.payloadHash, candidateHash:rerun.validationRecord.candidateHash, at:appliedAt };
    const outbox = { type:'OutboxRecord', id:`outbox:${changeSet.id}`, eventType:'ARCHITECTURE_CHANGED', changeSetId:changeSet.id, projectId:changeSet.projectId, resultRevision:rerun.candidate.project.revision, candidateHash:rerun.validationRecord.candidateHash, status:'PENDING', createdAt:appliedAt };
    const next = validateAggregate({ type:'ArchitectureAggregate', schemaVersion:AGGREGATE_SCHEMA_VERSION, projectId:aggregate.projectId, revision:rerun.candidate.project.revision, architecture:rerun.candidate, appliedChangeSets:[...aggregate.appliedChangeSets, applied], auditEvents:[...aggregate.auditEvents, audit], outbox:[...aggregate.outbox, outbox] });
    return deepFreeze({ status:'READY', expectedBlobSha:blobSha, aggregate:next, serialized:stableStringify(next), result:{ changeSetId:changeSet.id, revision:next.revision, candidateHash:applied.candidateHash, idempotencyKey:changeSet.idempotencyKey } });
  }

  function base64EncodeUtf8(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(text)));
  }
  function base64DecodeUtf8(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(String(text).replace(/\n/g,''), 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(String(text).replace(/\n/g,''))));
  }
  async function githubJson(fetchImpl, url, options={}) {
    const response = await fetchImpl(url, options), text = await response.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = { message:text }; }
    return { response, body };
  }
  async function applyWithContentApi(options) {
    if (!PUBLIC_APPLY_ENABLED) throw domainError('CHANGESET_APPLY_DISABLED', 'ChangeSet Applyは無効です');
    const fetchImpl = options && options.fetch || (root && root.fetch);
    if (typeof fetchImpl !== 'function') throw domainError('FETCH_REQUIRED', 'fetch実装が必要です');
    const owner = assertId(options.owner, 'owner'), repo = assertId(options.repo, 'repo'), branch = assertId(options.branch, 'branch');
    const path = String(options.path || '').replace(/^\/+/, ''); if (!path) throw domainError('INVALID_PATH', '保存pathが必要です');
    const headers = { Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', ...(options.headers || {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const readUrl = `${api}?ref=${encodeURIComponent(branch)}`;
    const read = await githubJson(fetchImpl, readUrl, { headers });
    if (!read.response.ok) throw domainError('GITHUB_READ_FAILED', `GitHub read ${read.response.status}`, read.body);
    const blobSha = assertBlobSha(read.body.sha, 'GitHub content sha');
    let aggregate; try { aggregate = JSON.parse(base64DecodeUtf8(read.body.content)); } catch { throw domainError('INVALID_AGGREGATE_JSON', '保存aggregate JSONを解析できません'); }
    const prepared = prepareApply(aggregate, blobSha, options.changeSet, options.validationRecord, { actor:options.actor, now:options.now });
    if (prepared.status === 'IDEMPOTENT_REPLAY') return deepFreeze({ ...prepared.result, status:'IDEMPOTENT_REPLAY', blobSha, commitSha:null });
    const write = await githubJson(fetchImpl, api, { method:'PUT', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify({ message: options.message || `Apply ${prepared.result.changeSetId}`, content:base64EncodeUtf8(prepared.serialized), sha:prepared.expectedBlobSha, branch }) });
    if (!write.response.ok) {
      if (write.response.status === 409 || write.response.status === 422) throw domainError('STALE_CHANGESET', 'GitHub CASに失敗しました。部分変更は確定されていません', write.body);
      throw domainError('GITHUB_WRITE_FAILED', `GitHub write ${write.response.status}`, write.body);
    }
    const readback = await githubJson(fetchImpl, readUrl, { headers });
    if (!readback.response.ok) throw domainError('GITHUB_READBACK_FAILED', `GitHub readback ${readback.response.status}`, readback.body);
    const readbackAggregate = validateAggregate(JSON.parse(base64DecodeUtf8(readback.body.content)));
    const applied = readbackAggregate.appliedChangeSets.find(x => x.changeSetId === prepared.result.changeSetId && x.payloadHash === validateChangeSetShape(options.changeSet).payloadHash);
    if (!applied || readbackAggregate.revision !== prepared.result.revision) throw domainError('APPLY_READBACK_MISMATCH', 'GitHub readbackが適用結果と一致しません');
    return deepFreeze({ ...prepared.result, status:'APPLIED', blobSha:readback.body.sha, commitSha:write.body && write.body.commit && write.body.commit.sha || null });
  }

  return deepFreeze({
    SCHEMA_VERSION, AGGREGATE_SCHEMA_VERSION, PUBLIC_APPLY_ENABLED,
    OP_TYPES:Object.freeze([...OP_TYPES]), PRECONDITION_TYPES:Object.freeze([...PRECONDITION_TYPES]),
    stableStringify, sha256, createChangeSet, validateChangeSetShape, createAggregate, validateAggregate,
    validateChangeSet, prepareApply, applyWithContentApi
  });
});
