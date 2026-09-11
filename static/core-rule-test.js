(function (root, factory) {
  let Box = root && root.TSUGUCoreBox;
  let HashCore = root && root.TSUGUCoreChangeSet;
  if (typeof module === 'object' && module.exports) {
    try { if (!Box) Box = require('./core-box.js'); } catch {}
    try { if (!HashCore) HashCore = require('./core-changeset.js'); } catch {}
  }
  const api = factory(root, Box, HashCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreRuleTest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Box, HashCore) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MIGRATION_VERSION = 'B02-1';
  const WAIVER_ENABLED = false;
  const DIRECT_WRITE_ENABLED = false;
  const CONSTRAINT_TYPES = new Set(['REQUIRED', 'PROHIBITED', 'ALLOWED_SET', 'MIN', 'MAX', 'OPAQUE']);
  const RULE_TARGET_TYPES = new Set(['BOX_DEFINITION', 'BOX_INSTANCE']);
  const REQUIREMENT_SCOPES = new Set(['SELF', 'DESCENDANTS']);
  const SNAPSHOT_STATUSES = new Set(['DRAFT', 'FINAL']);

  function domainError(code, message, detail) {
    const e = new Error(`${code}: ${message}`);
    e.code = code;
    if (detail !== undefined) e.detail = detail;
    return e;
  }
  function requireBox() {
    if (!Box || typeof Box.validateState !== 'function') throw domainError('BOX_CORE_REQUIRED', 'TSUGUCoreBox が必要です');
    return Box;
  }
  function requireHash() {
    if (!HashCore || typeof HashCore.sha256 !== 'function' || typeof HashCore.stableStringify !== 'function') throw domainError('CHANGESET_CORE_REQUIRED', 'TSUGUCoreChangeSet が必要です');
    return HashCore;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function deepFreeze(v) { if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v; Object.freeze(v); for (const c of Object.values(v)) deepFreeze(c); return v; }
  function canonical(v) { if (Array.isArray(v)) return v.map(canonical); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]); return o; } return v; }
  function stableStringify(v) { return requireHash().stableStringify(canonical(v)); }
  function sha256(v) { return requireHash().sha256(typeof v === 'string' ? v : canonical(v)); }
  function assertObject(v, code, label) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw domainError(code, `${label} が必要です`); return v; }
  function assertId(v, field) { const s = String(v || '').trim(); if (!s || s.length > 240 || /[\u0000-\u001f\u007f]/.test(s)) throw domainError('INVALID_ID', `${field} が不正です`); return s; }
  function assertName(v, field) { const s = String(v == null ? '' : v).normalize('NFC'); if (!s.trim() || s.length > 255 || /[\u0000-\u001f\u007f]/.test(s)) throw domainError('INVALID_NAME', `${field} が不正です`); return s; }
  function assertVersion(v, field='version') { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_VERSION', `${field} は1以上の整数である必要があります`); return n; }
  function assertRevision(v, field='revision') { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_REVISION', `${field} は1以上の整数である必要があります`); return n; }
  function iso(v, field='timestamp') { const d = v == null ? new Date() : new Date(v); if (Number.isNaN(d.getTime())) throw domainError('INVALID_TIMESTAMP', `${field} が不正です`); return d.toISOString(); }
  function key(id, version) { return `${id}@${version}`; }
  function deterministicId(prefix, projection) { return `${prefix}:${sha256(projection).replace(/^sha256:/, '').slice(0, 32)}`; }

  function normalizeConstraint(input) {
    const raw = assertObject(input, 'RULE_CONSTRAINT_REQUIRED', 'RuleConstraint');
    const type = String(raw.type || '').toUpperCase();
    if (!CONSTRAINT_TYPES.has(type)) throw domainError('UNSUPPORTED_RULE_CONSTRAINT', type || '<empty>');
    const keyName = assertId(raw.key, 'RuleConstraint.key');
    if (type === 'REQUIRED' || type === 'PROHIBITED') return { type, key:keyName };
    if (type === 'ALLOWED_SET') {
      if (!Array.isArray(raw.values) || raw.values.length === 0) throw domainError('ALLOWED_SET_REQUIRED', `${keyName}.values が必要です`);
      const values = [...new Set(raw.values.map(v => String(v)))].sort();
      return { type, key:keyName, values };
    }
    if (type === 'MIN' || type === 'MAX') {
      const value = Number(raw.value); if (!Number.isFinite(value)) throw domainError('INVALID_RULE_BOUND', `${keyName}.${type} が不正です`);
      return { type, key:keyName, value };
    }
    const text = String(raw.text == null ? '' : raw.text).normalize('NFC');
    if (!text.trim()) throw domainError('OPAQUE_RULE_TEXT_REQUIRED', `${keyName}.text が必要です`);
    return { type:'OPAQUE', key:keyName, text };
  }
  function normalizeSupersedes(list) {
    const out = (list || []).map(x => ({ id:assertId(x.id, 'supersedes.id'), version:assertVersion(x.version, 'supersedes.version') }));
    const seen = new Set();
    for (const x of out) { const k = key(x.id,x.version); if (seen.has(k)) throw domainError('DUPLICATE_SUPERSEDES', k); seen.add(k); }
    return out.sort((a,b) => key(a.id,a.version).localeCompare(key(b.id,b.version)));
  }
  function ruleContent(def) {
    return { id:def.id, version:def.version, projectId:def.projectId, name:def.name, constraints:def.constraints, supersedes:def.supersedes };
  }
  function testContent(def) {
    return { id:def.id, version:def.version, projectId:def.projectId, name:def.name, runner:def.runner, command:def.command, evaluationConditions:def.evaluationConditions };
  }
  function normalizeRuleDefinition(input, projectId) {
    const raw = assertObject(input, 'RULE_DEFINITION_REQUIRED', 'RuleDefinition');
    if (assertId(raw.projectId, 'RuleDefinition.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'RuleDefinitionが別Projectです');
    const constraints = (raw.constraints || []).map(normalizeConstraint);
    if (!constraints.length) throw domainError('RULE_CONSTRAINT_REQUIRED', 'RuleDefinitionにはconstraintが必要です');
    const out = {
      type:'RuleDefinition', id:assertId(raw.id,'RuleDefinition.id'), version:assertVersion(raw.version), projectId,
      revision:assertRevision(raw.revision), name:assertName(raw.name,'RuleDefinition.name'), constraints,
      supersedes:normalizeSupersedes(raw.supersedes), publishedAt:raw.publishedAt == null ? null : iso(raw.publishedAt,'RuleDefinition.publishedAt'),
      contentHash:raw.contentHash == null ? null : String(raw.contentHash)
    };
    if (out.publishedAt) {
      const expected = sha256(ruleContent(out));
      if (out.contentHash !== expected) throw domainError('PUBLISHED_CONTENT_HASH_MISMATCH', `RuleDefinition ${key(out.id,out.version)} が改変されています`);
    } else if (out.contentHash != null) throw domainError('DRAFT_CONTENT_HASH_NOT_ALLOWED', 'Draft RuleDefinitionにcontentHashは設定できません');
    return out;
  }
  function normalizeRuleBinding(input, projectId) {
    const raw = assertObject(input, 'RULE_BINDING_REQUIRED', 'RuleBinding');
    if (assertId(raw.projectId,'RuleBinding.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'RuleBindingが別Projectです');
    const targetType = String(raw.targetType || '').toUpperCase();
    if (!RULE_TARGET_TYPES.has(targetType)) throw domainError('INVALID_RULE_TARGET', 'RuleBinding.targetTypeが不正です');
    const out = {
      type:'RuleBinding', id:assertId(raw.id,'RuleBinding.id'), projectId, revision:assertRevision(raw.revision),
      ruleDefinitionId:assertId(raw.ruleDefinitionId,'RuleBinding.ruleDefinitionId'), ruleDefinitionVersion:assertVersion(raw.ruleDefinitionVersion),
      targetType, boxDefinitionId:null, boxDefinitionVersion:null, boxInstanceId:null,
      inheritToChildren:raw.inheritToChildren !== false
    };
    if (targetType === 'BOX_DEFINITION') {
      out.boxDefinitionId = assertId(raw.boxDefinitionId,'RuleBinding.boxDefinitionId'); out.boxDefinitionVersion = assertVersion(raw.boxDefinitionVersion);
      if (raw.boxInstanceId != null) throw domainError('RULE_BINDING_TARGET_EXCLUSIVITY','BOX_DEFINITION BindingにboxInstanceIdを指定できません');
    } else {
      out.boxInstanceId = assertId(raw.boxInstanceId,'RuleBinding.boxInstanceId');
      if (raw.boxDefinitionId != null || raw.boxDefinitionVersion != null) throw domainError('RULE_BINDING_TARGET_EXCLUSIVITY','BOX_INSTANCE BindingにboxDefinitionを指定できません');
    }
    return out;
  }
  function normalizeTestDefinition(input, projectId) {
    const raw = assertObject(input, 'TEST_DEFINITION_REQUIRED', 'TestDefinition');
    if (assertId(raw.projectId,'TestDefinition.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','TestDefinitionが別Projectです');
    const runner = assertId(raw.runner,'TestDefinition.runner').toUpperCase();
    const command = String(raw.command == null ? '' : raw.command).normalize('NFC');
    if (!command.trim() || command.length > 4000) throw domainError('INVALID_TEST_COMMAND','TestDefinition.commandが不正です');
    const evaluationConditions = canonical(clone(raw.evaluationConditions == null ? {} : assertObject(raw.evaluationConditions,'TEST_EVALUATION_REQUIRED','TestDefinition.evaluationConditions')));
    const out = {
      type:'TestDefinition', id:assertId(raw.id,'TestDefinition.id'), version:assertVersion(raw.version), projectId,
      revision:assertRevision(raw.revision), name:assertName(raw.name,'TestDefinition.name'), runner, command, evaluationConditions,
      publishedAt:raw.publishedAt == null ? null : iso(raw.publishedAt,'TestDefinition.publishedAt'), contentHash:raw.contentHash == null ? null : String(raw.contentHash)
    };
    if (out.publishedAt) { const expected = sha256(testContent(out)); if (out.contentHash !== expected) throw domainError('PUBLISHED_CONTENT_HASH_MISMATCH', `TestDefinition ${key(out.id,out.version)} が改変されています`); }
    else if (out.contentHash != null) throw domainError('DRAFT_CONTENT_HASH_NOT_ALLOWED','Draft TestDefinitionにcontentHashは設定できません');
    return out;
  }
  function normalizeRequirementSource(input, projectId) {
    const raw = assertObject(input,'REQUIREMENT_SOURCE_REQUIRED','RequirementSource');
    if (assertId(raw.projectId,'RequirementSource.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','RequirementSourceが別Projectです');
    const scope = String(raw.scope || 'SELF').toUpperCase(); if (!REQUIREMENT_SCOPES.has(scope)) throw domainError('INVALID_REQUIREMENT_SCOPE','RequirementSource.scopeが不正です');
    return {
      type:'RequirementSource', id:assertId(raw.id,'RequirementSource.id'), projectId, revision:assertRevision(raw.revision),
      sourceBoxDefinitionId:assertId(raw.sourceBoxDefinitionId,'RequirementSource.sourceBoxDefinitionId'), sourceBoxDefinitionVersion:assertVersion(raw.sourceBoxDefinitionVersion),
      testDefinitionId:assertId(raw.testDefinitionId,'RequirementSource.testDefinitionId'), testDefinitionVersion:assertVersion(raw.testDefinitionVersion),
      scope, enabled:raw.enabled !== false
    };
  }
  function normalizeRequirement(input, projectId) {
    const raw = assertObject(input,'TEST_REQUIREMENT_REQUIRED','TestRequirement');
    if (assertId(raw.projectId,'TestRequirement.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','TestRequirementが別Projectです');
    const status = String(raw.status || 'ACTIVE').toUpperCase(); if (!['ACTIVE','RETIRED'].includes(status)) throw domainError('INVALID_REQUIREMENT_STATUS',status);
    return {
      type:'TestRequirement', id:assertId(raw.id,'TestRequirement.id'), projectId, version:assertVersion(raw.version), revision:assertRevision(raw.revision), status,
      generationKey:assertId(raw.generationKey,'TestRequirement.generationKey'), generatedHash:String(raw.generatedHash || ''),
      source:canonical(clone(assertObject(raw.source,'REQUIREMENT_SOURCE_REF_REQUIRED','TestRequirement.source'))),
      target:canonical(clone(assertObject(raw.target,'REQUIREMENT_TARGET_REQUIRED','TestRequirement.target'))),
      testDefinition:canonical(clone(assertObject(raw.testDefinition,'REQUIREMENT_TEST_REF_REQUIRED','TestRequirement.testDefinition'))),
      effectiveRules:canonical(clone(assertObject(raw.effectiveRules,'EFFECTIVE_RULES_REQUIRED','TestRequirement.effectiveRules'))),
      inheritancePaths:canonical(clone(Array.isArray(raw.inheritancePaths) ? raw.inheritancePaths : [])),
      evaluationConditions:canonical(clone(raw.evaluationConditions == null ? {} : raw.evaluationConditions))
    };
  }
  function normalizeManualEdit(input, projectId) {
    const raw = assertObject(input,'MANUAL_EDIT_REQUIRED','ManualRequirementEdit');
    if (assertId(raw.projectId,'ManualRequirementEdit.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','ManualRequirementEditが別Projectです');
    const note = String(raw.note == null ? '' : raw.note).normalize('NFC');
    const priority = raw.priority == null ? null : String(raw.priority).toUpperCase();
    const labels = [...new Set((raw.labels || []).map(v => String(v)))].sort();
    return { type:'ManualRequirementEdit', requirementId:assertId(raw.requirementId,'ManualRequirementEdit.requirementId'), projectId, revision:assertRevision(raw.revision), note, priority, labels, updatedBy:assertId(raw.updatedBy,'ManualRequirementEdit.updatedBy'), updatedAt:iso(raw.updatedAt,'ManualRequirementEdit.updatedAt') };
  }
  function snapshotContent(s) { return { id:s.id, projectId:s.projectId, targetBoxInstanceId:s.targetBoxInstanceId, requirementItems:s.requirementItems }; }
  function normalizeSnapshot(input, projectId) {
    const raw = assertObject(input,'REQUIREMENT_SNAPSHOT_REQUIRED','RequirementSnapshot');
    if (assertId(raw.projectId,'RequirementSnapshot.projectId') !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION','RequirementSnapshotが別Projectです');
    const status = String(raw.status || '').toUpperCase(); if (!SNAPSHOT_STATUSES.has(status)) throw domainError('INVALID_SNAPSHOT_STATUS',status);
    const out = {
      type:'RequirementSnapshot', id:assertId(raw.id,'RequirementSnapshot.id'), projectId, revision:assertRevision(raw.revision),
      targetBoxInstanceId:assertId(raw.targetBoxInstanceId,'RequirementSnapshot.targetBoxInstanceId'), status,
      requirementItems:canonical(clone(Array.isArray(raw.requirementItems) ? raw.requirementItems : [])),
      createdAt:iso(raw.createdAt,'RequirementSnapshot.createdAt'), finalizedAt:raw.finalizedAt == null ? null : iso(raw.finalizedAt,'RequirementSnapshot.finalizedAt'),
      contentHash:raw.contentHash == null ? null : String(raw.contentHash)
    };
    if (status === 'FINAL') {
      if (!out.finalizedAt || !out.contentHash) throw domainError('FINAL_SNAPSHOT_METADATA_REQUIRED','FINAL snapshotにはfinalizedAt/contentHashが必要です');
      const expected = sha256(snapshotContent(out)); if (expected !== out.contentHash) throw domainError('SNAPSHOT_CONTENT_HASH_MISMATCH','RequirementSnapshotが改変されています');
    } else if (out.finalizedAt != null || out.contentHash != null) throw domainError('DRAFT_SNAPSHOT_FIXED_METADATA_NOT_ALLOWED','Draft snapshotにfinalized metadataは設定できません');
    return out;
  }

  function definitionMap(list) { return new Map(list.map(x => [key(x.id,x.version), x])); }
  function boxMaps(boxRegistry) {
    const boxes = definitionMap(boxRegistry.boxDefinitions || []);
    const instances = new Map((boxRegistry.boxInstances || []).map(x => [x.id,x]));
    return { boxes, instances };
  }
  function publishedBox(boxRegistry,id,version) {
    const def = (boxRegistry.boxDefinitions || []).find(x => x.id === id && x.version === version);
    if (!def || !def.publishedAt) throw domainError('SOURCE_BOX_NOT_PUBLISHED', key(id,version));
    return def;
  }
  function ancestorChain(boxRegistry, targetId) {
    const { instances } = boxMaps(boxRegistry); const target = instances.get(targetId); if (!target) throw domainError('BOX_INSTANCE_NOT_FOUND',targetId);
    const chain = []; let cur = target; const seen = new Set();
    while (cur) { if (seen.has(cur.id)) throw domainError('BOX_INSTANCE_CYCLE',cur.id); seen.add(cur.id); chain.unshift(cur); cur = cur.parentBoxInstanceId == null ? null : instances.get(cur.parentBoxInstanceId); if (cur === undefined) throw domainError('BOX_INSTANCE_PARENT_NOT_FOUND',targetId); }
    return chain;
  }

  function reduceComparableConstraints(constraints) {
    const grouped = new Map(); for (const c of constraints) { if (!grouped.has(c.key)) grouped.set(c.key,[]); grouped.get(c.key).push(c); }
    const effective = []; const conflicts = [];
    for (const [keyName, list] of grouped) {
      if (list.some(c => c.type === 'OPAQUE')) { conflicts.push({ code:'INCOMPARABLE_RULE', key:keyName, types:[...new Set(list.map(c=>c.type))].sort() }); continue; }
      const presence = [...new Set(list.filter(c=>c.type==='REQUIRED'||c.type==='PROHIBITED').map(c=>c.type))];
      if (presence.length > 1) { conflicts.push({ code:'REQUIRED_PROHIBITED_CONFLICT', key:keyName }); continue; }
      const allowed = list.filter(c=>c.type==='ALLOWED_SET');
      const mins = list.filter(c=>c.type==='MIN').map(c=>c.value);
      const maxs = list.filter(c=>c.type==='MAX').map(c=>c.value);
      const families = new Set(list.map(c => ['MIN','MAX'].includes(c.type) ? 'RANGE' : c.type));
      if (families.has('ALLOWED_SET') && families.has('RANGE')) { conflicts.push({ code:'INCOMPARABLE_RULE_TYPES', key:keyName, types:[...families].sort() }); continue; }
      if (presence.length && families.size > 1) { conflicts.push({ code:'INCOMPARABLE_RULE_TYPES', key:keyName, types:[...families].sort() }); continue; }
      if (presence.length) effective.push({ type:presence[0], key:keyName });
      if (allowed.length) {
        let values = allowed[0].values.slice(); for (const a of allowed.slice(1)) values = values.filter(v => a.values.includes(v));
        if (!values.length) conflicts.push({ code:'ALLOWED_SET_EMPTY_INTERSECTION', key:keyName }); else effective.push({ type:'ALLOWED_SET', key:keyName, values:[...new Set(values)].sort() });
      }
      if (mins.length || maxs.length) {
        const min = mins.length ? Math.max(...mins) : null; const max = maxs.length ? Math.min(...maxs) : null;
        if (min != null && max != null && min > max) conflicts.push({ code:'RANGE_EMPTY_INTERSECTION', key:keyName, min, max });
        else { if (min != null) effective.push({ type:'MIN', key:keyName, value:min }); if (max != null) effective.push({ type:'MAX', key:keyName, value:max }); }
      }
    }
    effective.sort((a,b) => stableStringify(a).localeCompare(stableStringify(b)));
    conflicts.sort((a,b) => stableStringify(a).localeCompare(stableStringify(b)));
    return deepFreeze({ status:conflicts.length ? 'CONFLICT' : 'VALID', constraints:effective, conflicts });
  }
  function effectiveRuleProjection(ruleDefs) { return reduceComparableConstraints(ruleDefs.flatMap(r => r.constraints)); }

  function normalizedConstraintMap(constraints) {
    const reduced = reduceComparableConstraints(constraints); if (reduced.status !== 'VALID') return null;
    const m = new Map(); for (const c of reduced.constraints) { if (!m.has(c.key)) m.set(c.key,{}); m.get(c.key)[c.type]=c; } return m;
  }
  function isRuleAtLeastAsStrict(candidate, baseline) {
    const c = normalizedConstraintMap(candidate.constraints), b = normalizedConstraintMap(baseline.constraints); if (!c || !b) return false;
    for (const [keyName, need] of b) {
      const got = c.get(keyName); if (!got) return false;
      if (need.REQUIRED && !got.REQUIRED) return false;
      if (need.PROHIBITED && !got.PROHIBITED) return false;
      if (need.ALLOWED_SET) { if (!got.ALLOWED_SET || got.ALLOWED_SET.values.some(v => !need.ALLOWED_SET.values.includes(v))) return false; }
      if (need.MIN) { if (!got.MIN || got.MIN.value < need.MIN.value) return false; }
      if (need.MAX) { if (!got.MAX || got.MAX.value > need.MAX.value) return false; }
    }
    return true;
  }

  function validateState(input) {
    const raw = clone(assertObject(input,'RULE_TEST_STATE_REQUIRED','StageBRuleTestRegistry'));
    if (raw.type !== 'StageBRuleTestRegistry' || Number(raw.schemaVersion) !== SCHEMA_VERSION || raw.migrationVersion !== MIGRATION_VERSION) throw domainError('UNSUPPORTED_RULE_TEST_SCHEMA','StageBRuleTestRegistry契約が不正です');
    const boxRegistry = requireBox().validateState(raw.boxRegistry);
    const projectId = boxRegistry.architecture.project.id;
    const revision = assertRevision(raw.revision,'StageBRuleTestRegistry.revision');
    const ruleDefinitions = (raw.ruleDefinitions || []).map(x => normalizeRuleDefinition(x,projectId));
    const ruleBindings = (raw.ruleBindings || []).map(x => normalizeRuleBinding(x,projectId));
    const testDefinitions = (raw.testDefinitions || []).map(x => normalizeTestDefinition(x,projectId));
    const requirementSources = (raw.requirementSources || []).map(x => normalizeRequirementSource(x,projectId));
    const testRequirements = (raw.testRequirements || []).map(x => normalizeRequirement(x,projectId));
    const manualRequirementEdits = (raw.manualRequirementEdits || []).map(x => normalizeManualEdit(x,projectId));
    const requirementSnapshots = (raw.requirementSnapshots || []).map(x => normalizeSnapshot(x,projectId));
    const state = { type:'StageBRuleTestRegistry', schemaVersion:SCHEMA_VERSION, migrationVersion:MIGRATION_VERSION, projectId, revision, boxRegistry, ruleDefinitions, ruleBindings, testDefinitions, requirementSources, testRequirements, manualRequirementEdits, requirementSnapshots };

    const ruleMap = new Map(); for (const d of ruleDefinitions) { const k=key(d.id,d.version); if(ruleMap.has(k))throw domainError('DUPLICATE_RULE_DEFINITION',k); ruleMap.set(k,d); }
    const testMap = new Map(); for (const d of testDefinitions) { const k=key(d.id,d.version); if(testMap.has(k))throw domainError('DUPLICATE_TEST_DEFINITION',k); testMap.set(k,d); }
    const { boxes, instances } = boxMaps(boxRegistry);
    const bindingIds = new Set();
    for (const b of ruleBindings) {
      if (bindingIds.has(b.id)) throw domainError('DUPLICATE_RULE_BINDING',b.id); bindingIds.add(b.id);
      const def=ruleMap.get(key(b.ruleDefinitionId,b.ruleDefinitionVersion)); if(!def||!def.publishedAt)throw domainError('RULE_BINDING_RULE_NOT_PUBLISHED',b.id);
      if (b.targetType==='BOX_DEFINITION' && !boxes.has(key(b.boxDefinitionId,b.boxDefinitionVersion))) throw domainError('RULE_BINDING_BOX_NOT_FOUND',b.id);
      if (b.targetType==='BOX_INSTANCE' && !instances.has(b.boxInstanceId)) throw domainError('RULE_BINDING_INSTANCE_NOT_FOUND',b.id);
    }
    for (const d of ruleDefinitions) for (const s of d.supersedes) { const prev=ruleMap.get(key(s.id,s.version)); if(!prev||!prev.publishedAt)throw domainError('SUPERSEDED_RULE_NOT_PUBLISHED',key(s.id,s.version)); if(d.publishedAt&&!isRuleAtLeastAsStrict(d,prev))throw domainError('RULE_WEAKENING_REQUIRES_WAIVER',`${key(d.id,d.version)} weakens ${key(prev.id,prev.version)}`); }
    const sourceIds=new Set(); for (const s of requirementSources) { if(sourceIds.has(s.id))throw domainError('DUPLICATE_REQUIREMENT_SOURCE',s.id); sourceIds.add(s.id); publishedBox(boxRegistry,s.sourceBoxDefinitionId,s.sourceBoxDefinitionVersion); const t=testMap.get(key(s.testDefinitionId,s.testDefinitionVersion)); if(!t||!t.publishedAt)throw domainError('REQUIREMENT_TEST_NOT_PUBLISHED',s.id); }
    const reqIds=new Set(), generationKeys=new Set(); for(const r of testRequirements){if(reqIds.has(r.id))throw domainError('DUPLICATE_TEST_REQUIREMENT',r.id);reqIds.add(r.id);if(generationKeys.has(r.generationKey))throw domainError('DUPLICATE_REQUIREMENT_GENERATION_KEY',r.generationKey);generationKeys.add(r.generationKey);if(!instances.has(r.target.boxInstanceId))throw domainError('REQUIREMENT_TARGET_NOT_FOUND',r.id);}
    const editReq=new Set(); for(const e of manualRequirementEdits){if(editReq.has(e.requirementId))throw domainError('DUPLICATE_MANUAL_EDIT',e.requirementId);editReq.add(e.requirementId);if(!reqIds.has(e.requirementId))throw domainError('MANUAL_EDIT_REQUIREMENT_NOT_FOUND',e.requirementId);}
    const snapIds=new Set(); for(const s of requirementSnapshots){if(snapIds.has(s.id))throw domainError('DUPLICATE_REQUIREMENT_SNAPSHOT',s.id);snapIds.add(s.id);if(!instances.has(s.targetBoxInstanceId))throw domainError('SNAPSHOT_TARGET_NOT_FOUND',s.id);}
    return deepFreeze(state);
  }

  function migrateFromB01(boxRegistryInput) {
    const boxRegistry = requireBox().validateState(boxRegistryInput); const projectId = boxRegistry.architecture.project.id;
    return validateState({ type:'StageBRuleTestRegistry', schemaVersion:SCHEMA_VERSION, migrationVersion:MIGRATION_VERSION, projectId, revision:1, boxRegistry, ruleDefinitions:[], ruleBindings:[], testDefinitions:[], requirementSources:[], testRequirements:[], manualRequirementEdits:[], requirementSnapshots:[] });
  }
  function mutate(stateInput, fn) {
    const before = validateState(stateInput); const draft = clone(before); fn(draft);
    const a = clone(draft); a.revision = before.revision; const b = clone(before);
    if (stableStringify(a) === stableStringify(b)) return before;
    draft.revision = before.revision + 1; return validateState(draft);
  }
  function createRuleDraft(state,input) { return mutate(state,d=>{ const id=assertId(input.id,'RuleDefinition.id'),version=assertVersion(input.version);if(d.ruleDefinitions.some(x=>x.id===id&&x.version===version))throw domainError('DEFINITION_VERSION_EXISTS',key(id,version));d.ruleDefinitions.push({type:'RuleDefinition',id,version,projectId:d.projectId,revision:1,name:assertName(input.name,'RuleDefinition.name'),constraints:(input.constraints||[]).map(normalizeConstraint),supersedes:normalizeSupersedes(input.supersedes),publishedAt:null,contentHash:null});}); }
  function publishRuleDefinition(state,id,version,options={}) { return mutate(state,d=>{const def=d.ruleDefinitions.find(x=>x.id===id&&x.version===version);if(!def)throw domainError('RULE_DEFINITION_NOT_FOUND',key(id,version));if(def.publishedAt)throw domainError('PUBLISHED_DEFINITION_IMMUTABLE',key(id,version));for(const s of def.supersedes){const prev=d.ruleDefinitions.find(x=>x.id===s.id&&x.version===s.version&&x.publishedAt);if(!prev)throw domainError('SUPERSEDED_RULE_NOT_PUBLISHED',key(s.id,s.version));if(!isRuleAtLeastAsStrict(def,prev))throw domainError('RULE_WEAKENING_REQUIRES_WAIVER',`${key(id,version)} weakens ${key(s.id,s.version)}`);}def.publishedAt=iso(options.now);def.revision+=1;def.contentHash=sha256(ruleContent(def));}); }
  function createNextRuleVersion(state,id,fromVersion,input={}) { const s=validateState(state),from=s.ruleDefinitions.find(x=>x.id===id&&x.version===fromVersion&&x.publishedAt);if(!from)throw domainError('PUBLISHED_SOURCE_VERSION_REQUIRED',key(id,fromVersion));return createRuleDraft(s,{id,version:fromVersion+1,name:input.name==null?from.name:input.name,constraints:input.constraints==null?from.constraints:input.constraints,supersedes:input.supersedes==null?[{id:from.id,version:from.version}]:input.supersedes}); }
  function addRuleBinding(state,input){return mutate(state,d=>{d.ruleBindings.push({type:'RuleBinding',id:assertId(input.id,'RuleBinding.id'),projectId:d.projectId,revision:1,ruleDefinitionId:assertId(input.ruleDefinitionId,'ruleDefinitionId'),ruleDefinitionVersion:assertVersion(input.ruleDefinitionVersion),targetType:String(input.targetType||'').toUpperCase(),boxDefinitionId:input.boxDefinitionId==null?null:input.boxDefinitionId,boxDefinitionVersion:input.boxDefinitionVersion==null?null:input.boxDefinitionVersion,boxInstanceId:input.boxInstanceId==null?null:input.boxInstanceId,inheritToChildren:input.inheritToChildren!==false});});}
  function createTestDraft(state,input){return mutate(state,d=>{const id=assertId(input.id,'TestDefinition.id'),version=assertVersion(input.version);if(d.testDefinitions.some(x=>x.id===id&&x.version===version))throw domainError('DEFINITION_VERSION_EXISTS',key(id,version));d.testDefinitions.push({type:'TestDefinition',id,version,projectId:d.projectId,revision:1,name:assertName(input.name,'TestDefinition.name'),runner:assertId(input.runner,'runner').toUpperCase(),command:String(input.command||''),evaluationConditions:canonical(clone(input.evaluationConditions||{})),publishedAt:null,contentHash:null});});}
  function publishTestDefinition(state,id,version,options={}){return mutate(state,d=>{const def=d.testDefinitions.find(x=>x.id===id&&x.version===version);if(!def)throw domainError('TEST_DEFINITION_NOT_FOUND',key(id,version));if(def.publishedAt)throw domainError('PUBLISHED_DEFINITION_IMMUTABLE',key(id,version));def.publishedAt=iso(options.now);def.revision+=1;def.contentHash=sha256(testContent(def));});}
  function addRequirementSource(state,input){return mutate(state,d=>{d.requirementSources.push({type:'RequirementSource',id:assertId(input.id,'RequirementSource.id'),projectId:d.projectId,revision:1,sourceBoxDefinitionId:assertId(input.sourceBoxDefinitionId,'sourceBoxDefinitionId'),sourceBoxDefinitionVersion:assertVersion(input.sourceBoxDefinitionVersion),testDefinitionId:assertId(input.testDefinitionId,'testDefinitionId'),testDefinitionVersion:assertVersion(input.testDefinitionVersion),scope:String(input.scope||'SELF').toUpperCase(),enabled:input.enabled!==false});});}

  function effectiveRulesForInstance(stateInput,targetBoxInstanceId){
    const state=validateState(stateInput),chain=ancestorChain(state.boxRegistry,targetBoxInstanceId),ruleMap=definitionMap(state.ruleDefinitions),sources=[];
    for(let i=0;i<chain.length;i++){
      const instance=chain[i],isTarget=i===chain.length-1;
      for(const binding of state.ruleBindings){
        let applies=false;
        if(binding.targetType==='BOX_INSTANCE'&&binding.boxInstanceId===instance.id)applies=isTarget||binding.inheritToChildren;
        if(binding.targetType==='BOX_DEFINITION'&&binding.boxDefinitionId===instance.boxDefinitionId&&binding.boxDefinitionVersion===instance.boxDefinitionVersion)applies=isTarget||binding.inheritToChildren;
        if(!applies)continue;
        const rule=ruleMap.get(key(binding.ruleDefinitionId,binding.ruleDefinitionVersion));
        const path=chain.slice(i).map(x=>x.id);
        sources.push({bindingId:binding.id,ruleDefinitionId:rule.id,ruleDefinitionVersion:rule.version,ruleContentHash:rule.contentHash,sourceTargetType:binding.targetType,sourceBoxInstanceId:instance.id,inheritancePath:path});
      }
    }
    sources.sort((a,b)=>stableStringify(a).localeCompare(stableStringify(b)));
    const defs=sources.map(s=>ruleMap.get(key(s.ruleDefinitionId,s.ruleDefinitionVersion)));
    const reduced=effectiveRuleProjection(defs);
    return deepFreeze({status:reduced.status,constraints:reduced.constraints,conflicts:reduced.conflicts,sources});
  }
  function sourceAppliesToTarget(state,source,targetId){
    const chain=ancestorChain(state.boxRegistry,targetId); const matchIndex=chain.findIndex(x=>x.boxDefinitionId===source.sourceBoxDefinitionId&&x.boxDefinitionVersion===source.sourceBoxDefinitionVersion);
    if(matchIndex<0)return null; if(source.scope==='SELF'&&matchIndex!==chain.length-1)return null; return {chain,matchIndex};
  }
  function generatedRequirementProjection(state,source,target,testDef,effective,chain,matchIndex){
    return {
      source:{requirementSourceId:source.id,sourceBoxDefinitionId:source.sourceBoxDefinitionId,sourceBoxDefinitionVersion:source.sourceBoxDefinitionVersion,scope:source.scope},
      target:{boxInstanceId:target.id,boxDefinitionId:target.boxDefinitionId,boxDefinitionVersion:target.boxDefinitionVersion},
      testDefinition:{id:testDef.id,version:testDef.version,contentHash:testDef.contentHash},
      effectiveRules:{status:effective.status,constraints:effective.constraints,conflicts:effective.conflicts,sources:effective.sources},
      inheritancePaths:[chain.slice(matchIndex).map(x=>x.id)],evaluationConditions:testDef.evaluationConditions
    };
  }
  function deriveRequirements(stateInput){
    const state=validateState(stateInput),testMap=definitionMap(state.testDefinitions),instances=state.boxRegistry.boxInstances||[],generated=[];
    for(const source of state.requirementSources.filter(x=>x.enabled)){
      const testDef=testMap.get(key(source.testDefinitionId,source.testDefinitionVersion));
      for(const target of instances){const app=sourceAppliesToTarget(state,source,target.id);if(!app)continue;const effective=effectiveRulesForInstance(state,target.id);const p=generatedRequirementProjection(state,source,target,testDef,effective,app.chain,app.matchIndex);const generationKey=stableStringify({sourceId:source.id,targetBoxInstanceId:target.id,sourceBoxDefinitionId:source.sourceBoxDefinitionId,sourceBoxDefinitionVersion:source.sourceBoxDefinitionVersion,testDefinitionId:testDef.id,testDefinitionVersion:testDef.version});generated.push({generationKey,projection:p});}
    }
    generated.sort((a,b)=>a.generationKey.localeCompare(b.generationKey));
    return mutate(state,d=>{
      const previous=new Map(d.testRequirements.map(r=>[r.generationKey,r]));const next=[];
      for(const g of generated){const hash=sha256(g.projection),old=previous.get(g.generationKey),id=old?old.id:deterministicId('test-requirement',g.generationKey);if(old&&old.generatedHash===hash&&old.status==='ACTIVE'){next.push(old);previous.delete(g.generationKey);continue;}next.push({type:'TestRequirement',id,projectId:d.projectId,version:old?old.version+1:1,revision:old?old.revision+1:1,status:'ACTIVE',generationKey:g.generationKey,generatedHash:hash,...g.projection});previous.delete(g.generationKey);}
      for(const old of previous.values()){if(old.status==='RETIRED'){next.push(old);continue;}next.push({...old,status:'RETIRED',revision:old.revision+1});}
      next.sort((a,b)=>a.id.localeCompare(b.id));d.testRequirements=next;
    });
  }
  function setManualRequirementEdit(state,input,options={}){return mutate(state,d=>{const requirementId=assertId(input.requirementId,'requirementId');if(!d.testRequirements.some(x=>x.id===requirementId))throw domainError('TEST_REQUIREMENT_NOT_FOUND',requirementId);for(const forbidden of ['generatedHash','effectiveRules','evaluationConditions','testDefinition','source','target','status'])if(Object.prototype.hasOwnProperty.call(input,forbidden))throw domainError('MANUAL_EDIT_CANNOT_OVERRIDE_GENERATED',forbidden);const existing=d.manualRequirementEdits.find(x=>x.requirementId===requirementId);const record={type:'ManualRequirementEdit',requirementId,projectId:d.projectId,revision:existing?existing.revision+1:1,note:String(input.note==null?(existing?existing.note:''):input.note),priority:input.priority==null?(existing?existing.priority:null):String(input.priority).toUpperCase(),labels:input.labels==null?(existing?existing.labels:[]):[...new Set(input.labels.map(String))].sort(),updatedBy:assertId(options.actor||input.updatedBy||'system','updatedBy'),updatedAt:iso(options.now||input.updatedAt)};if(existing)Object.assign(existing,record);else d.manualRequirementEdits.push(record);});}
  function requirementView(stateInput,requirementId){const state=validateState(stateInput),r=state.testRequirements.find(x=>x.id===requirementId);if(!r)throw domainError('TEST_REQUIREMENT_NOT_FOUND',requirementId);const manual=state.manualRequirementEdits.find(x=>x.requirementId===requirementId)||null;return deepFreeze({generated:r,manualEdit:manual});}
  function createRequirementSnapshotDraft(state,input,options={}){return mutate(state,d=>{const targetId=assertId(input.targetBoxInstanceId,'targetBoxInstanceId');const reqs=d.testRequirements.filter(x=>x.target.boxInstanceId===targetId&&x.status==='ACTIVE');const chosen=input.requirementIds==null?reqs:reqs.filter(x=>input.requirementIds.includes(x.id));const items=chosen.map(r=>({testRequirementId:r.id,testRequirementVersion:r.version,generatedHash:r.generatedHash,source:clone(r.source),testDefinition:clone(r.testDefinition),effectiveRules:clone(r.effectiveRules),inheritancePaths:clone(r.inheritancePaths),evaluationConditions:clone(r.evaluationConditions)})).sort((a,b)=>a.testRequirementId.localeCompare(b.testRequirementId));d.requirementSnapshots.push({type:'RequirementSnapshot',id:assertId(input.id,'RequirementSnapshot.id'),projectId:d.projectId,revision:1,targetBoxInstanceId:targetId,status:'DRAFT',requirementItems:items,createdAt:iso(options.now),finalizedAt:null,contentHash:null});});}
  function finalizeRequirementSnapshot(state,snapshotId,options={}){return mutate(state,d=>{const snap=d.requirementSnapshots.find(x=>x.id===snapshotId);if(!snap)throw domainError('REQUIREMENT_SNAPSHOT_NOT_FOUND',snapshotId);if(snap.status==='FINAL')throw domainError('FINAL_SNAPSHOT_IMMUTABLE',snapshotId);if(!snap.requirementItems.length)throw domainError('SNAPSHOT_GATE_NO_REQUIREMENTS','RequirementSnapshotが空です');for(const item of snap.requirementItems){const current=d.testRequirements.find(x=>x.id===item.testRequirementId&&x.version===item.testRequirementVersion&&x.status==='ACTIVE');if(!current||current.generatedHash!==item.generatedHash)throw domainError('SNAPSHOT_GATE_STALE_REQUIREMENT',item.testRequirementId);if(item.effectiveRules.status!=='VALID')throw domainError('SNAPSHOT_GATE_CONFLICT',item.testRequirementId);}snap.status='FINAL';snap.revision+=1;snap.finalizedAt=iso(options.now);snap.contentHash=sha256(snapshotContent(snap));});}
  function assertWaiverUnavailable(){if(!WAIVER_ENABLED)throw domainError('WAIVER_NOT_AVAILABLE_UNTIL_B03','Rule弱化WaiverはB-03まで利用できません');return true;}
  function assertDirectWriteDisabled(){if(!DIRECT_WRITE_ENABLED)throw domainError('RULE_TEST_CHANGESET_REQUIRED','B-02の永続変更はRuleTestChangeSet経由で行う必要があります');return true;}
  function serialize(state){return stableStringify(validateState(state));}
  function hydrate(value){let p;try{p=typeof value==='string'?JSON.parse(value):clone(value);}catch{throw domainError('INVALID_RULE_TEST_JSON','B-02 JSONを解析できません');}return validateState(p);}
  function applyOperation(state,op,options={}){
    const type=String(op&&op.type||'').toUpperCase();
    switch(type){
      case 'CREATE_RULE_DRAFT':return createRuleDraft(state,op);
      case 'PUBLISH_RULE':return publishRuleDefinition(state,op.ruleDefinitionId,Number(op.ruleDefinitionVersion),{now:op.at});
      case 'CREATE_NEXT_RULE_VERSION':return createNextRuleVersion(state,op.ruleDefinitionId,Number(op.fromVersion),op);
      case 'ADD_RULE_BINDING':return addRuleBinding(state,op);
      case 'CREATE_TEST_DRAFT':return createTestDraft(state,op);
      case 'PUBLISH_TEST':return publishTestDefinition(state,op.testDefinitionId,Number(op.testDefinitionVersion),{now:op.at});
      case 'ADD_REQUIREMENT_SOURCE':return addRequirementSource(state,op);
      case 'RECOMPUTE_REQUIREMENTS':return deriveRequirements(state);
      case 'SET_MANUAL_REQUIREMENT_EDIT':return setManualRequirementEdit(state,op,{now:op.at,actor:op.actor||options.actor});
      case 'CREATE_REQUIREMENT_SNAPSHOT_DRAFT':return createRequirementSnapshotDraft(state,op,{now:op.at});
      case 'FINALIZE_REQUIREMENT_SNAPSHOT':return finalizeRequirementSnapshot(state,op.snapshotId,{now:op.at});
      default:throw domainError('UNSUPPORTED_RULE_TEST_OPERATION',type||'<empty>');
    }
  }

  return deepFreeze({
    SCHEMA_VERSION,MIGRATION_VERSION,WAIVER_ENABLED,DIRECT_WRITE_ENABLED,
    CONSTRAINT_TYPES:Object.freeze([...CONSTRAINT_TYPES]),RULE_TARGET_TYPES:Object.freeze([...RULE_TARGET_TYPES]),REQUIREMENT_SCOPES:Object.freeze([...REQUIREMENT_SCOPES]),
    stableStringify,sha256,validateState,migrateFromB01,reduceComparableConstraints,isRuleAtLeastAsStrict,effectiveRulesForInstance,
    createRuleDraft,publishRuleDefinition,createNextRuleVersion,addRuleBinding,createTestDraft,publishTestDefinition,addRequirementSource,
    deriveRequirements,setManualRequirementEdit,requirementView,createRequirementSnapshotDraft,finalizeRequirementSnapshot,
    assertWaiverUnavailable,assertDirectWriteDisabled,applyOperation,serialize,hydrate
  });
});
