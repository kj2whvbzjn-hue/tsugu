import {database,originalBucket} from '@/db/store';
import {projectSchema} from '@/app/model';
import {readApprovals,resolveApprovals} from '@/app/approvals';
import {historyPolicy} from '@/app/history-policy';
import {finishFileDeletions} from '@/app/deletion';
import {identityFromHeaders} from '@/app/identity';
import {getProposal,getRecord} from '@/app/proposal-store';
import {prepareProposal,ProposalError} from '@/app/proposals';
import {taskTransitionIssues} from '@/app/task-dependencies';
import {coreTransitionIssues} from '@/app/core-model';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const unauthenticated=()=>json({error:'ChatGPTへのサインインが必要です',code:'AUTH_REQUIRED'},401);
export async function GET(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return unauthenticated();
 try{
  const db=database(),params=new URL(req.url).searchParams,id=params.get('history'),original=params.get('original');
  if(original){const row=await db.prepare('SELECT object_key FROM original_files WHERE project_id=? AND owner IN (?,?)').bind(original,...identity.keys).first<{object_key:string}>();if(!row)return json({error:'元JSONが見つかりません'},404);const file=await originalBucket().get(row.object_key);if(!file)return json({error:'元JSONを読み込めません'},503);return new Response(file.body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
  const snapshot=params.get('snapshot');
  if(snapshot){
   const revision=Number(params.get('revision'));if(!Number.isSafeInteger(revision)||revision<1)return json({error:'版番号が不正です'},400);
   const row=await db.prepare('SELECT body,snapshot_object_key,created_at FROM revisions WHERE project_id=? AND owner IN (?,?) AND revision=?').bind(snapshot,...identity.keys,revision).first<{body:string;snapshot_object_key:string|null;created_at:string}>();
   if(!row)return json({error:'履歴が見つからないか、保持期間が終了しています'},404);
   if(row.snapshot_object_key){const file=await originalBucket().get(row.snapshot_object_key);if(!file)return json({error:'履歴ファイルを取得できません'},503);return new Response(file.body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="revision-${revision}.json"`}});}
   return json({project:JSON.parse(row.body),revision,updatedAt:row.created_at});
  }
  if(id){
   const before=params.has('before')?Number(params.get('before')):Number.MAX_SAFE_INTEGER;if(!Number.isSafeInteger(before)||before<1)return json({error:'履歴のページ指定が不正です'},400);
   const r=await db.prepare('SELECT revision, summary, created_at FROM revisions WHERE project_id=? AND owner IN (?,?) AND revision<? ORDER BY revision DESC LIMIT ?').bind(id,...identity.keys,before,historyPolicy.listLimit).all();return json(r.results);
  }
  await finishFileDeletions(identity.keys);
  const r=await db.prepare('SELECT body,revision,updated_at FROM projects WHERE owner IN (?,?) ORDER BY updated_at DESC').bind(...identity.keys).all();return json(r.results.map((x:any)=>({project:readApprovals(JSON.parse(x.body),x.revision),revision:x.revision,updatedAt:x.updated_at})));
 }catch(e){console.error(e);return json({error:'案件を読み込めません。再試行してください。'},503);}
}
export async function POST(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return unauthenticated();
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'許可されていない操作です'},403);
 try{
  const text=await req.text();if(new TextEncoder().encode(text).length>10*1024*1024)return json({error:'取込データは10MB以内にしてください'},413);
  let input:any;try{input=JSON.parse(text)}catch{return json({error:'JSONの形式が不正です'},400)}
  let proposalId:string|undefined;
  if(input.proposalId!==undefined){
   if(origin!==new URL(req.url).origin)return json({error:'変更案の反映は継ぐの確認画面から行ってください'},403);
   if(typeof input.proposalId!=='string'||input.proposalId.length>100)return json({error:'提案IDが不正です'},400);
   proposalId=input.proposalId;
   const stored=await getProposal(identity,proposalId!);
   const current=await getRecord(identity,stored.project_id);
   if(stored.status==='applied')return json({...current,appliedProposalRevision:stored.applied_revision});
   if(stored.status!=='pending')return json({error:'この変更案は反映できません'},409);
   const prepared=prepareProposal(current,JSON.parse(stored.body));
   input={project:prepared.project,baseRevision:prepared.proposal.baseRevision,summary:`AI返却: ${prepared.proposal.summary}`};
  }
  const parsed=projectSchema.safeParse(input.project);if(!parsed.success)return json({error:parsed.error.issues[0].message},400);
  const base=input.baseRevision;if(!Number.isSafeInteger(base)||base<0||base>=Number.MAX_SAFE_INTEGER)return json({error:'版番号が不正です'},400);
  const requests=input.approvals??{};
  if(!requests||typeof requests!=='object'||Array.isArray(requests)||Object.entries(requests).some(([k,v])=>!['implementation','completion'].includes(k)||typeof v!=='boolean'))return json({error:'承認要求が不正です'},400);
  const db=database(),revision=base+1,at=new Date().toISOString(),key=crypto.randomUUID(),summary=String(input.summary||'案件を更新').slice(0,2000);
  const previous=base>0?await db.prepare('SELECT body,revision FROM projects WHERE id=? AND owner IN (?,?)').bind(parsed.data.id,...identity.keys).first<{body:string;revision:number}>():null;
  if(base>0&&(!previous||previous.revision!==base))return json({error:'別の更新があります。最新版を読み直してください。'},409);
  if(previous){
   const prior=JSON.parse(previous.body);
   if(prior.sourceRefs?.length&&parsed.data.sourceRefs===undefined)return json({error:'Git基準版が省略されています。最新版の画面を開き直してください。'},400);
   for(const item of parsed.data.items){if(prior.items?.find((old:{id:string;task?:unknown})=>old.id===item.id)?.task&&!item.task)return json({error:'作業条件が省略されています。最新版の画面を開き直してください。'},400);}
  }
  const priorProject=previous?JSON.parse(previous.body):undefined;
  const transitionIssues=[...taskTransitionIssues(priorProject,parsed.data),...coreTransitionIssues(priorProject?.core,parsed.data.core)];
  if(transitionIssues.length)return json({error:transitionIssues.join(' / ')},400);
  let p;try{p=resolveApprovals(parsed.data,previous?JSON.parse(previous.body):undefined,base,requests,identity.owner,at)}catch(e){return json({error:(e as Error).message},400);}
  const body=JSON.stringify(p);
  if(new TextEncoder().encode(body).length>1800000)return json({error:'案件の編集データが保存上限を超えています（1.8MB）'},413);
  let originalKey:string|undefined;
  if(base===0&&p.sourceInfo&&(!p.sourceInfo.originalMissing||typeof input.originalText==='string')){
   if(typeof input.originalText!=='string')return json({error:'取込には元JSONが必要です'},400);
   let original:any;try{original=JSON.parse(input.originalText)}catch{return json({error:'元JSONの形式が不正です'},400)}
   if(original?.workspace?.id!==p.sourceInfo.projectId)return json({error:'元JSONと案件IDが一致しません'},400);
   originalKey=`originals/${p.id}/${crypto.randomUUID()}.json`;
   await originalBucket().put(originalKey,input.originalText,{httpMetadata:{contentType:'application/json; charset=utf-8'}});
  }
  const snapshotKey=`snapshots/${p.id}/${key}.json`;
  await originalBucket().put(snapshotKey,JSON.stringify({project:p,revision,updatedAt:at}),{httpMetadata:{contentType:'application/json; charset=utf-8'}});
  const mutation=base===0?db.prepare('INSERT INTO projects (id,owner,name,body,revision,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(p.id,identity.owner,p.name,body,revision,at):db.prepare('UPDATE projects SET name=?,body=?,revision=?,updated_at=? WHERE id=? AND owner IN (?,?) AND revision=?').bind(p.name,body,revision,at,p.id,...identity.keys,base);
  const log=db.prepare('INSERT INTO revisions (key,project_id,owner,revision,body,summary,created_at,snapshot_object_key) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1').bind(key,p.id,identity.owner,revision,'',summary,at,snapshotKey);
  const statements=[mutation,log];
  if(proposalId)statements.push(db.prepare("UPDATE proposals SET status='applied',applied_revision=?,applied_at=? WHERE id=? AND owner IN (?,?) AND status='pending' AND EXISTS (SELECT 1 FROM revisions WHERE key=? AND owner=?)").bind(revision,at,proposalId,...identity.keys,key,identity.owner));
  if(originalKey)statements.push(db.prepare('INSERT INTO original_files (project_id,owner,object_key) SELECT ?,?,? WHERE changes()=1').bind(p.id,identity.owner,originalKey));
  // Only prune this owner's new-style snapshots, and only if this exact write succeeded.
  // Legacy D1 snapshots are deliberately preserved and remain retrievable.
  const expired='SELECT key FROM revisions WHERE project_id=? AND owner IN (?,?) AND snapshot_object_key IS NOT NULL ORDER BY revision DESC LIMIT -1 OFFSET ?';
  const expiryArgs=[p.id,...identity.keys,historyPolicy.retainedSnapshots];
  const written='EXISTS (SELECT 1 FROM revisions WHERE key=? AND owner=?)';
  statements.push(db.prepare('INSERT OR IGNORE INTO deletion_jobs (object_key,owner) SELECT snapshot_object_key,owner FROM revisions WHERE key IN ('+expired+') AND '+written).bind(...expiryArgs,key,identity.owner));
  statements.push(db.prepare('DELETE FROM revisions WHERE key IN ('+expired+') AND '+written).bind(...expiryArgs,key,identity.owner));
  // An uncertain network result can leave an unreferenced object; never delete it here,
  // because the database transaction may have committed even if its response was lost.
  const result=await db.batch(statements);
  if(result[0].meta.changes!==1){await originalBucket().delete(snapshotKey);if(originalKey)await originalBucket().delete(originalKey);return json({error:'別の更新があります。下書きをJSON保存し、最新版を読み直してください。'},409);}
  await finishFileDeletions(identity.keys);
  return json({project:p,revision,updatedAt:at});
 }catch(e){if(e instanceof ProposalError)return json({error:e.message},e.status);console.error(e);return json({error:'保存できませんでした。入力は画面に残っています。'},503);}
}

export async function DELETE(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return unauthenticated();
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'許可されていない操作です'},403);
 try{
  const text=await req.text();if(text.length>4096)return json({error:'削除要求が不正です'},400);
  let input:any;try{input=JSON.parse(text)}catch{return json({error:'削除要求が不正です'},400)}
  const {projectId,baseRevision}=input;
  if(typeof projectId!=='string'||projectId.length>100||!Number.isInteger(baseRevision)||baseRevision<1)return json({error:'案件と版番号を確認してください'},400);
  const db=database();
  const owned=await db.prepare('SELECT revision FROM projects WHERE id=? AND owner IN (?,?)').bind(projectId,...identity.keys).first<{revision:number}>();
  if(!owned)return json({error:'案件が見つかりません'},404);
  if(owned.revision!==baseRevision)return json({error:'案件が更新されています。最新版を読み直してから削除してください。'},409);
  const guard='EXISTS (SELECT 1 FROM projects WHERE id=? AND owner IN (?,?) AND revision=?)';
  const condition=[projectId,...identity.keys,baseRevision];
  const result=await db.batch([
   db.prepare('INSERT OR IGNORE INTO deletion_jobs (object_key,owner) SELECT object_key,owner FROM original_files WHERE project_id=? AND '+guard).bind(projectId,...condition),
   db.prepare('DELETE FROM original_files WHERE project_id=? AND '+guard).bind(projectId,...condition),
   db.prepare('INSERT OR IGNORE INTO deletion_jobs (object_key,owner) SELECT snapshot_object_key,owner FROM revisions WHERE project_id=? AND owner IN (?,?) AND snapshot_object_key IS NOT NULL AND '+guard).bind(projectId,...identity.keys,...condition),
   db.prepare('DELETE FROM revisions WHERE project_id=? AND '+guard).bind(projectId,...condition),
   db.prepare('DELETE FROM projects WHERE id=? AND owner IN (?,?) AND revision=?').bind(...condition),
   db.prepare('DELETE FROM proposals WHERE project_id=? AND owner IN (?,?) AND NOT EXISTS (SELECT 1 FROM projects WHERE id=?)').bind(projectId,...identity.keys,projectId),
  ]);
  if(result[4].meta.changes!==1)return json({error:'案件が更新されています。最新版を読み直してください。'},409);
  const cleanupPending=await finishFileDeletions(identity.keys);
  return json({deleted:true,cleanupPending});
 }catch(e){console.error(e);return json({error:'削除結果を確認できません。案件一覧を読み直してください。'},503);}
}
