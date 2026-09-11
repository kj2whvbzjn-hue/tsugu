(function (root, factory) {
  let HashCore = root && root.TSUGUCoreChangeSet;
  if (typeof module === 'object' && module.exports) {
    try { if (!HashCore) HashCore = require('./core-changeset.js'); } catch {}
  }
  const api = factory(root, HashCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreTaskGovernance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, HashCore) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MIGRATION_VERSION = 'B03-1';
  const TASK_STATUSES = new Set(['PLANNED', 'ACTIVE', 'ON_HOLD', 'INTERRUPTED', 'COMPLETED', 'CANCELLED']);
  const ISSUE_STATUSES = new Set(['OPEN', 'RESOLVED', 'CLOSED']);
  const APPROVAL_DECISIONS = new Set(['APPROVED', 'REJECTED']);
  const ISSUE_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

  function domainError(code, message, detail) {
    const e = new Error(`${code}: ${message}`);
    e.code = code;
    if (detail !== undefined) e.detail = detail;
    return e;
  }
  function requireHash() {
    if (!HashCore || typeof HashCore.sha256 !== 'function' || typeof HashCore.stableStringify !== 'function') {
      throw domainError('CHANGESET_CORE_REQUIRED', 'TSUGUCoreChangeSet が必要です');
    }
    return HashCore;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
      return out;
    }
    return v;
  }
  function sha256(v) { return requireHash().sha256(typeof v === 'string' ? v : canonical(v)); }
  function assertObject(v, code, label) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw domainError(code, `${label} が必要です`);
    return v;
  }
  function assertId(v, field) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.length > 240 || /[\u0000-\u001f\u007f]/.test(s)) throw domainError('INVALID_ID', `${field} が不正です`);
    return s;
  }
  function assertText(v, field, max=4000) {
    const s = String(v == null ? '' : v).normalize('NFC');
    if (!s.trim() || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) throw domainError('INVALID_TEXT', `${field} が不正です`);
    return s;
  }
  function assertVersion(v, field='version') {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_VERSION', `${field} は1以上の整数である必要があります`);
    return n;
  }
  function assertRevision(v, field='revision') {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_REVISION', `${field} は1以上の整数である必要があります`);
    return n;
  }
  function iso(v, field='timestamp') {
    const d = new Date(v == null ? Date.now() : v);
    if (Number.isNaN(d.getTime())) throw domainError('INVALID_TIMESTAMP', `${field} が不正です`);
    return d.toISOString();
  }
  function optionalIso(v, field) { return v == null ? null : iso(v, field); }
  function assertHash(v, field) {
    const s = String(v == null ? '' : v);
    if (!/^sha256:[a-f0-9]{64}$/i.test(s)) throw domainError('INVALID_CONTENT_HASH', `${field} が不正です`);
    return s.toLowerCase();
  }

  function normalizeTargetRef(input, field='targetRef') {
    const raw = assertObject(input, 'TARGET_REF_REQUIRED', field);
    return {
      type: assertId(raw.type, `${field}.type`).toUpperCase(),
      id: assertId(raw.id, `${field}.id`),
      version: assertVersion(raw.version, `${field}.version`),
      contentHash: assertHash(raw.contentHash, `${field}.contentHash`)
    };
  }
  function targetRefContent(ref) {
    const n = normalizeTargetRef(ref);
    return { type:n.type, id:n.id, version:n.version, contentHash:n.contentHash };
  }
  function hashTargetRef(ref) { return sha256(targetRefContent(ref)); }
  function targetRefEqual(a, b) {
    const x = normalizeTargetRef(a), y = normalizeTargetRef(b);
    return x.type === y.type && x.id === y.id && x.version === y.version && x.contentHash === y.contentHash;
  }
  function normalizeActorId(v, field='actorId') { return assertId(v, field); }

  function normalizeCriterion(input, field) {
    const raw = assertObject(input, 'TASK_CRITERION_REQUIRED', field);
    return {
      id: assertId(raw.id, `${field}.id`),
      kind: assertId(raw.kind, `${field}.kind`).toUpperCase(),
      required: raw.required !== false,
      description: raw.description == null ? '' : String(raw.description).normalize('NFC')
    };
  }
  function normalizeCriteria(list, field) {
    if (!Array.isArray(list)) throw domainError('TASK_CRITERIA_REQUIRED', `${field} は配列である必要があります`);
    const out = list.map((x, i) => normalizeCriterion(x, `${field}[${i}]`));
    const seen = new Set();
    for (const c of out) {
      if (seen.has(c.id)) throw domainError('DUPLICATE_TASK_CRITERION', `${field}: ${c.id}`);
      seen.add(c.id);
    }
    return out;
  }
  function assertSeparatedCriteria(startCriteria, completionCriteria) {
    const start = new Set(startCriteria.map(x => x.id));
    const overlap = completionCriteria.find(x => start.has(x.id));
    if (overlap) throw domainError('TASK_GATE_NOT_SEPARATED', `${overlap.id} が開始条件と完了条件の両方にあります`);
  }
  function gateValue(results, id) {
    if (results instanceof Map) return results.get(id);
    if (results && typeof results === 'object') return results[id];
    return undefined;
  }
  function assertGate(criteria, results, gateName) {
    for (const c of criteria) {
      if (!c.required) continue;
      const value = String(gateValue(results, c.id) || 'UNKNOWN').toUpperCase();
      if (value !== 'PASS') throw domainError('TASK_GATE_BLOCKED', `${gateName} ${c.id}=${value}`, { gate:gateName, criterionId:c.id, result:value });
    }
  }

  function normalizeHistory(list, taskId) {
    if (!Array.isArray(list)) throw domainError('TASK_HISTORY_REQUIRED', `${taskId}.history が必要です`);
    return list.map((x, i) => {
      const raw = assertObject(x, 'TASK_HISTORY_EVENT_REQUIRED', `${taskId}.history[${i}]`);
      const seq = Number(raw.seq);
      if (!Number.isSafeInteger(seq) || seq !== i + 1) throw domainError('TASK_HISTORY_SEQUENCE_INVALID', `${taskId}.history[${i}]`);
      return {
        seq,
        action: assertId(raw.action, 'history.action').toUpperCase(),
        from: raw.from == null ? null : assertId(raw.from, 'history.from').toUpperCase(),
        to: assertId(raw.to, 'history.to').toUpperCase(),
        actorId: normalizeActorId(raw.actorId),
        at: iso(raw.at),
        reason: raw.reason == null ? '' : String(raw.reason).normalize('NFC'),
        targetHash: assertHash(raw.targetHash, 'history.targetHash')
      };
    });
  }

  function normalizeTask(input, projectId) {
    const raw = assertObject(input, 'TASK_REQUIRED', 'Task');
    if (assertId(raw.projectId, 'Task.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'Task が別Projectです');
    const status = String(raw.status || 'PLANNED').toUpperCase();
    if (!TASK_STATUSES.has(status)) throw domainError('INVALID_TASK_STATUS', status);
    const startCriteria = normalizeCriteria(raw.startCriteria || [], 'Task.startCriteria');
    const completionCriteria = normalizeCriteria(raw.completionCriteria || [], 'Task.completionCriteria');
    assertSeparatedCriteria(startCriteria, completionCriteria);
    const targetRef = normalizeTargetRef(raw.targetRef, 'Task.targetRef');
    const out = {
      type:'Task', id:assertId(raw.id, 'Task.id'), projectId, revision:assertRevision(raw.revision),
      title:assertText(raw.title, 'Task.title', 500), targetRef, targetHash:assertHash(raw.targetHash, 'Task.targetHash'),
      requirementSnapshotRef: raw.requirementSnapshotRef == null ? null : normalizeTargetRef(raw.requirementSnapshotRef, 'Task.requirementSnapshotRef'),
      startCriteria, completionCriteria, status,
      createdBy:normalizeActorId(raw.createdBy, 'Task.createdBy'), createdAt:iso(raw.createdAt, 'Task.createdAt'),
      startedBy:raw.startedBy == null ? null : normalizeActorId(raw.startedBy, 'Task.startedBy'), startedAt:optionalIso(raw.startedAt, 'Task.startedAt'),
      completedBy:raw.completedBy == null ? null : normalizeActorId(raw.completedBy, 'Task.completedBy'), completedAt:optionalIso(raw.completedAt, 'Task.completedAt'),
      cancelledBy:raw.cancelledBy == null ? null : normalizeActorId(raw.cancelledBy, 'Task.cancelledBy'), cancelledAt:optionalIso(raw.cancelledAt, 'Task.cancelledAt'),
      history:normalizeHistory(raw.history || [], raw.id || '<task>')
    };
    const expectedTargetHash = hashTargetRef(targetRef);
    if (out.targetHash !== expectedTargetHash) throw domainError('TASK_TARGET_HASH_MISMATCH', out.id);
    if (status === 'PLANNED' && (out.startedAt || out.completedAt || out.cancelledAt)) throw domainError('TASK_STATUS_METADATA_MISMATCH', `${out.id}: PLANNED`);
    if (['ACTIVE','ON_HOLD','INTERRUPTED','COMPLETED'].includes(status) && (!out.startedAt || !out.startedBy)) throw domainError('TASK_START_METADATA_REQUIRED', out.id);
    if (status === 'COMPLETED' && (!out.completedAt || !out.completedBy)) throw domainError('TASK_COMPLETION_METADATA_REQUIRED', out.id);
    if (status === 'CANCELLED' && (!out.cancelledAt || !out.cancelledBy)) throw domainError('TASK_CANCEL_METADATA_REQUIRED', out.id);
    if (out.history.length) {
      const last = out.history[out.history.length - 1];
      if (last.to !== status) throw domainError('TASK_HISTORY_STATUS_MISMATCH', out.id);
      if (last.targetHash !== out.targetHash) throw domainError('TASK_HISTORY_TARGET_MISMATCH', out.id);
    }
    return out;
  }

  function createState(projectId) {
    return { schemaVersion:SCHEMA_VERSION, migrationVersion:MIGRATION_VERSION, projectId:assertId(projectId, 'projectId'), tasks:[], approvals:[], waivers:[], decisions:[], issues:[] };
  }
  function normalizeStateEnvelope(input) {
    const raw = assertObject(input, 'GOVERNANCE_STATE_REQUIRED', 'TaskGovernanceState');
    const projectId = assertId(raw.projectId, 'projectId');
    if (Number(raw.schemaVersion) !== SCHEMA_VERSION) throw domainError('UNSUPPORTED_SCHEMA_VERSION', raw.schemaVersion);
    return { raw, projectId };
  }
  function ensureUnique(list, label) {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) throw domainError('DUPLICATE_ENTITY_ID', `${label}: ${x.id}`);
      seen.add(x.id);
    }
  }

  function createTask(state, input, actorId, at) {
    const s = validateState(state);
    const now = iso(at);
    const actor = normalizeActorId(actorId);
    const targetRef = normalizeTargetRef(input.targetRef, 'Task.targetRef');
    const startCriteria = normalizeCriteria(input.startCriteria || [], 'Task.startCriteria');
    const completionCriteria = normalizeCriteria(input.completionCriteria || [], 'Task.completionCriteria');
    assertSeparatedCriteria(startCriteria, completionCriteria);
    const task = {
      type:'Task', id:assertId(input.id, 'Task.id'), projectId:s.projectId, revision:1,
      title:assertText(input.title, 'Task.title', 500), targetRef, targetHash:hashTargetRef(targetRef),
      requirementSnapshotRef:input.requirementSnapshotRef == null ? null : normalizeTargetRef(input.requirementSnapshotRef, 'Task.requirementSnapshotRef'),
      startCriteria, completionCriteria, status:'PLANNED', createdBy:actor, createdAt:now,
      startedBy:null, startedAt:null, completedBy:null, completedAt:null, cancelledBy:null, cancelledAt:null, history:[]
    };
    if (s.tasks.some(x => x.id === task.id)) throw domainError('DUPLICATE_ENTITY_ID', `Task: ${task.id}`);
    s.tasks.push(task);
    return s;
  }
  function taskById(state, id) {
    const task = state.tasks.find(x => x.id === id);
    if (!task) throw domainError('TASK_NOT_FOUND', id);
    return task;
  }
  function appendTaskHistory(task, action, from, to, actorId, at, reason) {
    task.history.push({ seq:task.history.length + 1, action, from, to, actorId, at, reason:reason || '', targetHash:task.targetHash });
    task.status = to;
    task.revision += 1;
  }
  function transitionTask(state, taskId, action, actorId, options={}) {
    const s = validateState(state);
    const task = taskById(s, assertId(taskId, 'taskId'));
    const actor = normalizeActorId(actorId);
    const at = iso(options.at);
    const act = String(action || '').toUpperCase();
    const from = task.status;
    if (from === 'COMPLETED' || from === 'CANCELLED') throw domainError('TASK_TERMINAL', `${task.id}: ${from}`);

    if (act === 'START') {
      if (from !== 'PLANNED') throw domainError('INVALID_TASK_TRANSITION', `${from} -> START`);
      assertGate(task.startCriteria, options.gateResults, 'START');
      task.startedBy = actor; task.startedAt = at;
      appendTaskHistory(task, 'START', from, 'ACTIVE', actor, at, options.reason);
    } else if (act === 'HOLD') {
      if (from !== 'ACTIVE') throw domainError('INVALID_TASK_TRANSITION', `${from} -> HOLD`);
      appendTaskHistory(task, 'HOLD', from, 'ON_HOLD', actor, at, assertText(options.reason, 'hold.reason', 2000));
    } else if (act === 'INTERRUPT') {
      if (!['ACTIVE','ON_HOLD'].includes(from)) throw domainError('INVALID_TASK_TRANSITION', `${from} -> INTERRUPT`);
      appendTaskHistory(task, 'INTERRUPT', from, 'INTERRUPTED', actor, at, assertText(options.reason, 'interrupt.reason', 2000));
    } else if (act === 'RESUME') {
      if (!['ON_HOLD','INTERRUPTED'].includes(from)) throw domainError('INVALID_TASK_TRANSITION', `${from} -> RESUME`);
      appendTaskHistory(task, 'RESUME', from, 'ACTIVE', actor, at, options.reason == null ? '' : String(options.reason));
    } else if (act === 'COMPLETE') {
      if (from !== 'ACTIVE') throw domainError('INVALID_TASK_TRANSITION', `${from} -> COMPLETE`);
      assertGate(task.completionCriteria, options.gateResults, 'COMPLETE');
      task.completedBy = actor; task.completedAt = at;
      appendTaskHistory(task, 'COMPLETE', from, 'COMPLETED', actor, at, options.reason);
    } else if (act === 'CANCEL') {
      if (!['PLANNED','ACTIVE','ON_HOLD','INTERRUPTED'].includes(from)) throw domainError('INVALID_TASK_TRANSITION', `${from} -> CANCEL`);
      task.cancelledBy = actor; task.cancelledAt = at;
      appendTaskHistory(task, 'CANCEL', from, 'CANCELLED', actor, at, assertText(options.reason, 'cancel.reason', 2000));
    } else {
      throw domainError('UNSUPPORTED_TASK_ACTION', act || '<empty>');
    }
    return validateState(s);
  }
  function startTask(s,id,a,o) { return transitionTask(s,id,'START',a,o); }
  function holdTask(s,id,a,o) { return transitionTask(s,id,'HOLD',a,o); }
  function interruptTask(s,id,a,o) { return transitionTask(s,id,'INTERRUPT',a,o); }
  function resumeTask(s,id,a,o) { return transitionTask(s,id,'RESUME',a,o); }
  function completeTask(s,id,a,o) { return transitionTask(s,id,'COMPLETE',a,o); }
  function cancelTask(s,id,a,o) { return transitionTask(s,id,'CANCEL',a,o); }

  function approvalContent(x) {
    return { id:x.id, projectId:x.projectId, targetRef:x.targetRef, targetHash:x.targetHash, decision:x.decision, actorId:x.actorId, decidedAt:x.decidedAt, rationale:x.rationale };
  }
  function normalizeApproval(input, projectId) {
    const raw = assertObject(input, 'APPROVAL_REQUIRED', 'Approval');
    if (assertId(raw.projectId, 'Approval.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'Approval が別Projectです');
    const targetRef = normalizeTargetRef(raw.targetRef, 'Approval.targetRef');
    const decision = String(raw.decision || '').toUpperCase();
    if (!APPROVAL_DECISIONS.has(decision)) throw domainError('INVALID_APPROVAL_DECISION', decision);
    const out = { type:'Approval', id:assertId(raw.id,'Approval.id'), projectId, targetRef, targetHash:assertHash(raw.targetHash,'Approval.targetHash'), decision, actorId:normalizeActorId(raw.actorId), decidedAt:iso(raw.decidedAt), rationale:assertText(raw.rationale,'Approval.rationale',4000), contentHash:assertHash(raw.contentHash,'Approval.contentHash') };
    if (out.targetHash !== hashTargetRef(targetRef)) throw domainError('APPROVAL_TARGET_HASH_MISMATCH', out.id);
    if (out.contentHash !== sha256(approvalContent(out))) throw domainError('APPROVAL_CONTENT_HASH_MISMATCH', out.id);
    return out;
  }
  function createApproval(state, input, actorId, at) {
    const s = validateState(state);
    const targetRef = normalizeTargetRef(input.targetRef, 'Approval.targetRef');
    const out = { type:'Approval', id:assertId(input.id,'Approval.id'), projectId:s.projectId, targetRef, targetHash:hashTargetRef(targetRef), decision:String(input.decision||'').toUpperCase(), actorId:normalizeActorId(actorId), decidedAt:iso(at), rationale:assertText(input.rationale,'Approval.rationale',4000), contentHash:null };
    if (!APPROVAL_DECISIONS.has(out.decision)) throw domainError('INVALID_APPROVAL_DECISION', out.decision);
    out.contentHash = sha256(approvalContent(out));
    if (s.approvals.some(x => x.id === out.id)) throw domainError('DUPLICATE_ENTITY_ID', `Approval: ${out.id}`);
    s.approvals.push(out);
    return validateState(s);
  }

  function waiverContent(x) {
    return { id:x.id, projectId:x.projectId, ruleRef:x.ruleRef, targetRef:x.targetRef, targetHash:x.targetHash, actorId:x.actorId, issuedAt:x.issuedAt, expiresAt:x.expiresAt, reason:x.reason };
  }
  function normalizeRuleRef(input) {
    const raw = assertObject(input, 'RULE_REF_REQUIRED', 'Waiver.ruleRef');
    return { id:assertId(raw.id,'Waiver.ruleRef.id'), version:assertVersion(raw.version,'Waiver.ruleRef.version'), contentHash:assertHash(raw.contentHash,'Waiver.ruleRef.contentHash') };
  }
  function normalizeWaiver(input, projectId) {
    const raw = assertObject(input, 'WAIVER_REQUIRED', 'Waiver');
    if (assertId(raw.projectId,'Waiver.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','Waiver が別Projectです');
    const targetRef = normalizeTargetRef(raw.targetRef,'Waiver.targetRef');
    const out = { type:'Waiver', id:assertId(raw.id,'Waiver.id'), projectId, ruleRef:normalizeRuleRef(raw.ruleRef), targetRef, targetHash:assertHash(raw.targetHash,'Waiver.targetHash'), actorId:normalizeActorId(raw.actorId), issuedAt:iso(raw.issuedAt), expiresAt:optionalIso(raw.expiresAt,'Waiver.expiresAt'), reason:assertText(raw.reason,'Waiver.reason',4000), contentHash:assertHash(raw.contentHash,'Waiver.contentHash'), status:String(raw.status||'ACTIVE').toUpperCase(), revokedBy:raw.revokedBy==null?null:normalizeActorId(raw.revokedBy), revokedAt:optionalIso(raw.revokedAt,'Waiver.revokedAt'), revokeReason:raw.revokeReason==null?'':String(raw.revokeReason).normalize('NFC') };
    if (!['ACTIVE','REVOKED'].includes(out.status)) throw domainError('INVALID_WAIVER_STATUS', out.status);
    if (out.targetHash !== hashTargetRef(targetRef)) throw domainError('WAIVER_TARGET_HASH_MISMATCH', out.id);
    if (out.contentHash !== sha256(waiverContent(out))) throw domainError('WAIVER_CONTENT_HASH_MISMATCH', out.id);
    if (out.status === 'REVOKED' && (!out.revokedBy || !out.revokedAt || !out.revokeReason.trim())) throw domainError('WAIVER_REVOKE_METADATA_REQUIRED', out.id);
    return out;
  }
  function createWaiver(state, input, actorId, at) {
    const s = validateState(state);
    const targetRef = normalizeTargetRef(input.targetRef,'Waiver.targetRef');
    const out = { type:'Waiver', id:assertId(input.id,'Waiver.id'), projectId:s.projectId, ruleRef:normalizeRuleRef(input.ruleRef), targetRef, targetHash:hashTargetRef(targetRef), actorId:normalizeActorId(actorId), issuedAt:iso(at), expiresAt:optionalIso(input.expiresAt,'Waiver.expiresAt'), reason:assertText(input.reason,'Waiver.reason',4000), contentHash:null, status:'ACTIVE', revokedBy:null, revokedAt:null, revokeReason:'' };
    if (out.expiresAt && new Date(out.expiresAt) <= new Date(out.issuedAt)) throw domainError('WAIVER_EXPIRY_INVALID', out.id);
    out.contentHash = sha256(waiverContent(out));
    if (s.waivers.some(x => x.id === out.id)) throw domainError('DUPLICATE_ENTITY_ID', `Waiver: ${out.id}`);
    s.waivers.push(out);
    return validateState(s);
  }
  function revokeWaiver(state, waiverId, actorId, reason, at) {
    const s = validateState(state);
    const w = s.waivers.find(x => x.id === waiverId);
    if (!w) throw domainError('WAIVER_NOT_FOUND', waiverId);
    if (w.status !== 'ACTIVE') throw domainError('WAIVER_NOT_ACTIVE', waiverId);
    w.status='REVOKED'; w.revokedBy=normalizeActorId(actorId); w.revokedAt=iso(at); w.revokeReason=assertText(reason,'Waiver.revokeReason',4000);
    return validateState(s);
  }
  function isWaiverApplicable(waiver, ruleRef, targetRef, at) {
    const w = normalizeWaiver(waiver, waiver.projectId);
    if (w.status !== 'ACTIVE') return false;
    if (w.expiresAt && new Date(iso(at)) >= new Date(w.expiresAt)) return false;
    const r = normalizeRuleRef(ruleRef);
    if (w.ruleRef.id !== r.id || w.ruleRef.version !== r.version || w.ruleRef.contentHash !== r.contentHash) return false;
    return targetRefEqual(w.targetRef, targetRef);
  }

  function decisionContent(x) { return { id:x.id, projectId:x.projectId, targetRef:x.targetRef, question:x.question, selected:x.selected, rationale:x.rationale, finalizedBy:x.finalizedBy, finalizedAt:x.finalizedAt }; }
  function normalizeDecision(input, projectId) {
    const raw = assertObject(input,'DECISION_REQUIRED','Decision');
    if (assertId(raw.projectId,'Decision.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','Decision が別Projectです');
    const status=String(raw.status||'DRAFT').toUpperCase(); if (!['DRAFT','FINAL'].includes(status)) throw domainError('INVALID_DECISION_STATUS',status);
    const out={ type:'Decision', id:assertId(raw.id,'Decision.id'), projectId, revision:assertRevision(raw.revision), targetRef:normalizeTargetRef(raw.targetRef,'Decision.targetRef'), question:assertText(raw.question,'Decision.question',4000), options:(raw.options||[]).map((x,i)=>assertText(x,`Decision.options[${i}]`,1000)), status, selected:raw.selected==null?null:String(raw.selected).normalize('NFC'), rationale:raw.rationale==null?'':String(raw.rationale).normalize('NFC'), createdBy:normalizeActorId(raw.createdBy), createdAt:iso(raw.createdAt), finalizedBy:raw.finalizedBy==null?null:normalizeActorId(raw.finalizedBy), finalizedAt:optionalIso(raw.finalizedAt,'Decision.finalizedAt'), contentHash:raw.contentHash==null?null:assertHash(raw.contentHash,'Decision.contentHash') };
    if (out.options.length < 2) throw domainError('DECISION_OPTIONS_REQUIRED', out.id);
    if (status==='FINAL') {
      if (!out.selected || !out.options.includes(out.selected) || !out.rationale.trim() || !out.finalizedBy || !out.finalizedAt || !out.contentHash) throw domainError('FINAL_DECISION_METADATA_REQUIRED',out.id);
      if (out.contentHash!==sha256(decisionContent(out))) throw domainError('DECISION_CONTENT_HASH_MISMATCH',out.id);
    } else if (out.selected!=null || out.finalizedBy!=null || out.finalizedAt!=null || out.contentHash!=null) throw domainError('DRAFT_DECISION_FIXED_METADATA_NOT_ALLOWED',out.id);
    return out;
  }
  function createDecision(state,input,actorId,at){
    const s=validateState(state); const out={ type:'Decision', id:assertId(input.id,'Decision.id'), projectId:s.projectId, revision:1, targetRef:normalizeTargetRef(input.targetRef,'Decision.targetRef'), question:assertText(input.question,'Decision.question',4000), options:(input.options||[]).map((x,i)=>assertText(x,`Decision.options[${i}]`,1000)), status:'DRAFT', selected:null, rationale:'', createdBy:normalizeActorId(actorId), createdAt:iso(at), finalizedBy:null, finalizedAt:null, contentHash:null };
    if(out.options.length<2 || new Set(out.options).size!==out.options.length) throw domainError('DECISION_OPTIONS_REQUIRED',out.id);
    if(s.decisions.some(x=>x.id===out.id)) throw domainError('DUPLICATE_ENTITY_ID',`Decision: ${out.id}`); s.decisions.push(out); return validateState(s);
  }
  function finalizeDecision(state,id,selected,rationale,actorId,at){
    const s=validateState(state); const d=s.decisions.find(x=>x.id===id); if(!d) throw domainError('DECISION_NOT_FOUND',id); if(d.status!=='DRAFT') throw domainError('DECISION_ALREADY_FINAL',id); const choice=String(selected).normalize('NFC'); if(!d.options.includes(choice)) throw domainError('DECISION_OPTION_INVALID',choice); d.status='FINAL'; d.selected=choice; d.rationale=assertText(rationale,'Decision.rationale',4000); d.finalizedBy=normalizeActorId(actorId); d.finalizedAt=iso(at); d.revision+=1; d.contentHash=sha256(decisionContent(d)); return validateState(s);
  }

  function normalizeIssue(input,projectId){
    const raw=assertObject(input,'ISSUE_REQUIRED','Issue'); if(assertId(raw.projectId,'Issue.projectId')!==projectId) throw domainError('PROJECT_SCOPE_VIOLATION','Issue が別Projectです'); const status=String(raw.status||'OPEN').toUpperCase(); if(!ISSUE_STATUSES.has(status)) throw domainError('INVALID_ISSUE_STATUS',status); const severity=String(raw.severity||'MEDIUM').toUpperCase(); if(!ISSUE_SEVERITIES.has(severity)) throw domainError('INVALID_ISSUE_SEVERITY',severity); const history=Array.isArray(raw.history)?raw.history.map((x,i)=>{const e=assertObject(x,'ISSUE_HISTORY_REQUIRED',`Issue.history[${i}]`); if(Number(e.seq)!==i+1) throw domainError('ISSUE_HISTORY_SEQUENCE_INVALID',raw.id); return {seq:i+1,action:assertId(e.action,'Issue.history.action').toUpperCase(),from:e.from==null?null:assertId(e.from,'Issue.history.from').toUpperCase(),to:assertId(e.to,'Issue.history.to').toUpperCase(),actorId:normalizeActorId(e.actorId),at:iso(e.at),reason:e.reason==null?'':String(e.reason).normalize('NFC')};}):[]; const out={type:'Issue',id:assertId(raw.id,'Issue.id'),projectId,revision:assertRevision(raw.revision),targetRef:normalizeTargetRef(raw.targetRef,'Issue.targetRef'),title:assertText(raw.title,'Issue.title',500),severity,status,createdBy:normalizeActorId(raw.createdBy),createdAt:iso(raw.createdAt),history}; if(history.length&&history[history.length-1].to!==status) throw domainError('ISSUE_HISTORY_STATUS_MISMATCH',out.id); return out;
  }
  function createIssue(state,input,actorId,at){ const s=validateState(state); const out={type:'Issue',id:assertId(input.id,'Issue.id'),projectId:s.projectId,revision:1,targetRef:normalizeTargetRef(input.targetRef,'Issue.targetRef'),title:assertText(input.title,'Issue.title',500),severity:String(input.severity||'MEDIUM').toUpperCase(),status:'OPEN',createdBy:normalizeActorId(actorId),createdAt:iso(at),history:[]}; if(!ISSUE_SEVERITIES.has(out.severity)) throw domainError('INVALID_ISSUE_SEVERITY',out.severity); if(s.issues.some(x=>x.id===out.id)) throw domainError('DUPLICATE_ENTITY_ID',`Issue: ${out.id}`); s.issues.push(out); return validateState(s); }
  function transitionIssue(state,id,action,actorId,reason,at){ const s=validateState(state); const issue=s.issues.find(x=>x.id===id); if(!issue) throw domainError('ISSUE_NOT_FOUND',id); const act=String(action||'').toUpperCase(); const from=issue.status; let to; if(act==='RESOLVE'&&from==='OPEN') to='RESOLVED'; else if(act==='REOPEN'&&from==='RESOLVED') to='OPEN'; else if(act==='CLOSE'&&from==='RESOLVED') to='CLOSED'; else throw domainError('INVALID_ISSUE_TRANSITION',`${from} -> ${act}`); issue.history.push({seq:issue.history.length+1,action:act,from,to,actorId:normalizeActorId(actorId),at:iso(at),reason:assertText(reason,'Issue.reason',4000)}); issue.status=to; issue.revision+=1; return validateState(s); }

  function validateState(input) {
    const {raw, projectId}=normalizeStateEnvelope(clone(input));
    const out={ schemaVersion:SCHEMA_VERSION, migrationVersion:String(raw.migrationVersion||MIGRATION_VERSION), projectId,
      tasks:(raw.tasks||[]).map(x=>normalizeTask(x,projectId)),
      approvals:(raw.approvals||[]).map(x=>normalizeApproval(x,projectId)),
      waivers:(raw.waivers||[]).map(x=>normalizeWaiver(x,projectId)),
      decisions:(raw.decisions||[]).map(x=>normalizeDecision(x,projectId)),
      issues:(raw.issues||[]).map(x=>normalizeIssue(x,projectId)) };
    ensureUnique(out.tasks,'Task'); ensureUnique(out.approvals,'Approval'); ensureUnique(out.waivers,'Waiver'); ensureUnique(out.decisions,'Decision'); ensureUnique(out.issues,'Issue');
    return out;
  }

  return Object.freeze({
    SCHEMA_VERSION,MIGRATION_VERSION,domainError,createState,validateState,normalizeTargetRef,hashTargetRef,targetRefEqual,
    createTask,transitionTask,startTask,holdTask,interruptTask,resumeTask,completeTask,cancelTask,
    createApproval,createWaiver,revokeWaiver,isWaiverApplicable,createDecision,finalizeDecision,createIssue,transitionIssue
  });
});
