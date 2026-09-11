(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.TSUGUCoreGuard = api;
    api.install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const ACTOR_SOURCE = 'github:/user';
  const PERMISSION_SOURCE = 'github_repository_permission';
  const SECURITY_VERSION = 1;
  const ACTOR_KEYS = new Set([
    'actorLogin', 'actor_login', 'approvedBy', 'createdBy', 'updatedBy',
    'requestedBy', 'performedBy', 'waivedBy', 'decidedBy'
  ]);
  const SYSTEM_FIELDS = ['actors', 'permissions', 'auditEvents'];

  const runtime = {
    installed: false,
    nativeFetch: null,
    user: null,
    repositories: new Map(),
    latestByPath: new Map()
  };

  function guardError(code, message) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function base64ToText(b64) {
    const clean = String(b64 || '').replace(/\n/g, '');
    if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function textToBase64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  function actorId(user) {
    if (!user || !user.login) throw guardError('ACTOR_UNKNOWN', 'GitHub /user で認証主体を確認できていません');
    return Number.isInteger(user.id) || typeof user.id === 'number'
      ? `github:${user.id}`
      : `github-login:${user.login}`;
  }

  function deriveRole(repoMeta) {
    const p = repoMeta && repoMeta.permissions ? repoMeta.permissions : {};
    if (p.admin === true || p.maintain === true) return 'PROJECT_ADMIN';
    if (p.push === true) return 'EDITOR';
    return 'VIEWER';
  }

  function parseProjectEndpoint(input) {
    const raw = typeof input === 'string' ? input : input && input.url;
    if (!raw) return null;
    let url;
    try { url = new URL(raw, root && root.location ? root.location.href : 'https://example.invalid/'); }
    catch { return null; }
    if (url.hostname !== 'api.github.com') return null;
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/data\/projects\/([^/]+)\.json$/);
    if (!m) return null;
    return {
      owner: decodeURIComponent(m[1]),
      repo: decodeURIComponent(m[2]),
      projectId: decodeURIComponent(m[3]),
      path: `data/projects/${decodeURIComponent(m[3])}.json`,
      key: `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}:data/projects/${decodeURIComponent(m[3])}.json`
    };
  }

  function parseRepoEndpoint(input) {
    const raw = typeof input === 'string' ? input : input && input.url;
    if (!raw) return null;
    let url;
    try { url = new URL(raw, root && root.location ? root.location.href : 'https://example.invalid/'); }
    catch { return null; }
    if (url.hostname !== 'api.github.com') return null;
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    return m ? `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}` : null;
  }

  function nestedScopeIssues(value, expectedProjectId, trail = '$', seen = new Set()) {
    const issues = [];
    if (!value || typeof value !== 'object') return issues;
    if (seen.has(value)) return issues;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => issues.push(...nestedScopeIssues(v, expectedProjectId, `${trail}[${i}]`, seen)));
      return issues;
    }
    for (const [key, v] of Object.entries(value)) {
      if ((key === 'projectId' || key === 'project_id') && v != null && String(v) !== expectedProjectId) {
        issues.push(`${trail}.${key}=${String(v)}`);
      }
      issues.push(...nestedScopeIssues(v, expectedProjectId, `${trail}.${key}`, seen));
    }
    return issues;
  }

  function collectActorChanges(previous, next, trail = '$', out = []) {
    if (!next || typeof next !== 'object') return out;
    if (Array.isArray(next)) {
      next.forEach((value, index) => collectActorChanges(Array.isArray(previous) ? previous[index] : undefined, value, `${trail}[${index}]`, out));
      return out;
    }
    for (const [key, value] of Object.entries(next)) {
      const before = previous && typeof previous === 'object' ? previous[key] : undefined;
      if (ACTOR_KEYS.has(key) && value != null && value !== '' && JSON.stringify(value) !== JSON.stringify(before)) {
        out.push({ path: `${trail}.${key}`, value });
      }
      collectActorChanges(before, value, `${trail}.${key}`, out);
    }
    return out;
  }

  function sameJson(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  function assertSystemFieldsUntampered(previousProject, nextProject) {
    const prevCore = previousProject && previousProject.core ? previousProject.core : {};
    const nextCore = nextProject && nextProject.core ? nextProject.core : {};
    for (const field of SYSTEM_FIELDS) {
      const before = prevCore[field];
      const after = nextCore[field];
      if (previousProject) {
        // The legacy UI does not receive Guard-injected fields in the PUT response,
        // so omission is treated as "preserve server value". Explicit replacement is rejected.
        if (after !== undefined && after !== null && !sameJson(before, after)) {
          throw guardError('SYSTEM_MANAGED_FIELD', `core.${field} はCore Guard管理のため直接変更できません`);
        }
      } else if (Array.isArray(after) && after.length) {
        throw guardError('SYSTEM_MANAGED_FIELD', `新規案件で core.${field} を事前設定できません`);
      }
    }
  }

  function assertActorChanges(previousProject, nextProject, login, role) {
    const changes = collectActorChanges(previousProject, nextProject);
    for (const change of changes) {
      if (typeof change.value === 'string' && change.value !== login) {
        throw guardError('ACTOR_SPOOF', `${change.path} は認証済みGitHub主体 ${login} と一致しません`);
      }
      if ((change.path.endsWith('.approvedBy') || change.path.endsWith('.waivedBy')) && role !== 'PROJECT_ADMIN') {
        throw guardError('PERMISSION_DENIED', `${change.path} の操作には PROJECT_ADMIN が必要です`);
      }
    }
  }

  function canonicalHashPayload(record) {
    const copy = clone(record);
    if (copy && copy.project && copy.project.core) {
      delete copy.project.core.auditEvents;
      delete copy.project.core.actors;
      delete copy.project.core.permissions;
    }
    return JSON.stringify(copy);
  }

  async function sha256Hex(text) {
    if (root && root.crypto && root.crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') return require('node:crypto').createHash('sha256').update(text).digest('hex');
    throw guardError('HASH_UNAVAILABLE', 'SHA-256実装を利用できません');
  }

  function mergeActorRows(previousRows, user, observedAt) {
    const id = actorId(user);
    const rows = Array.isArray(previousRows) ? clone(previousRows) : [];
    const row = {
      id,
      login: user.login,
      githubUserId: user.id == null ? null : user.id,
      githubType: user.type || 'User',
      source: ACTOR_SOURCE,
      observedAt
    };
    const index = rows.findIndex(x => x && x.id === id);
    if (index >= 0) rows[index] = row; else rows.push(row);
    return rows;
  }

  function mergePermissionRows(previousRows, projectId, user, role, repository, observedAt) {
    const id = actorId(user);
    const rows = Array.isArray(previousRows) ? clone(previousRows) : [];
    const permissionId = `project:${projectId}:actor:${id}`;
    const row = {
      id: permissionId,
      projectId,
      actorId: id,
      role,
      source: PERMISSION_SOURCE,
      repository,
      observedAt
    };
    const index = rows.findIndex(x => x && x.id === permissionId);
    if (index >= 0) rows[index] = row; else rows.push(row);
    return rows;
  }

  async function prepareProjectWrite(options) {
    const {
      endpoint, body, previousRecord = null, previousBlobSha = null,
      user, repoMeta, now = new Date().toISOString(), randomUUID
    } = options;
    if (!endpoint) throw guardError('NOT_PROJECT_WRITE', '案件保存先を識別できません');
    if (!body || typeof body !== 'object' || typeof body.content !== 'string') {
      throw guardError('INVALID_WRITE', 'GitHub Contents APIの案件保存payloadが不正です');
    }
    if (!user || !user.login) throw guardError('ACTOR_UNKNOWN', '保存前にGitHub /userで認証主体を確認してください');

    const record = JSON.parse(base64ToText(body.content));
    if (!record || !record.project || record.project.schemaVersion !== 1) {
      throw guardError('INVALID_PROJECT', 'TSUGU schemaVersion 1 の案件レコードではありません');
    }
    const project = record.project;
    if (project.id !== endpoint.projectId) {
      throw guardError('PROJECT_SCOPE_VIOLATION', `保存pathの案件ID ${endpoint.projectId} とpayloadの案件ID ${project.id} が一致しません`);
    }
    const scopeIssues = nestedScopeIssues(project.core || {}, project.id);
    if (scopeIssues.length) {
      throw guardError('PROJECT_SCOPE_VIOLATION', `別案件参照を保存できません: ${scopeIssues.slice(0, 5).join(', ')}`);
    }

    if (previousRecord) {
      if (Number(record.revision) !== Number(previousRecord.revision) + 1) {
        throw guardError('REVISION_CONFLICT', `案件版は ${previousRecord.revision + 1} である必要があります`);
      }
      if (previousRecord.project && previousRecord.project.id !== project.id) {
        throw guardError('PROJECT_SCOPE_VIOLATION', '既存案件と異なる案件IDへ上書きできません');
      }
    } else if (Number(record.revision) !== 1) {
      throw guardError('REVISION_CONFLICT', '新規案件の初回保存版は1である必要があります');
    }

    const previousProject = previousRecord ? previousRecord.project : null;
    assertSystemFieldsUntampered(previousProject, project);
    const role = deriveRole(repoMeta);
    assertActorChanges(previousProject, project, user.login, role);
    if (role === 'VIEWER') throw guardError('PERMISSION_DENIED', 'GitHub repository write権限を確認できないため案件を保存できません');

    if (!project.core || typeof project.core !== 'object' || Array.isArray(project.core)) project.core = {};
    const previousCore = previousProject && previousProject.core ? previousProject.core : {};
    const repository = `${endpoint.owner}/${endpoint.repo}`;
    project.core.securityVersion = SECURITY_VERSION;
    project.core.actors = mergeActorRows(previousCore.actors, user, now);
    project.core.permissions = mergePermissionRows(previousCore.permissions, project.id, user, role, repository, now);
    project.core.auditEvents = Array.isArray(previousCore.auditEvents) ? clone(previousCore.auditEvents) : [];

    const payloadHash = `sha256:${await sha256Hex(canonicalHashPayload(record))}`;
    const uuid = randomUUID || (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID.bind(root.crypto) : null);
    if (!uuid) throw guardError('UUID_UNAVAILABLE', 'Audit IDを生成できません');
    project.core.auditEvents.push({
      id: uuid(),
      projectId: project.id,
      actorId: actorId(user),
      actorLogin: user.login,
      action: previousRecord ? 'PROJECT_UPDATE' : 'PROJECT_CREATE',
      recordRevision: record.revision,
      baseBlobSha: previousBlobSha || null,
      payloadHash,
      at: now
    });

    return {
      body: { ...body, content: textToBase64(JSON.stringify(record, null, 2)) },
      record,
      role,
      actorId: actorId(user),
      payloadHash
    };
  }

  async function observeResponse(input, init, response) {
    const raw = typeof input === 'string' ? input : input && input.url;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!raw) return;
    let url;
    try { url = new URL(raw, root.location ? root.location.href : 'https://example.invalid/'); }
    catch { return; }
    if (url.hostname !== 'api.github.com') return;

    if (url.pathname === '/user' && response.ok) {
      try { runtime.user = await response.clone().json(); } catch { /* no-op */ }
      return;
    }
    const repoKey = parseRepoEndpoint(raw);
    if (repoKey && response.ok && method === 'GET') {
      try { runtime.repositories.set(repoKey, await response.clone().json()); } catch { /* no-op */ }
      return;
    }
    const endpoint = parseProjectEndpoint(raw);
    if (!endpoint || method !== 'GET') return;
    if (response.status === 404) {
      runtime.latestByPath.set(endpoint.key, { record: null, sha: null });
      return;
    }
    if (!response.ok) return;
    try {
      const file = await response.clone().json();
      const record = JSON.parse(base64ToText(file.content));
      runtime.latestByPath.set(endpoint.key, { record, sha: file.sha || null });
    } catch { /* malformed files remain app-level errors */ }
  }

  async function guardedFetch(input, init = {}) {
    const endpoint = parseProjectEndpoint(input);
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    let nextInit = init;
    if (endpoint && method === 'PUT') {
      let body = init.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const latest = runtime.latestByPath.get(endpoint.key) || { record: null, sha: null };
      const repoMeta = runtime.repositories.get(`${endpoint.owner}/${endpoint.repo}`) || null;
      const prepared = await prepareProjectWrite({
        endpoint,
        body,
        previousRecord: latest.record,
        previousBlobSha: latest.sha,
        user: runtime.user,
        repoMeta
      });
      nextInit = { ...init, body: JSON.stringify(prepared.body) };
    }
    const response = await runtime.nativeFetch(input, nextInit);
    await observeResponse(input, nextInit, response);
    return response;
  }

  function install() {
    if (runtime.installed || !root || typeof root.fetch !== 'function') return false;
    runtime.nativeFetch = root.fetch.bind(root);
    root.fetch = guardedFetch;
    runtime.installed = true;
    return true;
  }

  return {
    install,
    prepareProjectWrite,
    parseProjectEndpoint,
    deriveRole,
    nestedScopeIssues,
    collectActorChanges,
    canonicalHashPayload,
    constants: { ACTOR_SOURCE, PERMISSION_SOURCE, SECURITY_VERSION },
    _runtime: runtime
  };
});
