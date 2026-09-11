const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../static/core-architecture.js');

function base(scopes = [{ repositoryId: 10, fullName: 'acme/app' }]) {
  return core.createProjectArchitecture({ projectId: 'project-1', name: 'P', repositoryScopes: scopes });
}

function withNodeTree() {
  let s = base();
  s = core.addArchitectureNode(s, { id: 'node-root', name: 'Root' });
  s = core.addArchitectureNode(s, { id: 'node-child', name: 'Child', parentNodeId: 'node-root' });
  s = core.addArchitectureNode(s, { id: 'node-leaf', name: 'Leaf', parentNodeId: 'node-child' });
  return s;
}

function withPathTree() {
  let s = base();
  s = core.addPathEntry(s, { id: 'path-src', repositoryId: 10, kind: 'DIRECTORY', name: 'src' });
  s = core.addPathEntry(s, { id: 'path-lib', repositoryId: 10, kind: 'DIRECTORY', name: 'lib', parentPathEntryId: 'path-src' });
  s = core.addPathEntry(s, { id: 'path-file', repositoryId: 10, kind: 'FILE', name: 'a.js', parentPathEntryId: 'path-lib' });
  return s;
}

test('Project and entity revisions advance while stable IDs survive rename and move', () => {
  let s = withNodeTree();
  const before = s.project.revision;
  s = core.renameArchitectureNode(s, 'node-child', 'Renamed');
  s = core.moveArchitectureNode(s, 'node-child', null);
  const child = s.architectureNodes.find(n => n.id === 'node-child');
  const leaf = s.architectureNodes.find(n => n.id === 'node-leaf');
  assert.equal(child.id, 'node-child');
  assert.equal(child.revision, 3);
  assert.equal(leaf.parentNodeId, 'node-child');
  assert.equal(s.project.revision, before + 2);
  assert.deepEqual(core.descendantNodeIds(s, 'node-child'), ['node-leaf']);
});

test('ArchitectureNode self/descendant cycles are rejected', () => {
  const s = withNodeTree();
  assert.throws(() => core.moveArchitectureNode(s, 'node-root', 'node-root'), /NODE_CYCLE/);
  assert.throws(() => core.moveArchitectureNode(s, 'node-root', 'node-leaf'), /NODE_CYCLE/);
});

test('ArchitectureNode sibling name collisions are rejected', () => {
  let s = base();
  s = core.addArchitectureNode(s, { id: 'n1', name: 'API' });
  assert.throws(() => core.addArchitectureNode(s, { id: 'n2', name: 'API' }), /NODE_NAME_COLLISION/);
});

test('PathEntry rejects FILE parents and invalid path names', () => {
  let s = base();
  s = core.addPathEntry(s, { id: 'file', repositoryId: 10, kind: 'FILE', name: 'a.js' });
  assert.throws(() => core.addPathEntry(s, { id: 'child', repositoryId: 10, kind: 'FILE', name: 'b.js', parentPathEntryId: 'file' }), /FILE_PARENT_NOT_ALLOWED/);
  assert.throws(() => core.addPathEntry(s, { id: 'bad', repositoryId: 10, kind: 'FILE', name: '../x' }), /INVALID_PATH_NAME/);
});

test('PathEntry move/rename changes derived path but preserves stable IDs and descendants', () => {
  let s = withPathTree();
  s = core.addPathEntry(s, { id: 'path-other', repositoryId: 10, kind: 'DIRECTORY', name: 'other' });
  assert.equal(core.derivePath(s, 'path-file'), 'src/lib/a.js');
  s = core.movePathEntry(s, 'path-lib', 'path-other');
  s = core.renamePathEntry(s, 'path-lib', 'shared');
  assert.equal(core.derivePath(s, 'path-file'), 'other/shared/a.js');
  assert.deepEqual(core.descendantPathEntryIds(s, 'path-lib'), ['path-file']);
  assert.equal(s.pathEntries.find(p => p.id === 'path-file').parentPathEntryId, 'path-lib');
});

test('PathEntry cycles and cross-repository moves are rejected', () => {
  let s = core.createProjectArchitecture({
    projectId: 'project-1',
    repositoryScopes: [{ repositoryId: 10, fullName: 'acme/a' }, { repositoryId: 20, fullName: 'acme/b' }]
  });
  s = core.addPathEntry(s, { id: 'a', repositoryId: 10, kind: 'DIRECTORY', name: 'a' });
  s = core.addPathEntry(s, { id: 'b', repositoryId: 10, kind: 'DIRECTORY', name: 'b', parentPathEntryId: 'a' });
  s = core.addPathEntry(s, { id: 'other', repositoryId: 20, kind: 'DIRECTORY', name: 'other' });
  assert.throws(() => core.movePathEntry(s, 'a', 'b'), /PATH_CYCLE/);
  assert.throws(() => core.movePathEntry(s, 'b', 'other'), /CROSS_REPOSITORY_MOVE/);
});

