(function (root, factory) {
  let Sync = root && root.TSUGUCoreSync;
  if (!Sync && typeof module === 'object' && module.exports) {
    try { Sync = require('./core-sync.js'); } catch {}
  }
  const api = factory(root, Sync);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreSyncReconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Sync) {
  'use strict';
  function error(code,message,detail){const e=new Error(`${code}: ${message}`);e.code=code;if(detail!==undefined)e.detail=detail;return e;}
  function requireSync(){if(!Sync)throw error('CORE_SYNC_REQUIRED','TSUGUCoreSync が必要です');return Sync;}
  function id(v,f){const x=String(v||'').trim();if(!x)throw error('INVALID_ID',`${f} が必要です`);return x;}
  function split(fullName,field){const v=id(fullName,field),m=v.match(/^([^/\s]+)\/([^/\s]+)$/);if(!m)throw error('INVALID_REPOSITORY',`${field} は owner/name 形式である必要があります`);return{fullName:v,owner:m[1],repo:m[2]};}
  function b64e(t){return typeof Buffer!=='undefined'?Buffer.from(t,'utf8').toString('base64'):btoa(unescape(encodeURIComponent(t)));}
  function b64d(t){return typeof Buffer!=='undefined'?Buffer.from(String(t).replace(/\n/g,''),'base64').toString('utf8'):decodeURIComponent(escape(atob(String(t).replace(/\n/g,''))));}
  function headers(options){const h={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};if(options.token)h.Authorization=`Bearer ${options.token}`;return h;}
  async function json(fetchImpl,url,options={}){const r=await fetchImpl(url,options),t=await r.text();let b=null;try{b=t?JSON.parse(t):null;}catch{b={message:t};}return{response:r,body:b};}

  async function captureHead(options={}){
    const fetchImpl=options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw error('FETCH_REQUIRED','fetch実装が必要です');
    const observed=split(options.observedRepository,'observedRepository'),branch=id(options.observedBranch||'main','observedBranch'),h=headers(options),base=`https://api.github.com/repos/${encodeURIComponent(observed.owner)}/${encodeURIComponent(observed.repo)}`;
    const [repoResult,branchResult]=await Promise.all([json(fetchImpl,base,{headers:h}),json(fetchImpl,`${base}/branches/${encodeURIComponent(branch)}`,{headers:h})]);
    if(!repoResult.response.ok)throw error('GITHUB_REPOSITORY_READ_FAILED',`${repoResult.response.status}`,repoResult.body);
    if(!branchResult.response.ok)throw error('GITHUB_BRANCH_READ_FAILED',`${branchResult.response.status}`,branchResult.body);
    const sha=String(branchResult.body.commit&&branchResult.body.commit.sha||'').toLowerCase();if(!/^[a-f0-9]{40}$/.test(sha))throw error('INVALID_GIT_SHA','branch head SHAが不正です');
    return Object.freeze({repository:repoResult.body,branch,commitSha:sha});
  }

  async function refreshAndPersist(options={}){
    const s=requireSync(),fetchImpl=options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw error('FETCH_REQUIRED','fetch実装が必要です');
    const head=await captureHead({...options,fetch:fetchImpl});
    const ledger=split(options.ledgerRepository||options.observedRepository,'ledgerRepository'),ledgerBranch=id(options.ledgerBranch||'main','ledgerBranch'),projectId=id(options.projectId,'projectId'),path=String(options.path||'data/core/github-sync.json').replace(/^\/+/, '');if(!path)throw error('INVALID_PATH','path が必要です');
    const h=headers(options),base=`https://api.github.com/repos/${encodeURIComponent(ledger.owner)}/${encodeURIComponent(ledger.repo)}`,content=`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,read=`${content}?ref=${encodeURIComponent(ledgerBranch)}`;
    const current=await json(fetchImpl,read,{headers:h});let aggregate,blobSha=null;
    if(current.response.status===404)aggregate=s.createSyncAggregate({projectId});
    else if(current.response.ok){blobSha=current.body.sha;try{aggregate=s.validateSyncAggregate(JSON.parse(b64d(current.body.content)));}catch(e){throw error('INVALID_SYNC_LEDGER',e.message);}}
    else throw error('GITHUB_SYNC_LEDGER_READ_FAILED',`${current.response.status}`,current.body);
    if(aggregate.projectId!==projectId)throw error('PROJECT_SCOPE_VIOLATION','sync ledger Projectが一致しません');
    const received=s.receiveCommit(aggregate,head.repository,head.commitSha,head.branch,{now:options.now,maxAttempts:options.maxAttempts});
    const payload={message:options.message||`Receive GitHub head ${head.repository.full_name}@${head.commitSha.slice(0,12)}`,content:b64e(s.stableStringify(received.aggregate)),branch:ledgerBranch};if(blobSha)payload.sha=blobSha;
    const write=await json(fetchImpl,content,{method:'PUT',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!write.response.ok){if(write.response.status===409||write.response.status===422)throw error('STALE_SYNC_LEDGER','sync ledger CAS競合。再refreshが必要です',write.body);throw error('GITHUB_SYNC_LEDGER_WRITE_FAILED',`${write.response.status}`,write.body);}
    const back=await json(fetchImpl,read,{headers:h});if(!back.response.ok)throw error('GITHUB_SYNC_LEDGER_READBACK_FAILED',`${back.response.status}`,back.body);
    const stored=s.validateSyncAggregate(JSON.parse(b64d(back.body.content))),record=stored.integrations.find(x=>x.id===received.integrationRecord.id),job=stored.jobs.find(x=>x.integrationRecordId===received.integrationRecord.id);
    if(!record||!job)throw error('SYNC_READBACK_MISMATCH','IntegrationRecord/SyncJobがreadbackにありません');
    return Object.freeze({status:received.status,head,aggregate:stored,integrationRecord:record,syncJob:job,blobSha:back.body.sha,commitSha:write.body&&write.body.commit&&write.body.commit.sha||null});
  }
  return Object.freeze({captureHead,refreshAndPersist});
});
