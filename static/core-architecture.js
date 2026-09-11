(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreArchitecture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const PUBLIC_WRITE_ENABLED = false;
  const PATH_KINDS = new Set(['DIRECTORY', 'FILE']);
  const BINDING_RELATIONS = new Set(['IMPLEMENTS', 'TESTS', 'CONFIGURES', 'MIGRATES']);
  const STATE_KEYS = new Set(['type', 'schemaVersion', 'project', 'repositoryScopes', 'architectureNodes', 'pathEntries', 'bindings']);
  const PROJECT_KEYS = new Set(['type', 'id', 'revision', 'name']);
  const REPOSITORY_SCOPE_KEYS = new Set(['repositoryId', 'fullName']);
  const NODE_KEYS = new Set(['type', 'id', 'projectId', 'revision', 'name', 'parentNodeId']);
  const PATH_KEYS = new Set(['type', 'id', 'projectId', 'revision', 'repositoryId', 'kind', 'name', 'parentPathEntryId']);
  const BINDING_KEYS = new Set(['type', 'id', 'projectId', 'revision', 'pathEntryId', 'targetType', 'architectureNodeId', 'relation', 'activeFromRevision', 'inactiveFromRevision']);

  function domainError(code, message) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }

  function assertObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainError(code, `${label} が必要です`);
    return value;
  }

  function assertExactKeys(value, allowed, code, label) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw domainError(code, `${label}.${key} はStage A契約にありません`);
    }
  }

  function assertId(value, field) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) throw domainError('INVALID_ID', `${field} が不正です`);
    return id;
  }

  function assertRevision(value, field) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw domainError('INVALID_REVISION', `${field} は1以上の整数である必要があります`);
    return n;
  }

  function assertRepositoryId(value, field = 'repositoryId') {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) throw domainError('INVALID_REPOSITORY_ID', `${field} は正の整数である必要があります`);
    return n;
  }

  function assertName(value, field, pathName = false) {
    const name = String(value == null ? '' : value).normalize('NFC');
    if (!name.trim() || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) throw domainError('INVALID_NAME', `${field} が不正です`);
    if (pathName && (name === '.' || name === '..' || name.includes('/'))) throw domainError('INVALID_PATH_NAME', `${field} に使用できない名前です`);
    return name;
  }

  function randomUuid() {
    if (root && root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    try {
      if (typeof require === 'function') return require('node:crypto').randomUUID();
    } catch {}
    throw domainError('UUID_UNAVAILABLE', '安定IDを生成できません。idを明示してください');
  }

  function stableId(prefix, supplied) {
    if (supplied != null) return assertId(supplied, `${prefix}.id`);
    return `${prefix}:${randomUuid()}`;
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

  function nodeMap(state) {
    return new Map(state.architectureNodes.map(node => [node.id, node]));
  }

  function pathMap(state) {
    return new Map(state.pathEntries.map(entry => [entry.id, entry]));
  }

  function normalizeProject(project) {
    assertObject(project, 'PROJECT_REQUIRED', 'project');
    assertExactKeys(project, PROJECT_KEYS, 'PROJECT_FIELD_NOT_ALLOWED', 'project');
    if (project.type != null && project.type !== 'Project') throw domainError('INVALID_PROJECT_TYPE', 'project.type はProjectである必要があります');
    return {
      type: 'Project',
      id: assertId(project.id, 'project.id'),
      revision: assertRevision(project.revision == null ? 1 : project.revision, 'project.revision'),
      name: project.name == null ? '' : String(project.name).normalize('NFC')
    };
  }

  function normalizeRepositoryScope(scope) {
    assertObject(scope, 'REPOSITORY_SCOPE_REQUIRED', 'repositoryScope');
    assertExactKeys(scope, REPOSITORY_SCOPE_KEYS, 'REPOSITORY_SCOPE_FIELD_NOT_ALLOWED', 'repositoryScope');
    const fullName = scope.fullName == null ? null : String(scope.fullName).trim();
    if (fullName && !/^[^/\s]+\/[^/\s]+$/.test(fullName)) throw domainError('INVALID_REPOSITORY_SCOPE', 'repositoryScope.fullName はowner/name形式である必要があります');
    return { repositoryId: assertRepositoryId(scope.repositoryId), fullName };
  }

  function normalizeNode(node, projectId) {
    assertObject(node, 'ARCHITECTURE_NODE_REQUIRED', 'ArchitectureNode');
    assertExactKeys(node, NODE_KEYS, 'ARCHITECTURE_NODE_FIELD_NOT_ALLOWED', 'ArchitectureNode');
    if (node.type != null && node.type !== 'ArchitectureNode') throw domainError('INVALID_NODE_TYPE', 'ArchitectureNode.typeが不正です');
    const pid = assertId(node.projectId, 'ArchitectureNode.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'ArchitectureNodeが別Projectを参照しています');
    return {
      type: 'ArchitectureNode',
      id: assertId(node.id, 'ArchitectureNode.id'),
      projectId: pid,
      revision: assertRevision(node.revision, 'ArchitectureNode.revision'),
      name: assertName(node.name, 'ArchitectureNode.name'),
      parentNodeId: node.parentNodeId == null ? null : assertId(node.parentNodeId, 'ArchitectureNode.parentNodeId')
    };
  }

  function normalizePathEntry(entry, projectId) {
    assertObject(entry, 'PATH_ENTRY_REQUIRED', 'PathEntry');
    assertExactKeys(entry, PATH_KEYS, 'PATH_ENTRY_FIELD_NOT_ALLOWED', 'PathEntry');
    if (entry.type != null && entry.type !== 'PathEntry') throw domainError('INVALID_PATH_TYPE', 'PathEntry.typeが不正です');
    const pid = assertId(entry.projectId, 'PathEntry.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'PathEntryが別Projectを参照しています');
    const kind = String(entry.kind || '').toUpperCase();
    if (!PATH_KINDS.has(kind)) throw domainError('INVALID_PATH_KIND', 'PathEntry.kind はDIRECTORYまたはFILEである必要があります');
    return {
      type: 'PathEntry',
      id: assertId(entry.id, 'PathEntry.id'),
      projectId: pid,
      revision: assertRevision(entry.revision, 'PathEntry.revision'),
      repositoryId: assertRepositoryId(entry.repositoryId, 'PathEntry.repositoryId'),
      kind,
      name: assertName(entry.name, 'PathEntry.name', true),
      parentPathEntryId: entry.parentPathEntryId == null ? null : assertId(entry.parentPathEntryId, 'PathEntry.parentPathEntryId')
    };
  }

  function normalizeBinding(binding, projectId) {
    assertObject(binding, 'BINDING_REQUIRED', 'ArchitectureBinding');
    assertExactKeys(binding, BINDING_KEYS, 'BINDING_FIELD_NOT_ALLOWED', 'ArchitectureBinding');
    if (binding.type != null && binding.type !== 'ArchitectureBinding') throw domainError('INVALID_BINDING_TYPE', 'ArchitectureBinding.typeが不正です');
    const pid = assertId(binding.projectId, 'ArchitectureBinding.projectId');
    if (pid !== projectId) throw domainError('PROJECT_SCOPE_VIOLATION', 'ArchitectureBindingが別Projectを参照しています');
    const targetType = String(binding.targetType || 'NODE').toUpperCase();
    if (targetType !== 'NODE') throw domainError('BOX_BINDING_NOT_ALLOWED', 'Stage AのArchitectureBindingはNODEだけを参照できます');
    const relation = String(binding.relation || '').toUpperCase();
    if (!BINDING_RELATIONS.has(relation)) throw domainError('INVALID_BINDING_RELATION', 'ArchitectureBinding.relationが不正です');
    const active = assertRevision(binding.activeFromRevision == null ? 1 : binding.activeFromRevision, 'ArchitectureBinding.activeFromRevision');
    let inactive = null;
    if (binding.inactiveFromRevision != null) {
      inactive = assertRevision(binding.inactiveFromRevision, 'ArchitectureBinding.inactiveFromRevision');
      if (inactive <= active) throw domainError('INVALID_BINDING_PERIOD', 'inactiveFromRevisionはactiveFromRevisionより後である必要があります');
    }
    return {
      type: 'ArchitectureBinding',
      id: assertId(binding.id, 'ArchitectureBinding.id'),
      projectId: pid,
      revision: assertRevision(binding.revision, 'ArchitectureBinding.revision'),
      pathEntryId: assertId(binding.pathEntryId, 'ArchitectureBinding.pathEntryId'),
      targetType: 'NODE',
      architectureNodeId: assertId(binding.architectureNodeId, 'ArchitectureBinding.architectureNodeId'),
      relation,
      activeFromRevision: active,
      inactiveFromRevision: inactive
    };
  }

  function periodsOverlap(aStart, aEnd, bStart, bEnd) {
    const aMax = aEnd == null ? Infinity : aEnd;
    const bMax = bEnd == null ? Infinity : bEnd;
    return aStart < bMax && bStart < aMax;
  }

  function validateState(input) {
    assertObject(input, 'ARCHITECTURE_STATE_REQUIRED', 'ProjectArchitecture');
    assertExactKeys(input, STATE_KEYS, 'ARCHITECTURE_STATE_FIELD_NOT_ALLOWED', 'ProjectArchitecture');
    if (input.type != null && input.type !== 'ProjectArchitecture') throw domainError('INVALID_ARCHITECTURE_STATE_TYPE', 'typeはProjectArchitectureである必要があります');
    if (input.schemaVersion != null && Number(input.schemaVersion) !== SCHEMA_VERSION) throw domainError('UNSUPPORTED_ARCHITECTURE_SCHEMA', `schemaVersion ${input.schemaVersion} は未対応です`);

    const project = normalizeProject(input.project);
    const repositoryScopes = (input.repositoryScopes || []).map(normalizeRepositoryScope);
    const architectureNodes = (input.architectureNodes || []).map(node => normalizeNode(node, project.id));
    const pathEntries = (input.pathEntries || []).map(entry => normalizePathEntry(entry, project.id));
    const bindings = (input.bindings || []).map(binding => normalizeBinding(binding, project.id));
    const state = { type: 'ProjectArchitecture', schemaVersion: SCHEMA_VERSION, project, repositoryScopes, architectureNodes, pathEntries, bindings };

    const repoIds = new Set();
    for (const scope of repositoryScopes) {
      if (repoIds.has(scope.repositoryId)) throw domainError('DUPLICATE_REPOSITORY_SCOPE', `repositoryId ${scope.repositoryId} が重複しています`);
      repoIds.add(scope.repositoryId);
    }

    const nodes = new Map();
    for (const node of architectureNodes) {
      if (nodes.has(node.id)) throw domainError('DUPLICATE_STABLE_ID', `ArchitectureNode ${node.id} が重複しています`);
      nodes.set(node.id, node);
    }
    for (const node of architectureNodes) {
      if (node.parentNodeId != null && !nodes.has(node.parentNodeId)) throw domainError('NODE_PARENT_NOT_FOUND', `${node.id} の親Nodeが存在しません`);
    }
    const nodeSiblingNames = new Set();
    for (const node of architectureNodes) {
      const key = `${node.parentNodeId || '<root>'}\u0000${node.name}`;
      if (nodeSiblingNames.has(key)) throw domainError('NODE_NAME_COLLISION', `同一親にArchitectureNode名 ${node.name} が重複しています`);
      nodeSiblingNames.add(key);
    }
    const nodeColors = new Map();
    function visitNode(id) {
      const color = nodeColors.get(id) || 0;
      if (color === 1) throw domainError('NODE_CYCLE', `ArchitectureNode ${id} に循環があります`);
      if (color === 2) return;
      nodeColors.set(id, 1);
      const parent = nodes.get(id).parentNodeId;
      if (parent != null) visitNode(parent);
      nodeColors.set(id, 2);
    }
    for (const id of nodes.keys()) visitNode(id);

    const paths = new Map();
    for (const entry of pathEntries) {
      if (paths.has(entry.id)) throw domainError('DUPLICATE_STABLE_ID', `PathEntry ${entry.id} が重複しています`);
      if (!repoIds.has(entry.repositoryId)) throw domainError('REPOSITORY_SCOPE_VIOLATION', `PathEntry ${entry.id} のRepositoryはProject範囲外です`);
      paths.set(entry.id, entry);
    }
    for (const entry of pathEntries) {
      if (entry.parentPathEntryId == null) continue;
      const parent = paths.get(entry.parentPathEntryId);
      if (!parent) throw domainError('PATH_PARENT_NOT_FOUND', `${entry.id} の親PathEntryが存在しません`);
      if (parent.repositoryId !== entry.repositoryId) throw domainError('CROSS_REPOSITORY_MOVE', 'PathEntryの親子は同一Repositoryである必要があります');
      if (parent.kind !== 'DIRECTORY') throw domainError('FILE_PARENT_NOT_ALLOWED', `FILE ${parent.id} を親にできません`);
    }
    const pathSiblingNames = new Set();
    for (const entry of pathEntries) {
      const key = `${entry.repositoryId}\u0000${entry.parentPathEntryId || '<root>'}\u0000${entry.name}`;
      if (pathSiblingNames.has(key)) throw domainError('PATH_NAME_COLLISION', `同一親にPathEntry名 ${entry.name} が重複しています`);
      pathSiblingNames.add(key);
    }
    const pathColors = new Map();
    function visitPath(id) {
      const color = pathColors.get(id) || 0;
      if (color === 1) throw domainError('PATH_CYCLE', `PathEntry ${id} に循環があります`);
      if (color === 2) return;
      pathColors.set(id, 1);
      const parent = paths.get(id).parentPathEntryId;
      if (parent != null) visitPath(parent);
      pathColors.set(id, 2);
    }
    for (const id of paths.keys()) visitPath(id);

    const bindingIds = new Set();
    for (const binding of bindings) {
      if (bindingIds.has(binding.id)) throw domainError('DUPLICATE_STABLE_ID', `ArchitectureBinding ${binding.id} が重複しています`);
      bindingIds.add(binding.id);
      if (!paths.has(binding.pathEntryId)) throw domainError('BINDING_PATH_NOT_FOUND', `${binding.id} のPathEntryが存在しません`);
      if (!nodes.has(binding.architectureNodeId)) throw domainError('BINDING_NODE_NOT_FOUND', `${binding.id} のArchitectureNodeが存在しません`);
    }
    for (let i = 0; i < bindings.length; i += 1) {
      const a = bindings[i];
      for (let j = i + 1; j < bindings.length; j += 1) {
        const b = bindings[j];
        if (a.pathEntryId === b.pathEntryId && a.architectureNodeId === b.architectureNodeId && a.relation === b.relation &&
          periodsOverlap(a.activeFromRevision, a.inactiveFromRevision, b.activeFromRevision, b.inactiveFromRevision)) {
          throw domainError('DUPLICATE_BINDING_PERIOD', `Binding ${a.id} と ${b.id} の有効期間が重複しています`);
        }
      }
    }
    return deepFreeze(state);
  }

  function createProjectArchitecture(options = {}) {
    const projectId = assertId(options.projectId, 'projectId');
    const repositoryScopes = (options.repositoryScopes || []).map(scope => ({ repositoryId: scope.repositoryId, fullName: scope.fullName == null ? null : scope.fullName }));
    return validateState({
      type: 'ProjectArchitecture', schemaVersion: SCHEMA_VERSION,
      project: { type: 'Project', id: projectId, revision: options.revision == null ? 1 : options.revision, name: options.name == null ? '' : options.name },
      repositoryScopes, architectureNodes: [], pathEntries: [], bindings: []
    });
  }

  function mutateState(state, mutate) {
    const draft = clone(validateState(state));
    mutate(draft);
    draft.project.revision += 1;
    return validateState(draft);
  }

  function addArchitectureNode(state, input) {
    return mutateState(state, draft => {
      draft.architectureNodes.push({
        type: 'ArchitectureNode', id: stableId('architecture-node', input && input.id), projectId: draft.project.id, revision: 1,
        name: assertName(input && input.name, 'ArchitectureNode.name'),
        parentNodeId: input && input.parentNodeId != null ? assertId(input.parentNodeId, 'ArchitectureNode.parentNodeId') : null
      });
    });
  }

  function renameArchitectureNode(state, nodeId, name) {
    const id = assertId(nodeId, 'nodeId');
    return mutateState(state, draft => {
      const node = draft.architectureNodes.find(item => item.id === id);
      if (!node) throw domainError('NODE_NOT_FOUND', `ArchitectureNode ${id} が存在しません`);
      node.name = assertName(name, 'ArchitectureNode.name'); node.revision += 1;
    });
  }

  function moveArchitectureNode(state, nodeId, parentNodeId) {
    const id = assertId(nodeId, 'nodeId');
    const parentId = parentNodeId == null ? null : assertId(parentNodeId, 'parentNodeId');
    if (parentId === id) throw domainError('NODE_CYCLE', 'ArchitectureNodeを自分自身の子へ移動できません');
    return mutateState(state, draft => {
      const node = draft.architectureNodes.find(item => item.id === id);
      if (!node) throw domainError('NODE_NOT_FOUND', `ArchitectureNode ${id} が存在しません`);
      if (parentId != null && !draft.architectureNodes.some(item => item.id === parentId)) throw domainError('NODE_PARENT_NOT_FOUND', `${parentId} が存在しません`);
      node.parentNodeId = parentId; node.revision += 1;
    });
  }

  function addPathEntry(state, input) {
    return mutateState(state, draft => {
      draft.pathEntries.push({
        type: 'PathEntry', id: stableId('path-entry', input && input.id), projectId: draft.project.id, revision: 1,
        repositoryId: assertRepositoryId(input && input.repositoryId), kind: String(input && input.kind || '').toUpperCase(),
        name: assertName(input && input.name, 'PathEntry.name', true),
        parentPathEntryId: input && input.parentPathEntryId != null ? assertId(input.parentPathEntryId, 'PathEntry.parentPathEntryId') : null
      });
    });
  }

  function renamePathEntry(state, pathEntryId, name) {
    const id = assertId(pathEntryId, 'pathEntryId');
    return mutateState(state, draft => {
      const entry = draft.pathEntries.find(item => item.id === id);
      if (!entry) throw domainError('PATH_ENTRY_NOT_FOUND', `PathEntry ${id} が存在しません`);
      entry.name = assertName(name, 'PathEntry.name', true); entry.revision += 1;
    });
  }

  function movePathEntry(state, pathEntryId, parentPathEntryId) {
    const id = assertId(pathEntryId, 'pathEntryId');
    const parentId = parentPathEntryId == null ? null : assertId(parentPathEntryId, 'parentPathEntryId');
    if (parentId === id) throw domainError('PATH_CYCLE', 'PathEntryを自分自身の子へ移動できません');
    return mutateState(state, draft => {
      const entry = draft.pathEntries.find(item => item.id === id);
      if (!entry) throw domainError('PATH_ENTRY_NOT_FOUND', `PathEntry ${id} が存在しません`);
      if (parentId != null) {
        const parent = draft.pathEntries.find(item => item.id === parentId);
        if (!parent) throw domainError('PATH_PARENT_NOT_FOUND', `${parentId} が存在しません`);
        if (parent.repositoryId !== entry.repositoryId) throw domainError('CROSS_REPOSITORY_MOVE', 'Repositoryを跨ぐPathEntry移動はMVPでは拒否します');
        if (parent.kind !== 'DIRECTORY') throw domainError('FILE_PARENT_NOT_ALLOWED', 'FILEをPathEntryの親にできません');
      }
      entry.parentPathEntryId = parentId; entry.revision += 1;
    });
  }

  function addBinding(state, input) {
    return mutateState(state, draft => {
      if (input && ('boxInstanceId' in input || 'boxId' in input || String(input.targetType || 'NODE').toUpperCase() !== 'NODE')) {
        throw domainError('BOX_BINDING_NOT_ALLOWED', 'Stage AではBoxへのBindingを作成できません');
      }
      draft.bindings.push({
        type: 'ArchitectureBinding', id: stableId('architecture-binding', input && input.id), projectId: draft.project.id, revision: 1,
        pathEntryId: assertId(input && input.pathEntryId, 'ArchitectureBinding.pathEntryId'), targetType: 'NODE',
        architectureNodeId: assertId(input && input.architectureNodeId, 'ArchitectureBinding.architectureNodeId'),
        relation: String(input && input.relation || '').toUpperCase(),
        activeFromRevision: input && input.activeFromRevision != null ? input.activeFromRevision : draft.project.revision + 1,
        inactiveFromRevision: null
      });
    });
  }

  function deactivateBinding(state, bindingId, inactiveFromRevision) {
    const id = assertId(bindingId, 'bindingId');
    return mutateState(state, draft => {
      const binding = draft.bindings.find(item => item.id === id);
      if (!binding) throw domainError('BINDING_NOT_FOUND', `ArchitectureBinding ${id} が存在しません`);
      if (binding.inactiveFromRevision != null) throw domainError('BINDING_ALREADY_INACTIVE', `${id} は既に無効です`);
      binding.inactiveFromRevision = inactiveFromRevision == null ? draft.project.revision + 1 : assertRevision(inactiveFromRevision, 'inactiveFromRevision');
      binding.revision += 1;
    });
  }

  function derivePath(state, pathEntryId) {
    const validated = validateState(state); const paths = pathMap(validated); const id = assertId(pathEntryId, 'pathEntryId');
    const entry = paths.get(id); if (!entry) throw domainError('PATH_ENTRY_NOT_FOUND', `PathEntry ${id} が存在しません`);
    const parts = []; let cursor = entry;
    while (cursor) { parts.push(cursor.name); cursor = cursor.parentPathEntryId == null ? null : paths.get(cursor.parentPathEntryId); }
    return parts.reverse().join('/');
  }

  function descendants(state, id, records, parentField, notFoundCode) {
    const validated = validateState(state); const source = records(validated); const key = assertId(id, 'id');
    if (!source.some(item => item.id === key)) throw domainError(notFoundCode, `${key} が存在しません`);
    const out = [], queue = [key];
    while (queue.length) {
      const parent = queue.shift();
      for (const item of source) if (item[parentField] === parent) { out.push(item.id); queue.push(item.id); }
    }
    return out;
  }

  function descendantNodeIds(state, nodeId) { return descendants(state, nodeId, s => s.architectureNodes, 'parentNodeId', 'NODE_NOT_FOUND'); }
  function descendantPathEntryIds(state, pathEntryId) { return descendants(state, pathEntryId, s => s.pathEntries, 'parentPathEntryId', 'PATH_ENTRY_NOT_FOUND'); }

  function serialize(state) { return JSON.stringify(canonical(validateState(state))); }
  function hydrate(serialized) {
    let parsed; try { parsed = typeof serialized === 'string' ? JSON.parse(serialized) : clone(serialized); }
    catch { throw domainError('INVALID_ARCHITECTURE_JSON', 'Architecture JSONを解析できません'); }
    return validateState(parsed);
  }

  function assertPublicWriteEnabled() {
    if (!PUBLIC_WRITE_ENABLED) throw domainError('STRUCTURE_WRITE_LOCKED_UNTIL_A04', 'A-04のChangeSet/atomic Apply完成まで構造変更の公開書込みは無効です');
    return true;
  }

  return deepFreeze({
    SCHEMA_VERSION, PUBLIC_WRITE_ENABLED,
    PATH_KINDS: Object.freeze([...PATH_KINDS]), BINDING_RELATIONS: Object.freeze([...BINDING_RELATIONS]),
    validateState, createProjectArchitecture, addArchitectureNode, renameArchitectureNode, moveArchitectureNode,
    addPathEntry, renamePathEntry, movePathEntry, addBinding, deactivateBinding, derivePath,
    descendantNodeIds, descendantPathEntryIds, serialize, hydrate, assertPublicWriteEnabled
  });
});