test('PathEntry sibling collisions and repository scope violations are rejected', () => {
  let s = base();
  s = core.addPathEntry(s, { id: 'a', repositoryId: 10, kind: 'DIRECTORY', name: 'src' });
  assert.throws(() => core.addPathEntry(s, { id: 'b', repositoryId: 10, kind: 'DIRECTORY', name: 'src' }), /PATH_NAME_COLLISION/);
  assert.throws(() => core.addPathEntry(s, { id: 'x', repositoryId: 999, kind: 'FILE', name: 'x' }), /REPOSITORY_SCOPE_VIOLATION/);
});

test('ArchitectureBinding requires same-project existing Node and Path', () => {
  let s = base();
  s = core.addArchitectureNode(s, { id: 'n', name: 'N' });
  s = core.addPathEntry(s, { id: 'p', repositoryId: 10, kind: 'FILE', name: 'n.js' });
  assert.throws(() => core.addBinding(s, { id: 'bad-path', pathEntryId: 'missing', architectureNodeId: 'n', relation: 'IMPLEMENTS' }), /BINDING_PATH_NOT_FOUND/);
  assert.throws(() => core.addBinding(s, { id: 'bad-node', pathEntryId: 'p', architectureNodeId: 'missing', relation: 'IMPLEMENTS' }), /BINDING_NODE_NOT_FOUND/);
  s = core.addBinding(s, { id: 'bind', pathEntryId: 'p', architectureNodeId: 'n', relation: 'IMPLEMENTS' });
  assert.equal(s.bindings[0].targetType, 'NODE');
});

test('Stage A rejects Box bindings and unknown relations', () => {
  let s = base();
  s = core.addArchitectureNode(s, { id: 'n', name: 'N' });
  s = core.addPathEntry(s, { id: 'p', repositoryId: 10, kind: 'FILE', name: 'n.js' });
  assert.throws(() => core.addBinding(s, { id: 'box', pathEntryId: 'p', architectureNodeId: 'n', targetType: 'BOX', boxInstanceId: 'b', relation: 'IMPLEMENTS' }), /BOX_BINDING_NOT_ALLOWED/);
  assert.throws(() => core.addBinding(s, { id: 'r', pathEntryId: 'p', architectureNodeId: 'n', relation: 'UNKNOWN' }), /INVALID_BINDING_RELATION/);
});

test('Binding duplicate active periods are rejected and historical rows remain after deactivation', () => {
  let s = base();
  s = core.addArchitectureNode(s, { id: 'n', name: 'N' });
  s = core.addPathEntry(s, { id: 'p', repositoryId: 10, kind: 'FILE', name: 'n.js' });
  s = core.addBinding(s, { id: 'b1', pathEntryId: 'p', architectureNodeId: 'n', relation: 'IMPLEMENTS', activeFromRevision: 1 });
  assert.throws(() => core.addBinding(s, { id: 'b2', pathEntryId: 'p', architectureNodeId: 'n', relation: 'IMPLEMENTS', activeFromRevision: 2 }), /DUPLICATE_BINDING_PERIOD/);
  s = core.deactivateBinding(s, 'b1', 10);
  s = core.addBinding(s, { id: 'b2', pathEntryId: 'p', architectureNodeId: 'n', relation: 'IMPLEMENTS', activeFromRevision: 10 });
  assert.equal(s.bindings.length, 2);
  assert.equal(s.bindings.find(b => b.id === 'b1').inactiveFromRevision, 10);
});

test('hydrate rejects cross-project and injected Stage B fields', () => {
  const s = withNodeTree();
  const badProject = JSON.parse(core.serialize(s));
  badProject.architectureNodes[0].projectId = 'project-2';
  assert.throws(() => core.hydrate(badProject), /PROJECT_SCOPE_VIOLATION/);

  let b = base();
  b = core.addArchitectureNode(b, { id: 'n', name: 'N' });
  b = core.addPathEntry(b, { id: 'p', repositoryId: 10, kind: 'FILE', name: 'n.js' });
  b = core.addBinding(b, { id: 'bind', pathEntryId: 'p', architectureNodeId: 'n', relation: 'IMPLEMENTS' });
  const injected = JSON.parse(core.serialize(b));
  injected.bindings[0].boxInstanceId = 'box-1';
  assert.throws(() => core.hydrate(injected), /BINDING_FIELD_NOT_ALLOWED/);
});

test('serialization round-trips deterministically and returns frozen state', () => {
  const s = withPathTree();
  const encoded = core.serialize(s);
  const h = core.hydrate(encoded);
  assert.equal(core.serialize(h), encoded);
  assert.ok(Object.isFrozen(h));
  assert.ok(Object.isFrozen(h.pathEntries[0]));
});

test('public structural writes remain locked until A-04', () => {
  assert.equal(core.PUBLIC_WRITE_ENABLED, false);
  assert.throws(() => core.assertPublicWriteEnabled(), /STRUCTURE_WRITE_LOCKED_UNTIL_A04/);
});
