(function (root, factory) {
  let Sync = root && root.TSUGUCoreSync;
  if (!Sync && typeof module === 'object' && module.exports) {
    try { Sync = require('./core-sync.js'); } catch {}
  }
  const api = factory(root, Sync);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.TSUGUCoreSyncStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Sync) {
  'use strict';

  function err(code, message, detail) {
    const e = new Error(`${code}: ${message}`); e.code = code; if (detail !== undefined) e.detail = detail; return e;
  }
  function requireSync() { if (!Sync) throw err('CORE_SYNC_REQUIRED', 'TSUGUCoreSync が必要です'); return Sync; }
  function id(value, field) { const v=String(value||'').trim(); if(!v)throw err('INVALID_ID',`${field} が必要です`); return v; }
  function base64Encode(text){return typeof Buffer!=='undefined'?Buffer.from(text,'utf8').toString('base64'):btoa(unescape(encodeURIComponent(text)));}
  function base64Decode(text){return typeof Buffer!=='undefined'?Buffer.from(String(text).replace(/\n/g,''),'base64').toString('utf8'):decodeURIComponent(escape(atob(String(text).replace(/\n/g,''))));}
  function headers(options){const h={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};if(options.token)h.Authorization=`Bearer ${options.token}`;return h;}
  async function json(fetchImpl,url,options={}){const r=await fetchImpl(url,options),t=await r.text();let b=null;try{b=t?JSON.parse(t):null;}catch{b={message:t};}return{response:r,body:b};}
  function endpoints(options){
    const repo=id(options.repository,'repository'),m=repo.match(/^([^/\s]+)\/([^/\s]+)$/);if(!m)throw err('INVALID_REPOSITORY','repository は owner/name 形式で指定してください');
    const branch=id(options.branch,'branch'),path=String(options.path||'data/core/github-sync.json').replace(/^\/+/, '');if(!path)throw err('INVALID_PATH','path が必要です');
    const base=`https://api.github.com/repos/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}`;
    const content=`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    return{branch,path,content,read:`${content}?ref=${encodeURIComponent(branch)}`};
  }
  async function load(options={}){
    const s=requireSync(),fetchImpl=options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw err('FETCH_REQUIRED','fetch実装が必要です');
    const ep=endpoints(options),h=headers(options),r=await json(fetchImpl,ep.read,{headers:h});if(!r.response.ok)throw err('SYNC_LEDGER_READ_FAILED',`${r.response.status}`,r.body);
    let aggregate;try{aggregate=s.validateSyncAggregate(JSON.parse(base64Decode(r.body.content)));}catch(e){throw err('INVALID_SYNC_LEDGER',e.message);}
    return Object.freeze({aggregate,blobSha:r.body.sha});
  }
  function transitionAggregate(aggregate,action,args={}){
    const s=requireSync(),kind=String(action||'').toUpperCase();
    if(kind==='CLAIM')return s.claimNextJob(aggregate,args);
    if(kind==='COMPLETE')return s.completeJob(aggregate,args.jobId,args);
    if(kind==='FAIL')return s.failJob(aggregate,args.jobId,args.error,args);
    throw err('UNSUPPORTED_SYNC_TRANSITION',kind||'<empty>');
  }
  async function transitionWithContentApi(options={}){
    const s=requireSync(),fetchImpl=options.fetch||(root&&root.fetch);if(typeof fetchImpl!=='function')throw err('FETCH_REQUIRED','fetch実装が必要です');
    const ep=endpoints(options),h=headers(options),loaded=await load({...options,fetch:fetchImpl}),transition=transitionAggregate(loaded.aggregate,options.action,options.args||{});
    if(transition.aggregate===loaded.aggregate)return Object.freeze({...transition,blobSha:loaded.blobSha,commitSha:null});
    const body={message:options.message||`Sync ${String(options.action).toUpperCase()}`,content:base64Encode(s.stableStringify(transition.aggregate)),sha:loaded.blobSha,branch:ep.branch};
    const w=await json(fetchImpl,ep.content,{method:'PUT',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!w.response.ok){if(w.response.status===409||w.response.status===422)throw err('STALE_SYNC_LEDGER','sync transition CAS競合。再読込が必要です',w.body);throw err('SYNC_LEDGER_WRITE_FAILED',`${w.response.status}`,w.body);}
    const back=await load({...options,fetch:fetchImpl});
    if(back.aggregate.revision!==transition.aggregate.revision)throw err('SYNC_LEDGER_READBACK_MISMATCH','revisionが一致しません');
    return Object.freeze({...transition,aggregate:back.aggregate,blobSha:back.blobSha,commitSha:w.body&&w.body.commit&&w.body.commit.sha||null});
  }
  return Object.freeze({load,transitionAggregate,transitionWithContentApi});
});
