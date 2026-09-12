import { ROOT, assert, validate, assertSave, clone, now } from './workflow-domain.mjs';
const API='https://api.github.com';
const encodePath=p=>p.split('/').map(encodeURIComponent).join('/');
export function encode(text){const bytes=new TextEncoder().encode(text);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
export function decode(content){return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
export class GitStore {
  #token='';#connection=null;#actor=null;#fetch;#busy=false;
  constructor(fetcher=globalThis.fetch.bind(globalThis)){this.#fetch=fetcher;}
  get actor(){return this.#actor?clone(this.#actor):null;}
  get connection(){return this.#connection?clone(this.#connection):null;}
  disconnect(){assert(!this.#busy,'保存中は接続を変更できません');this.#token='';this.#connection=null;this.#actor=null;}
  async request(path,{method='GET',body}={},allow404=false){
    assert(this.#token,'GitHub接続が必要です');
    let response;
    try{response=await this.#fetch(API+path,{method,cache:'no-store',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.#token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}
    catch{throw new Error(method==='PUT'?'保存結果を確認できません。GitHubから再読込して確定状態を確認してください。':'GitHubへ接続できません。接続を確認して再試行してください。');}
    if(response.status===404&&allow404)return null;
    assert(response.ok,`GitHub HTTP ${response.status}${[409,422].includes(response.status)?'：競合の可能性があります。再読込してください':''}`);
    return response.json();
  }
  base(){const c=this.#connection;assert(c,'未接続');return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;}
  async verify(){
    const user=await this.request('/user'),repo=await this.request(this.base());
    assert(repo.private===true,'保存先はPrivateリポジトリにしてください');
    assert(user.type==='User'&&user.login,'GitHub利用者を確認できません');
    assert(repo.permissions?.push===true||repo.permissions?.admin===true,'Repository書込権限が必要です');
    this.#actor={login:user.login,type:user.type,canWrite:true};return this.actor;
  }
  async connect({owner,repo,branch,token}){
    this.disconnect();assert([owner,repo,branch,token].every(v=>typeof v==='string'&&v.trim()),'接続情報が必要です');
    assert(/^[A-Za-z0-9_.-]+$/.test(owner)&&/^[A-Za-z0-9_.-]+$/.test(repo),'Repository名が不正です');
    this.#token=token.trim();this.#connection={owner:owner.trim(),repo:repo.trim(),branch:branch.trim()};
    try{await this.verify();await this.request(`${this.base()}/branches/${encodeURIComponent(branch.trim())}`);return this.actor;}
    catch(e){this.disconnect();throw e;}
  }
  async file(path){return this.request(`${this.base()}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.#connection.branch)}`,{},true);}
  async list(){
    const rows=await this.file(ROOT);if(rows===null)return [];
    assert(Array.isArray(rows),'案件ディレクトリの応答が不正です');
    const files=rows.filter(x=>x.type==='file'&&x.name.endsWith('.json')),out=[];
    for(let offset=0;offset<files.length;offset+=6){
      const batch=await Promise.all(files.slice(offset,offset+6).map(async x=>{
        const row={id:x.name.slice(0,-5),path:x.path,name:x.name};
        try{const loaded=await this.open(row.id);return {...row,title:loaded.project.workspace.name};}
        catch(e){return {...row,title:`読込不可: ${x.name}`,error:e.message};}
      }));out.push(...batch);
    }
    return out.sort((a,b)=>(a.title||a.id).localeCompare(b.title||b.id,'ja'));
  }
  async open(projectId){
    assert(/^[A-Za-z0-9._-]+$/.test(projectId),'案件IDが不正です');const path=`${ROOT}/${projectId}.json`,file=await this.file(path);assert(file,'案件が見つかりません');
    const project=JSON.parse(decode(file.content));await validate(project);assert(project.authority.canonical_path===path,'保存場所と正本パスが不一致');assert(file.sha,'Git SHAがありません');
    return {project,sha:file.sha};
  }
  async save(project,expectedSha,message){
    assert(!this.#busy,'保存中です');this.#busy=true;
    try{
      await this.verify();await validate(project);const path=project.authority.canonical_path;
      const file=await this.file(path),previous=file?JSON.parse(decode(file.content)):null;
      if(file){assert(expectedSha&&file.sha===expectedSha,'Git SHAが競合しています。最新案件を再読込してください');await validate(previous);}
      else assert(!expectedSha&&project.revision===0,'正本が削除されています。上書きは停止しました');
      await assertSave(previous,project);
      const saved=clone(project);saved.revision++;saved.workspace.updated_at=now();
      const content=JSON.stringify(saved,null,2)+'\n';assert(new TextEncoder().encode(content).length<900000,'案件が保存上限900KBを超えています');
      const result=await this.request(`${this.base()}/contents/${encodePath(path)}`,{method:'PUT',body:{message:`TSUGU Workflow r${saved.revision}: ${String(message||'案件更新').slice(0,100)}`,content:encode(content),branch:this.#connection.branch,...(file?{sha:file.sha}:{})}});
      assert(result.content?.sha&&result.commit?.sha,'保存応答が不完全です。再読込して確認してください');
      return {project:saved,sha:result.content.sha,commit_sha:result.commit.sha};
    }finally{this.#busy=false;}
  }
}
