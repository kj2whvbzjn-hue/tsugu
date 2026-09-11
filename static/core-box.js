(function (root, factory) {
  let architecture = root && root.TSUGUCoreArchitecture;
  let hashCore = root && root.TSUGUCoreChangeSet;
  if (typeof module === 'object' && module.exports) {
    try { if (!architecture) architecture = require('./core-architecture.js'); } catch {}
    try { if (!hashCore) hashCore = require('./core-changeset.js'); } catch {}
  }
  const api = factory(root, architecture, hashCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreBox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Architecture, HashCore) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MIGRATION_VERSION = 'B01-1';
  const SYSTEM_SEED_VERSION = 'B01-1';
  const DIRECT_WRITE_ENABLED = false;
  const FIELD_TYPES = new Set(['STRING', 'NUMBER', 'BOOLEAN', 'ENUM']);
  const BINDING_RELATIONS = new Set(['IMPLEMENTS', 'TESTS', 'CONFIGURES', 'MIGRATES']);
  const TARGET_TYPES = new Set(['NODE', 'BOX_INSTANCE']);
  const LIFECYCLE_ACTIONS = new Set(['DEPRECATED', 'RETIRED']);

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
  function requireHashCore() {
    if (!HashCore || typeof HashCore.sha256 !== 'function') throw domainError('CHANGESET_CORE_REQUIRED', 'TSUGUCoreChangeSet.sha256 が必要です');
    return HashCore;
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
      return out;
    }
    return value;
  }
  function stableStringify(value) { return JSON.stringify(canonical(value)); }
  function hash(value) { return requireHashCore().sha256(typeof value === 'string' ? value : canonical(value)); }
  function assertObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError(code, `${label} が必要です`);
    return value;
  }
  function assertId(value, field) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) throw domainError('INVALID_ID', `${field} が不正です`);
    return id;
  }
  function assertName(value, field) {
    const name = String(value == null ? '' : value).normalize('NFC');
    if (!name.trim() || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) throw domainError('INVALID_NAME', `${field} が不正です`);
    return name;
  }
  function assertVersion(value, field='version') {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_VERSION', `${field} は1以上の整数である必要があります`);
    return n;
  }
  function assertRevision(value, field='revision') {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_REVISION', `${field} は1以上の整数である必要があります`);
    return n;
  }
  function iso(value, field='timestamp') {
    const d = value == null ? new Date() : new Date(value);
    if (Number.isNaN(d.getTime())) throw domainError('INVALID_TIMESTAMP', `${field} が不正です`);
    return d.toISOString();
  }
  function randomUuid() {
    if (root && root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    try { if (typeof require === 'function') return require('node:crypto').randomUUID(); } catch {}
    throw domainError('UUID_UNAVAILABLE', '安定IDを生成できません');
  }
  function stableId(prefix, supplied) { return supplied == null ? `${prefix}:${randomUuid()}` : assertId(supplied, `${prefix}.id`); }
  function key(id, version) { return `${id}@${version}`; }

  function normalizeField(input) {
    const raw = assertObject(input, 'SCHEMA_FIELD_REQUIRED', 'SchemaField');
    const type = String(raw.type || '').toUpperCase();
    if (!FIELD_TYPES.has(type)) throw domainError('INVALID_SCHEMA_FIELD_TYPE', `SchemaField.type ${type || '<empty>'} は未対応です`);
    const name = assertId(raw.name, 'SchemaField.name');
    const required = Boolean(raw.required);
    const enumValues = type === 'ENUM' ? [...new Set((raw.enumValues || []).map(v => String(v)))].sort() : [];
    if (type === 'ENUM' && enumValues.length === 0) throw domainError('ENUM_VALUES_REQUIRED', `${name} のenumValuesが必要です`);
    return { name, type, required, enumValues };
  }
  function schemaContent(def) {
    return { id:def.id, version:def.version, projectId:def.projectId, name:def.name, fields:def.fields };
  }
  function boxContent(def, constraints) {
    return {
      id:def.id, version:def.version, projectId:def.projectId, name:def.name,
      schemaDefinitionId:def.schemaDefinitionId, schemaDefinitionVersion:def.schemaDefinitionVersion,
      metadata:def.metadata,
      childConstraints: constraints
        .filter(c => c.boxDefinitionId === def.id && c.boxDefinitionVersion === def.version)
        .map(c => ({ childSchemaDefinitionId:c.childSchemaDefinitionId, childSchemaDefinitionVersion:c.childSchemaDefinitionVersion, minCount:c.minCount, maxCount:c.maxCount }))
        .sort((a,b) => stableStringify(a).localeCompare(stableStringify(b)))
    };
  }
  function normalizeSchemaDefinition(input, projectId) {
    const raw = assertObject(input, 'SCHEMA_DEFINITION_REQUIRED', 'SchemaDefinition');
    const pid = assertId(raw.projectId, 'SchemaDefinition.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'SchemaDefinitionが別Projectを参照しています');
    const fields = (raw.fields || []).map(normalizeField);
    const names = new Set();
    for (const field of fields) {
      if (names.has(field.name)) throw domainError('DUPLICATE_SCHEMA_FIELD', `SchemaField ${field.name} が重複しています`);
      names.add(field.name);
    }
    const publishedAt = raw.publishedAt == null ? null : iso(raw.publishedAt, 'SchemaDefinition.publishedAt');
    const out = {
      type:'SchemaDefinition', id:assertId(raw.id, 'SchemaDefinition.id'), version:assertVersion(raw.version, 'SchemaDefinition.version'),
      projectId:pid, revision:assertRevision(raw.revision, 'SchemaDefinition.revision'), name:assertName(raw.name, 'SchemaDefinition.name'),
      fields, publishedAt, contentHash:raw.contentHash == null ? null : String(raw.contentHash)
    };
    if (publishedAt) {
      const expected = hash(schemaContent(out));
      if (out.contentHash !== expected) throw domainError('PUBLISHED_CONTENT_HASH_MISMATCH', `SchemaDefinition ${key(out.id,out.version)} のPublished内容が改変されています`);
    } else if (out.contentHash != null) {
      throw domainError('DRAFT_CONTENT_HASH_NOT_ALLOWED', 'Draft SchemaDefinitionにcontentHashを固定できません');
    }
    return out;
  }
  function normalizeBoxDefinition(input, projectId) {
    const raw = assertObject(input, 'BOX_DEFINITION_REQUIRED', 'BoxDefinition');
    const pid = assertId(raw.projectId, 'BoxDefinition.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'BoxDefinitionが別Projectを参照しています');
    const publishedAt = raw.publishedAt == null ? null : iso(raw.publishedAt, 'BoxDefinition.publishedAt');
    const metadata = raw.metadata == null ? {} : clone(assertObject(raw.metadata, 'BOX_METADATA_REQUIRED', 'BoxDefinition.metadata'));
    return {
      type:'BoxDefinition', id:assertId(raw.id, 'BoxDefinition.id'), version:assertVersion(raw.version, 'BoxDefinition.version'),
      projectId:pid, revision:assertRevision(raw.revision, 'BoxDefinition.revision'), name:assertName(raw.name, 'BoxDefinition.name'),
      schemaDefinitionId:assertId(raw.schemaDefinitionId, 'BoxDefinition.schemaDefinitionId'),
      schemaDefinitionVersion:assertVersion(raw.schemaDefinitionVersion, 'BoxDefinition.schemaDefinitionVersion'),
      metadata:canonical(metadata), publishedAt, contentHash:raw.contentHash == null ? null : String(raw.contentHash)
    };
  }
  function normalizeConstraint(input, projectId) {
    const raw = assertObject(input, 'CHILD_CONSTRAINT_REQUIRED', 'ChildConstraint');
    const pid = assertId(raw.projectId, 'ChildConstraint.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'ChildConstraintが別Projectを参照しています');
    const minCount = Number(raw.minCount == null ? 0 : raw.minCount);
    const maxCount = raw.maxCount == null ? null : Number(raw.maxCount);
    if (!Number.isSafeInteger(minCount) || minCount < 0) throw domainError('INVALID_CHILD_CONSTRAINT', 'minCountが不正です');
    if (maxCount != null && (!Number.isSafeInteger(maxCount) || maxCount < minCount)) throw domainError('INVALID_CHILD_CONSTRAINT', 'maxCountが不正です');
    return {
      type:'ChildConstraint', id:assertId(raw.id, 'ChildConstraint.id'), projectId:pid,
      revision:assertRevision(raw.revision, 'ChildConstraint.revision'),
      boxDefinitionId:assertId(raw.boxDefinitionId, 'ChildConstraint.boxDefinitionId'), boxDefinitionVersion:assertVersion(raw.boxDefinitionVersion),
      childSchemaDefinitionId:assertId(raw.childSchemaDefinitionId, 'ChildConstraint.childSchemaDefinitionId'), childSchemaDefinitionVersion:assertVersion(raw.childSchemaDefinitionVersion),
      minCount, maxCount
    };
  }
  function normalizeInstance(input, projectId) {
    const raw = assertObject(input, 'BOX_INSTANCE_REQUIRED', 'BoxInstance');
    const pid = assertId(raw.projectId, 'BoxInstance.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'BoxInstanceが別Projectを参照しています');
    return {
      type:'BoxInstance', id:assertId(raw.id, 'BoxInstance.id'), projectId:pid, revision:assertRevision(raw.revision, 'BoxInstance.revision'),
      boxDefinitionId:assertId(raw.boxDefinitionId, 'BoxInstance.boxDefinitionId'), boxDefinitionVersion:assertVersion(raw.boxDefinitionVersion),
      architectureNodeId:assertId(raw.architectureNodeId, 'BoxInstance.architectureNodeId'),
      parentBoxInstanceId:raw.parentBoxInstanceId == null ? null : assertId(raw.parentBoxInstanceId, 'BoxInstance.parentBoxInstanceId'),
      config:canonical(raw.config == null ? {} : clone(assertObject(raw.config, 'BOX_CONFIG_REQUIRED', 'BoxInstance.config')))
    };
  }
  function normalizeBinding(input, projectId) {
    const raw = assertObject(input, 'BOX_BINDING_REQUIRED', 'ArchitectureBindingV2');
    const pid = assertId(raw.projectId, 'ArchitectureBindingV2.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'ArchitectureBindingV2が別Projectを参照しています');
    const targetType = String(raw.targetType || '').toUpperCase();
    if (!TARGET_TYPES.has(targetType)) throw domainError('INVALID_BINDING_TARGET', 'targetTypeはNODEまたはBOX_INSTANCEである必要があります');
    const nodeId = raw.architectureNodeId == null ? null : assertId(raw.architectureNodeId, 'ArchitectureBindingV2.architectureNodeId');
    const boxId = raw.boxInstanceId == null ? null : assertId(raw.boxInstanceId, 'ArchitectureBindingV2.boxInstanceId');
    if (targetType === 'NODE' && (!nodeId || boxId)) throw domainError('BINDING_TARGET_EXCLUSIVITY', 'NODE BindingはarchitectureNodeIdだけを参照する必要があります');
    if (targetType === 'BOX_INSTANCE' && (!boxId || nodeId)) throw domainError('BINDING_TARGET_EXCLUSIVITY', 'BOX_INSTANCE BindingはboxInstanceIdだけを参照する必要があります');
    const relation = String(raw.relation || '').toUpperCase();
    if (!BINDING_RELATIONS.has(relation)) throw domainError('INVALID_BINDING_RELATION', 'ArchitectureBindingV2.relationが不正です');
    const active = assertRevision(raw.activeFromRevision == null ? 1 : raw.activeFromRevision, 'activeFromRevision');
    const inactive = raw.inactiveFromRevision == null ? null : assertRevision(raw.inactiveFromRevision, 'inactiveFromRevision');
    if (inactive != null && inactive <= active) throw domainError('INVALID_BINDING_PERIOD', 'inactiveFromRevisionはactiveFromRevisionより後である必要があります');
    return {
      type:'ArchitectureBindingV2', id:assertId(raw.id, 'ArchitectureBindingV2.id'), projectId:pid, revision:assertRevision(raw.revision),
      pathEntryId:assertId(raw.pathEntryId, 'ArchitectureBindingV2.pathEntryId'), targetType,
      architectureNodeId:nodeId, boxInstanceId:boxId, relation, activeFromRevision:active, inactiveFromRevision:inactive
    };
  }
  function normalizeLifecycle(input, projectId) {
    const raw = assertObject(input, 'LIFECYCLE_EVENT_REQUIRED', 'DefinitionLifecycleEvent');
    const pid = assertId(raw.projectId, 'DefinitionLifecycleEvent.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'LifecycleEventが別Projectです');
    const entityType = String(raw.entityType || '').toUpperCase();
    if (!['SCHEMA_DEFINITION','BOX_DEFINITION'].includes(entityType)) throw domainError('INVALID_LIFECYCLE_ENTITY', 'Lifecycle対象が不正です');
    const action = String(raw.action || '').toUpperCase();
    if (!LIFECYCLE_ACTIONS.has(action)) throw domainError('INVALID_LIFECYCLE_ACTION', 'Lifecycle actionが不正です');
    return {
      type:'DefinitionLifecycleEvent', id:assertId(raw.id, 'DefinitionLifecycleEvent.id'), projectId:pid,
      entityType, entityId:assertId(raw.entityId, 'DefinitionLifecycleEvent.entityId'), entityVersion:assertVersion(raw.entityVersion),
      action, actor:assertId(raw.actor, 'DefinitionLifecycleEvent.actor'), at:iso(raw.at, 'DefinitionLifecycleEvent.at')
    };
  }
  function periodsOverlap(aStart,aEnd,bStart,bEnd) {
    const ae = aEnd == null ? Infinity : aEnd, be = bEnd == null ? Infinity : bEnd;
    return aStart < be && bStart < ae;
  }
  function lifecycleStatus(state, entityType, id, version) {
    const list = entityType === 'SCHEMA_DEFINITION' ? state.schemaDefinitions : state.boxDefinitions;
    const def = list.find(x => x.id === id && x.version === version);
    if (!def) return 'MISSING';
    if (!def.publishedAt) return 'DRAFT';
    const events = state.lifecycleHistory.filter(e => e.entityType === entityType && e.entityId === id && e.entityVersion === version)
      .sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    let status = 'PUBLISHED';
    for (const event of events) {
      if (event.action === 'DEPRECATED' && status === 'PUBLISHED') status = 'DEPRECATED';
      else if (event.action === 'RETIRED' && (status === 'PUBLISHED' || status === 'DEPRECATED')) status = 'RETIRED';
      else throw domainError('INVALID_LIFECYCLE_TRANSITION', `${entityType}:${key(id,version)} のLifecycle順序が不正です`);
    }
    return status;
  }
  function validateConfig(schema, config) {
    const allowed = new Map(schema.fields.map(f => [f.name, f]));
    for (const keyName of Object.keys(config)) if (!allowed.has(keyName)) throw domainError('SCHEMA_UNKNOWN_FIELD', `${keyName} はSchemaにありません`);
    for (const field of schema.fields) {
      const has = Object.prototype.hasOwnProperty.call(config, field.name);
      if (field.required && !has) throw domainError('SCHEMA_REQUIRED_FIELD', `${field.name} は必須です`);
      if (!has) continue;
      const value = config[field.name];
      let ok = false;
      if (field.type === 'STRING') ok = typeof value === 'string';
      if (field.type === 'NUMBER') ok = typeof value === 'number' && Number.isFinite(value);
      if (field.type === 'BOOLEAN') ok = typeof value === 'boolean';
      if (field.type === 'ENUM') ok = typeof value === 'string' && field.enumValues.includes(value);
      if (!ok) throw domainError('SCHEMA_TYPE_MISMATCH', `${field.name} が${field.type}制約に一致しません`);
    }
    return true;
  }

  function validateState(input, options={}) {
    const a = requireArchitecture();
    const raw = clone(assertObject(input, 'BOX_STATE_REQUIRED', 'StageBBoxRegistry'));
    if (raw.type !== 'StageBBoxRegistry' || Number(raw.schemaVersion) !== SCHEMA_VERSION) throw domainError('UNSUPPORTED_BOX_SCHEMA', 'StageBBoxRegistry契約が不正です');
    if (raw.migrationVersion !== MIGRATION_VERSION) throw domainError('UNSUPPORTED_BOX_MIGRATION', 'migrationVersionが不正です');
    const architecture = a.validateState(raw.architecture);
    const projectId = architecture.project.id;
    const schemaDefinitions = (raw.schemaDefinitions || []).map(x => normalizeSchemaDefinition(x, projectId));
    const boxDefinitions = (raw.boxDefinitions || []).map(x => normalizeBoxDefinition(x, projectId));
    const childConstraints = (raw.childConstraints || []).map(x => normalizeConstraint(x, projectId));
    const boxInstances = (raw.boxInstances || []).map(x => normalizeInstance(x, projectId));
    const bindings = (raw.bindings || []).map(x => normalizeBinding(x, projectId));
    const lifecycleHistory = (raw.lifecycleHistory || []).map(x => normalizeLifecycle(x, projectId));
    const seedVersion = raw.seedVersion == null ? null : String(raw.seedVersion);
    const state = { type:'StageBBoxRegistry', schemaVersion:SCHEMA_VERSION, migrationVersion:MIGRATION_VERSION, architecture, schemaDefinitions, boxDefinitions, childConstraints, boxInstances, bindings, lifecycleHistory, seedVersion };

    const schemaMap = new Map();
    for (const def of schemaDefinitions) {
      const k = key(def.id,def.version); if (schemaMap.has(k)) throw domainError('DUPLICATE_SCHEMA_DEFINITION', k); schemaMap.set(k,def);
    }
    const boxMap = new Map();
    for (const def of boxDefinitions) {
      const k = key(def.id,def.version); if (boxMap.has(k)) throw domainError('DUPLICATE_BOX_DEFINITION', k); boxMap.set(k,def);
      const schema = schemaMap.get(key(def.schemaDefinitionId,def.schemaDefinitionVersion));
      if (!schema) throw domainError('BOX_SCHEMA_NOT_FOUND', `${k} のSchemaDefinitionが存在しません`);
      if (def.publishedAt && !schema.publishedAt) throw domainError('BOX_SCHEMA_NOT_PUBLISHED', `${k} はDraft Schemaを参照できません`);
    }
    const constraintIds = new Set();
    for (const c of childConstraints) {
      if (constraintIds.has(c.id)) throw domainError('DUPLICATE_CHILD_CONSTRAINT', c.id); constraintIds.add(c.id);
      const parentDef = boxMap.get(key(c.boxDefinitionId,c.boxDefinitionVersion));
      if (!parentDef) throw domainError('CONSTRAINT_BOX_NOT_FOUND', c.id);
      const childSchema = schemaMap.get(key(c.childSchemaDefinitionId,c.childSchemaDefinitionVersion));
      if (!childSchema) throw domainError('CONSTRAINT_SCHEMA_NOT_FOUND', c.id);
      if (parentDef.publishedAt && !childSchema.publishedAt) throw domainError('CONSTRAINT_SCHEMA_NOT_PUBLISHED', c.id);
    }
    for (const def of boxDefinitions) {
      if (def.publishedAt) {
        const expected = hash(boxContent(def, childConstraints));
        if (def.contentHash !== expected) throw domainError('PUBLISHED_CONTENT_HASH_MISMATCH', `BoxDefinition ${key(def.id,def.version)} のPublished内容が改変されています`);
      } else if (def.contentHash != null) throw domainError('DRAFT_CONTENT_HASH_NOT_ALLOWED', 'Draft BoxDefinitionにcontentHashを固定できません');
    }

    const eventIds = new Set();
    for (const e of lifecycleHistory) {
      if (eventIds.has(e.id)) throw domainError('DUPLICATE_LIFECYCLE_EVENT', e.id); eventIds.add(e.id);
      const list = e.entityType === 'SCHEMA_DEFINITION' ? schemaMap : boxMap;
      const def = list.get(key(e.entityId,e.entityVersion));
      if (!def || !def.publishedAt) throw domainError('LIFECYCLE_TARGET_NOT_PUBLISHED', e.id);
    }
    for (const def of schemaDefinitions) if (def.publishedAt) lifecycleStatus(state,'SCHEMA_DEFINITION',def.id,def.version);
    for (const def of boxDefinitions) if (def.publishedAt) lifecycleStatus(state,'BOX_DEFINITION',def.id,def.version);

    const nodeIds = new Set(architecture.architectureNodes.map(x => x.id));
    const pathIds = new Set(architecture.pathEntries.map(x => x.id));
    const instanceMap = new Map();
    for (const instance of boxInstances) {
      if (instanceMap.has(instance.id)) throw domainError('DUPLICATE_BOX_INSTANCE', instance.id); instanceMap.set(instance.id,instance);
      const def = boxMap.get(key(instance.boxDefinitionId,instance.boxDefinitionVersion));
      if (!def || !def.publishedAt) throw domainError('BOX_INSTANCE_DEFINITION_NOT_PUBLISHED', instance.id);
      const schema = schemaMap.get(key(def.schemaDefinitionId,def.schemaDefinitionVersion));
      validateConfig(schema, instance.config);
      if (!nodeIds.has(instance.architectureNodeId)) throw domainError('BOX_INSTANCE_NODE_NOT_FOUND', instance.id);
    }
    for (const instance of boxInstances) {
      if (instance.parentBoxInstanceId != null && !instanceMap.has(instance.parentBoxInstanceId)) throw domainError('BOX_INSTANCE_PARENT_NOT_FOUND', instance.id);
    }
    const colors = new Map();
    function visitInstance(id) {
      const color = colors.get(id) || 0; if (color === 1) throw domainError('BOX_INSTANCE_CYCLE', id); if (color === 2) return;
      colors.set(id,1); const parent = instanceMap.get(id).parentBoxInstanceId; if (parent) visitInstance(parent); colors.set(id,2);
    }
    for (const id of instanceMap.keys()) visitInstance(id);

    for (const child of boxInstances.filter(x => x.parentBoxInstanceId != null)) {
      const parent = instanceMap.get(child.parentBoxInstanceId);
      const parentDef = boxMap.get(key(parent.boxDefinitionId,parent.boxDefinitionVersion));
      const childDef = boxMap.get(key(child.boxDefinitionId,child.boxDefinitionVersion));
      const matches = childConstraints.filter(c => c.boxDefinitionId===parentDef.id && c.boxDefinitionVersion===parentDef.version && c.childSchemaDefinitionId===childDef.schemaDefinitionId && c.childSchemaDefinitionVersion===childDef.schemaDefinitionVersion);
      if (!matches.length) throw domainError('CHILD_TYPE_NOT_ALLOWED', `${child.id} は親 ${parent.id} のChildConstraintに一致しません`);
    }
    if (options.enforceRequiredChildren !== false) {
      for (const parent of boxInstances) {
        const def = boxMap.get(key(parent.boxDefinitionId,parent.boxDefinitionVersion));
        const constraints = childConstraints.filter(c => c.boxDefinitionId===def.id && c.boxDefinitionVersion===def.version);
        const children = boxInstances.filter(x => x.parentBoxInstanceId===parent.id);
        for (const c of constraints) {
          const count = children.filter(child => {
            const childDef = boxMap.get(key(child.boxDefinitionId,child.boxDefinitionVersion));
            return childDef.schemaDefinitionId===c.childSchemaDefinitionId && childDef.schemaDefinitionVersion===c.childSchemaDefinitionVersion;
          }).length;
          if (count < c.minCount || (c.maxCount != null && count > c.maxCount)) throw domainError('CHILD_CONSTRAINT_VIOLATION', `${parent.id} の${c.childSchemaDefinitionId}@${c.childSchemaDefinitionVersion}個数 ${count} が ${c.minCount}..${c.maxCount == null ? '*' : c.maxCount} を満たしません`);
        }
      }
    }

    const bindingIds = new Set();
    for (const binding of bindings) {
      if (bindingIds.has(binding.id)) throw domainError('DUPLICATE_BINDING_ID', binding.id); bindingIds.add(binding.id);
      if (!pathIds.has(binding.pathEntryId)) throw domainError('BINDING_PATH_NOT_FOUND', binding.id);
      if (binding.targetType==='NODE' && !nodeIds.has(binding.architectureNodeId)) throw domainError('BINDING_NODE_NOT_FOUND', binding.id);
      if (binding.targetType==='BOX_INSTANCE' && !instanceMap.has(binding.boxInstanceId)) throw domainError('BINDING_BOX_NOT_FOUND', binding.id);
    }
    for (let i=0;i<bindings.length;i++) for (let j=i+1;j<bindings.length;j++) {
      const x=bindings[i], y=bindings[j];
      const xt = x.targetType==='NODE' ? x.architectureNodeId : x.boxInstanceId;
      const yt = y.targetType==='NODE' ? y.architectureNodeId : y.boxInstanceId;
      if (x.pathEntryId===y.pathEntryId && x.targetType===y.targetType && xt===yt && x.relation===y.relation && periodsOverlap(x.activeFromRevision,x.inactiveFromRevision,y.activeFromRevision,y.inactiveFromRevision)) throw domainError('DUPLICATE_BINDING_PERIOD', `${x.id} と ${y.id}`);
    }
    return deepFreeze(state);
  }

  function migrateFromStageA(architectureInput) {
    const architecture = requireArchitecture().validateState(architectureInput);
    const bindings = architecture.bindings.map(b => ({
      type:'ArchitectureBindingV2', id:b.id, projectId:b.projectId, revision:b.revision, pathEntryId:b.pathEntryId,
      targetType:'NODE', architectureNodeId:b.architectureNodeId, boxInstanceId:null, relation:b.relation,
      activeFromRevision:b.activeFromRevision, inactiveFromRevision:b.inactiveFromRevision
    }));
    return validateState({
      type:'StageBBoxRegistry', schemaVersion:SCHEMA_VERSION, migrationVersion:MIGRATION_VERSION,
      architecture, schemaDefinitions:[], boxDefinitions:[], childConstraints:[], boxInstances:[], bindings,
      lifecycleHistory:[], seedVersion:null
    });
  }
  function mutate(stateInput, fn) {
    const draft = clone(validateState(stateInput, { enforceRequiredChildren:false }));
    fn(draft);
    draft.architecture.project.revision += 1;
    return validateState(draft, { enforceRequiredChildren:false });
  }
  function createSchemaDraft(state,input) {
    return mutate(state,draft => {
      const version=assertVersion(input.version); const id=assertId(input.id,'SchemaDefinition.id');
      if (draft.schemaDefinitions.some(x=>x.id===id&&x.version===version)) throw domainError('DEFINITION_VERSION_EXISTS', key(id,version));
      draft.schemaDefinitions.push({ type:'SchemaDefinition',id,version,projectId:draft.architecture.project.id,revision:1,name:assertName(input.name,'SchemaDefinition.name'),fields:(input.fields||[]).map(normalizeField),publishedAt:null,contentHash:null });
    });
  }
  function publishSchemaDefinition(state,id,version,options={}) {
    return mutate(state,draft => {
      const def=draft.schemaDefinitions.find(x=>x.id===id&&x.version===version); if(!def) throw domainError('SCHEMA_DEFINITION_NOT_FOUND',key(id,version));
      if(def.publishedAt) throw domainError('PUBLISHED_DEFINITION_IMMUTABLE',key(id,version));
      def.publishedAt=iso(options.now); def.revision+=1; def.contentHash=hash(schemaContent(def));
    });
  }
  function createBoxDefinitionDraft(state,input) {
    return mutate(state,draft => {
      const version=assertVersion(input.version), id=assertId(input.id,'BoxDefinition.id');
      if(draft.boxDefinitions.some(x=>x.id===id&&x.version===version)) throw domainError('DEFINITION_VERSION_EXISTS',key(id,version));
      const schema=draft.schemaDefinitions.find(x=>x.id===input.schemaDefinitionId&&x.version===Number(input.schemaDefinitionVersion));
      if(!schema||!schema.publishedAt) throw domainError('BOX_SCHEMA_NOT_PUBLISHED',key(input.schemaDefinitionId,input.schemaDefinitionVersion));
      draft.boxDefinitions.push({ type:'BoxDefinition',id,version,projectId:draft.architecture.project.id,revision:1,name:assertName(input.name,'BoxDefinition.name'),schemaDefinitionId:schema.id,schemaDefinitionVersion:schema.version,metadata:canonical(input.metadata||{}),publishedAt:null,contentHash:null });
    });
  }
  function addChildConstraint(state,input) {
    return mutate(state,draft => {
      const parent=draft.boxDefinitions.find(x=>x.id===input.boxDefinitionId&&x.version===Number(input.boxDefinitionVersion));
      if(!parent) throw domainError('BOX_DEFINITION_NOT_FOUND',key(input.boxDefinitionId,input.boxDefinitionVersion));
      if(parent.publishedAt) throw domainError('PUBLISHED_DEFINITION_IMMUTABLE','Published BoxDefinitionのChildConstraintは変更できません');
      const childSchema=draft.schemaDefinitions.find(x=>x.id===input.childSchemaDefinitionId&&x.version===Number(input.childSchemaDefinitionVersion));
      if(!childSchema||!childSchema.publishedAt) throw domainError('CONSTRAINT_SCHEMA_NOT_PUBLISHED','Child SchemaはPublishedが必要です');
      draft.childConstraints.push({ type:'ChildConstraint',id:stableId('child-constraint',input.id),projectId:draft.architecture.project.id,revision:1,boxDefinitionId:parent.id,boxDefinitionVersion:parent.version,childSchemaDefinitionId:childSchema.id,childSchemaDefinitionVersion:childSchema.version,minCount:input.minCount==null?0:input.minCount,maxCount:input.maxCount==null?null:input.maxCount });
    });
  }
  function publishBoxDefinition(state,id,version,options={}) {
    return mutate(state,draft => {
      const def=draft.boxDefinitions.find(x=>x.id===id&&x.version===version); if(!def) throw domainError('BOX_DEFINITION_NOT_FOUND',key(id,version));
      if(def.publishedAt) throw domainError('PUBLISHED_DEFINITION_IMMUTABLE',key(id,version));
      def.publishedAt=iso(options.now); def.revision+=1; def.contentHash=hash(boxContent(def,draft.childConstraints));
    });
  }
  function createNextBoxDefinitionVersion(state,id,fromVersion,input={}) {
    const current=validateState(state,{enforceRequiredChildren:false});
    const from=current.boxDefinitions.find(x=>x.id===id&&x.version===fromVersion); if(!from||!from.publishedAt) throw domainError('PUBLISHED_SOURCE_VERSION_REQUIRED',key(id,fromVersion));
    const nextVersion=fromVersion+1;
    if(current.boxDefinitions.some(x=>x.id===id&&x.version===nextVersion)) throw domainError('DEFINITION_VERSION_EXISTS',key(id,nextVersion));
    return createBoxDefinitionDraft(current,{ id,version:nextVersion,name:input.name==null?from.name:input.name,schemaDefinitionId:input.schemaDefinitionId==null?from.schemaDefinitionId:input.schemaDefinitionId,schemaDefinitionVersion:input.schemaDefinitionVersion==null?from.schemaDefinitionVersion:input.schemaDefinitionVersion,metadata:input.metadata==null?from.metadata:input.metadata });
  }
  function appendLifecycle(state,entityType,id,version,action,options={}) {
    return mutate(state,draft => {
      const list=entityType==='SCHEMA_DEFINITION'?draft.schemaDefinitions:draft.boxDefinitions;
      const def=list.find(x=>x.id===id&&x.version===version); if(!def||!def.publishedAt) throw domainError('LIFECYCLE_TARGET_NOT_PUBLISHED',key(id,version));
      const current=lifecycleStatus(validateState(draft,{enforceRequiredChildren:false}),entityType,id,version);
      if(action==='DEPRECATED'&&current!=='PUBLISHED') throw domainError('INVALID_LIFECYCLE_TRANSITION',`${current}->${action}`);
      if(action==='RETIRED'&&!['PUBLISHED','DEPRECATED'].includes(current)) throw domainError('INVALID_LIFECYCLE_TRANSITION',`${current}->${action}`);
      draft.lifecycleHistory.push({ type:'DefinitionLifecycleEvent',id:stableId('lifecycle',options.id),projectId:draft.architecture.project.id,entityType,entityId:id,entityVersion:version,action,actor:assertId(options.actor||'system','actor'),at:iso(options.now) });
    });
  }
  function deprecateBoxDefinition(state,id,version,options={}) { return appendLifecycle(state,'BOX_DEFINITION',id,version,'DEPRECATED',options); }
  function retireBoxDefinition(state,id,version,options={}) { return appendLifecycle(state,'BOX_DEFINITION',id,version,'RETIRED',options); }
  function createBoxInstance(state,input) {
    const current=validateState(state,{enforceRequiredChildren:false});
    const status=lifecycleStatus(current,'BOX_DEFINITION',input.boxDefinitionId,Number(input.boxDefinitionVersion));
    if(status!=='PUBLISHED') throw domainError('BOX_DEFINITION_NOT_ACTIVE_FOR_NEW_INSTANCE',`${key(input.boxDefinitionId,input.boxDefinitionVersion)} is ${status}`);
    return mutate(current,draft => {
      draft.boxInstances.push({ type:'BoxInstance',id:stableId('box-instance',input.id),projectId:draft.architecture.project.id,revision:1,boxDefinitionId:assertId(input.boxDefinitionId,'BoxInstance.boxDefinitionId'),boxDefinitionVersion:assertVersion(input.boxDefinitionVersion),architectureNodeId:assertId(input.architectureNodeId,'BoxInstance.architectureNodeId'),parentBoxInstanceId:input.parentBoxInstanceId==null?null:assertId(input.parentBoxInstanceId,'BoxInstance.parentBoxInstanceId'),config:canonical(input.config||{}) });
    });
  }
  function addBinding(state,input) {
    return mutate(state,draft => {
      const targetType=String(input.targetType||'').toUpperCase();
      if(!TARGET_TYPES.has(targetType)) throw domainError('INVALID_BINDING_TARGET','targetTypeが不正です');
      if(targetType==='NODE' && input.boxInstanceId!=null) throw domainError('BINDING_TARGET_EXCLUSIVITY','NODE BindingにboxInstanceIdを同時指定できません');
      if(targetType==='BOX_INSTANCE' && input.architectureNodeId!=null) throw domainError('BINDING_TARGET_EXCLUSIVITY','BOX_INSTANCE BindingにarchitectureNodeIdを同時指定できません');
      draft.bindings.push({ type:'ArchitectureBindingV2',id:stableId('architecture-binding',input.id),projectId:draft.architecture.project.id,revision:1,pathEntryId:assertId(input.pathEntryId,'pathEntryId'),targetType,architectureNodeId:targetType==='NODE'?assertId(input.architectureNodeId,'architectureNodeId'):null,boxInstanceId:targetType==='BOX_INSTANCE'?assertId(input.boxInstanceId,'boxInstanceId'):null,relation:String(input.relation||'').toUpperCase(),activeFromRevision:input.activeFromRevision==null?draft.architecture.project.revision+1:input.activeFromRevision,inactiveFromRevision:null });
    });
  }
  function deactivateBinding(state,bindingId,inactiveFromRevision) {
    return mutate(state,draft => {
      const binding=draft.bindings.find(x=>x.id===bindingId); if(!binding) throw domainError('BINDING_NOT_FOUND',bindingId);
      if(binding.inactiveFromRevision!=null) throw domainError('BINDING_ALREADY_INACTIVE',bindingId);
      binding.inactiveFromRevision=inactiveFromRevision==null?draft.architecture.project.revision+1:assertRevision(inactiveFromRevision); binding.revision+=1;
    });
  }
  function bindingDesignNodeId(state,bindingId) {
    const s=validateState(state,{enforceRequiredChildren:false}); const b=s.bindings.find(x=>x.id===bindingId); if(!b) throw domainError('BINDING_NOT_FOUND',bindingId);
    if(b.targetType==='NODE') return b.architectureNodeId;
    return s.boxInstances.find(x=>x.id===b.boxInstanceId).architectureNodeId;
  }

  const SYSTEM_SCHEMA_COMPONENT = { type:'SchemaDefinition',id:'system:schema:component',version:1,revision:1,name:'System Component',fields:[{name:'name',type:'STRING',required:true,enumValues:[]}],publishedAt:'1970-01-01T00:00:00.000Z',contentHash:null };
  const SYSTEM_SCHEMA_LEAF = { type:'SchemaDefinition',id:'system:schema:leaf',version:1,revision:1,name:'System Leaf',fields:[{name:'name',type:'STRING',required:true,enumValues:[]}],publishedAt:'1970-01-01T00:00:00.000Z',contentHash:null };
  function seededRecords(projectId) {
    const schemas=[SYSTEM_SCHEMA_COMPONENT,SYSTEM_SCHEMA_LEAF].map(x=>({ ...clone(x),projectId }));
    for(const s of schemas) s.contentHash=hash(schemaContent(s));
    const constraints=[{ type:'ChildConstraint',id:'system:constraint:component-leaf',projectId,revision:1,boxDefinitionId:'system:box:component',boxDefinitionVersion:1,childSchemaDefinitionId:'system:schema:leaf',childSchemaDefinitionVersion:1,minCount:0,maxCount:null }];
    const boxes=[
      { type:'BoxDefinition',id:'system:box:component',version:1,projectId,revision:1,name:'System Component Box',schemaDefinitionId:'system:schema:component',schemaDefinitionVersion:1,metadata:{system:true},publishedAt:'1970-01-01T00:00:00.000Z',contentHash:null },
      { type:'BoxDefinition',id:'system:box:leaf',version:1,projectId,revision:1,name:'System Leaf Box',schemaDefinitionId:'system:schema:leaf',schemaDefinitionVersion:1,metadata:{system:true},publishedAt:'1970-01-01T00:00:00.000Z',contentHash:null }
    ];
    for(const b of boxes) b.contentHash=hash(boxContent(b,constraints));
    return {schemas,boxes,constraints};
  }
  function seedSystemDefinitions(stateInput) {
    const current=validateState(stateInput,{enforceRequiredChildren:false}); const draft=clone(current); const records=seededRecords(current.architecture.project.id); let changed=false;
    function ensure(list,record,idKeyFn,collisionCode){ const k=idKeyFn(record); const existing=list.find(x=>idKeyFn(x)===k); if(!existing){list.push(record);changed=true;return;} if(stableStringify(existing)!==stableStringify(record)) throw domainError(collisionCode,k); }
    for(const s of records.schemas) ensure(draft.schemaDefinitions,s,x=>key(x.id,x.version),'SYSTEM_SEED_COLLISION');
    for(const b of records.boxes) ensure(draft.boxDefinitions,b,x=>key(x.id,x.version),'SYSTEM_SEED_COLLISION');
    for(const c of records.constraints) ensure(draft.childConstraints,c,x=>x.id,'SYSTEM_SEED_COLLISION');
    if(draft.seedVersion!==SYSTEM_SEED_VERSION){ if(draft.seedVersion!=null) throw domainError('SYSTEM_SEED_VERSION_MISMATCH',draft.seedVersion); draft.seedVersion=SYSTEM_SEED_VERSION; changed=true; }
    if(!changed) return current;
    draft.architecture.project.revision+=1;
    return validateState(draft,{enforceRequiredChildren:false});
  }
  function applyOperation(state,op,options={}) {
    const type=String(op&&op.type||'').toUpperCase();
    switch(type){
      case 'SEED_SYSTEM_DEFINITIONS': return seedSystemDefinitions(state);
      case 'CREATE_SCHEMA_DRAFT': return createSchemaDraft(state,op);
      case 'PUBLISH_SCHEMA': return publishSchemaDefinition(state,op.schemaDefinitionId,Number(op.schemaDefinitionVersion),{now:op.at});
      case 'CREATE_BOX_DRAFT': return createBoxDefinitionDraft(state,op);
      case 'ADD_CHILD_CONSTRAINT': return addChildConstraint(state,op);
      case 'PUBLISH_BOX': return publishBoxDefinition(state,op.boxDefinitionId,Number(op.boxDefinitionVersion),{now:op.at});
      case 'CREATE_NEXT_BOX_VERSION': return createNextBoxDefinitionVersion(state,op.boxDefinitionId,Number(op.fromVersion),op);
      case 'DEPRECATE_BOX': return deprecateBoxDefinition(state,op.boxDefinitionId,Number(op.boxDefinitionVersion),{now:op.at,actor:op.actor||options.actor,id:op.lifecycleEventId});
      case 'RETIRE_BOX': return retireBoxDefinition(state,op.boxDefinitionId,Number(op.boxDefinitionVersion),{now:op.at,actor:op.actor||options.actor,id:op.lifecycleEventId});
      case 'CREATE_BOX_INSTANCE': return createBoxInstance(state,op);
      case 'ADD_BINDING_V2': return addBinding(state,op);
      case 'DEACTIVATE_BINDING_V2': return deactivateBinding(state,op.bindingId,op.inactiveFromRevision);
      default: throw domainError('UNSUPPORTED_BOX_OPERATION',type||'<empty>');
    }
  }
  function assertDirectWriteDisabled() {
    if(!DIRECT_WRITE_ENABLED) throw domainError('BOX_CHANGESET_REQUIRED','Stage Bの永続変更はBoxChangeSet経由で行う必要があります');
    return true;
  }
  function serialize(state) { return stableStringify(validateState(state)); }
  function hydrate(value) { let parsed; try{parsed=typeof value==='string'?JSON.parse(value):clone(value);}catch{throw domainError('INVALID_BOX_JSON','Box Registry JSONを解析できません');} return validateState(parsed); }

  return deepFreeze({
    SCHEMA_VERSION,MIGRATION_VERSION,SYSTEM_SEED_VERSION,DIRECT_WRITE_ENABLED,
    FIELD_TYPES:Object.freeze([...FIELD_TYPES]),BINDING_RELATIONS:Object.freeze([...BINDING_RELATIONS]),TARGET_TYPES:Object.freeze([...TARGET_TYPES]),
    validateState,migrateFromStageA,lifecycleStatus,validateConfig,bindingDesignNodeId,seedSystemDefinitions,
    createSchemaDraft,publishSchemaDefinition,createBoxDefinitionDraft,addChildConstraint,publishBoxDefinition,createNextBoxDefinitionVersion,
    deprecateBoxDefinition,retireBoxDefinition,createBoxInstance,addBinding,deactivateBinding,applyOperation,
    assertDirectWriteDisabled,stableStringify,serialize,hydrate
  });
});