import * as D from './workflow-domain.mjs';
export const IMPORT_SCHEMA='tsugu-project-import/1';
export const MAX_IMPORT_BYTES=2_000_000;
export const IMPORT_COLLECTIONS=D.COLLECTIONS.filter(k=>!['implementation_records','artifacts','system_events'].includes(k));
const object=(v,label)=>D.assert(v&&typeof v==='object'&&!Array.isArray(v),`${label}: オブジェクトが必要です`);
function fields(value,template,label){
  object(value,label);
  for(const [key,v] of Object.entries(value)){
    D.assert(Object.hasOwn(template,key),`${label}.${key}: 未対応の項目です`);
    const base=template[key];
    if(Array.isArray(base))D.assert(Array.isArray(v)&&v.every(x=>typeof x==='string'),`${label}.${key}: 文字列の配列が必要です`);
    else if(base&&typeof base==='object')fields(v,base,`${label}.${key}`);
    else D.assert(typeof v===typeof base,`${label}.${key}: 型が不正です`);
  }
}
const reserved=['approval','created_at','updated_at','checked_at','checked_by','result','evidence','resolves_check_ids','artifact_ids','material_snapshot','base_specification_hash'];
export async function prepareImport(text,actor){
  D.assert(actor?.login&&actor.type==='User'&&actor.canWrite,'GitHubへの接続が必要です');
  D.assert(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_IMPORT_BYTES,'JSONは2MB以内にしてください');
  let input;try{input=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('JSONの構文が不正です。引用符・カンマ・括弧を確認してください。');}
  object(input,'JSON');
  D.assert(input.schema_version===IMPORT_SCHEMA,'新規登録用 tsugu-project-import/1 が必要です。案件エクスポート・AI返却・旧形式は取り扱い説明書を確認してください。');
  D.assert(Object.keys(input).every(k=>['schema_version','projects'].includes(k)),'JSONに未対応の項目があります');
  D.assert(Array.isArray(input.projects)&&input.projects.length>0&&input.projects.length<=20,'projectsは1〜20案件にしてください');
  const projects=[],names=new Set();
  for(const [i,source] of input.projects.entries()){
    try{
      object(source,'案件');
      D.assert(typeof source.name==='string'&&source.name.trim(),'name: 案件名が必要です');
      D.assert(!names.has(source.name.trim()),'同じJSON内に案件名が重複しています');names.add(source.name.trim());
      D.assert(Object.keys(source).every(k=>['name','project_context','current_focus','source_baseline',...IMPORT_COLLECTIONS].includes(k)),'新規案件に未対応の項目があります（状態・承認・実績は登録後に操作してください）');
      const p=D.createProject(source.name);
      for(const k of ['project_context','current_focus','source_baseline'])if(k in source){fields(source[k],p[k],k);Object.assign(p[k],D.clone(source[k]));}
      let count=0;
      for(const k of IMPORT_COLLECTIONS){
        if(!(k in source))continue;
        D.assert(Array.isArray(source[k]),`${k}: 配列が必要です`);count+=source[k].length;D.assert(count<=1000,'1案件の記録は合計1000件以内にしてください');
        p[k]=source[k].map((row,j)=>{
          const label=`${k}[${j+1}]`;object(row,label);D.assert(typeof row.id==='string'&&row.id.trim(),`${label}.id: IDを指定してください`);
          const template=D.recordTemplate(k,p),allowed=Object.fromEntries(Object.entries(template).filter(([key])=>!reserved.includes(key)));
          fields(row,allowed,label);
          const r={...template,...D.clone(row)};
          if(k==='tasks'&&!('execution_order' in row))r.execution_order=j+1;
          if(k==='specification_candidates')D.assert(row.target_specification_id,`${label}.target_specification_id: 対象仕様IDが必要です`);
          if(D.STATUSES[k])D.assert(r.status===template.status,`${label}.status: 新規登録では ${template.status} のみ使用できます`);
          if(k==='work_boxes')D.assert(row.node_id,`${label}.node_id: 所属する作業分類IDが必要です`);
          if(k==='tasks')D.assert(row.box_id,`${label}.box_id: 所属WorkBox IDが必要です`);
          if(k==='checks'){
            D.assert(r.target_type==='Project'||row.target_id,`${label}.target_id: 確認対象IDが必要です`);
            if(r.target_type==='Project'){D.assert(!row.target_id||row.target_id==='$project',`${label}.target_id: 案件自身は $project を指定してください`);r.target_id=p.workspace.id;}
          }
          if(k==='system_flags'&&r.scope_type==='Project'){
            D.assert(!row.scope_id||row.scope_id==='$project',`${label}.scope_id: 案件自身は $project を指定してください`);r.scope_id=p.workspace.id;
          }
          return r;
        });
      }
      for(const r of p.discussions)for(const ref of r.related_discussion_ids)D.assert(p.discussions.some(d=>d.id===ref),`discussions: 参照先が存在しません ${ref}`);
      p.history.push({id:D.id('HIS'),at:D.now(),by:actor.login,message:`JSON一括取り込みで新規登録を準備: ${count}件`});
      await D.validate(p);
      D.assert(new TextEncoder().encode(JSON.stringify(p,null,2)).length<880000,'展開後の案件が保存上限に近すぎます。内容を減らしてください');
      projects.push(p);
    }catch(e){throw new Error(`案件 ${i+1}「${String(source?.name||'名称未指定')}」: ${e.message}`);}
  }
  return projects;
}
// A receipt is single-use: after an uncertain response it must never resend the same entry.
export function importReceipt(projects){return {schema_version:'tsugu-import-receipt/1',created_at:D.now(),started:false,entries:projects.map(p=>({project_id:p.workspace.id,name:p.workspace.name,path:p.authority.canonical_path,status:'未登録',commit_sha:'',message:''}))};}
export async function registerBatch(store,projects,receipt,onProgress=()=>{}){
  D.assert(!receipt.started,'この取り込みは実行済みです。結果を確認してください');
  D.assert(projects.length===receipt.entries.length&&projects.length>0,'取り込み対象が不一致です');
  for(const [i,p] of projects.entries()){
    await D.validate(p);D.assert(p.revision===0&&p.workspace.id===receipt.entries[i].project_id,'取り込み対象が不一致です');
  }
  await store.verify();
  receipt.started=true;receipt.connection=store.connection;
  for(const [i,p] of projects.entries()){
    const entry=receipt.entries[i];entry.status='登録中';onProgress();
    try{
      const saved=await store.save(p,'','JSON一括取り込み');entry.status='登録済み';entry.commit_sha=saved.commit_sha;entry.message=`版 ${saved.project.revision}`;
    }catch(e){entry.status='要確認';entry.message=e.message;receipt.finished_at=D.now();onProgress();return receipt;}
    onProgress();
  }
  receipt.finished_at=D.now();return receipt;
}
