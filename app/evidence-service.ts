export type EvidenceIdentity={owner:string;keys:[string,string]};
export type EvidenceStore={
 db:{prepare:(sql:string)=>{bind:(...args:unknown[])=>{first:<T=unknown>()=>Promise<T|null>;all:<T=unknown>()=>Promise<{results:T[]}>;run:()=>Promise<{meta:{changes:number}}>}};batch:(statements:any[])=>Promise<Array<{meta:{changes:number}}>>};
 bucket:{put:(key:string,value:ArrayBuffer|Uint8Array,options?:unknown)=>Promise<unknown>;get:(key:string)=>Promise<any>};
};
export type RegisterEvidenceInput={
 projectId:string;evidenceId:string;operationId:string;title:string;kind:string;description:string;
 originalFilename:string;mimeType:string;bytes:Uint8Array;expectedSha256?:string;
};
export type EvidenceVersionInfo={id:string;evidenceId:string;versionNo:number;originalFilename:string;mimeType:string;byteSize:number;sha256:string;objectKey:string;storageState:string;uploadOperationId:string;createdAt:string};
export type EvidenceInfo={id:string;projectId:string;title:string;kind:string;description:string;currentVersionId:string;createdAt:string;updatedAt:string;versions:EvidenceVersionInfo[]};

export class EvidenceServiceError extends Error{constructor(message:string,public status=400){super(message);}}
const shaPattern=/^[a-f0-9]{64}$/i;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const evidenceKinds=new Set(['file','image','video','log','test_result','screenshot','other']);
const safeText=(value:string,max:number,label:string)=>{const text=String(value??'').trim();if(!text||text.length>max)throw new EvidenceServiceError(`${label}が不正です`);return text;};
const toHex=(data:ArrayBuffer)=>Array.from(new Uint8Array(data)).map(b=>b.toString(16).padStart(2,'0')).join('');
export async function sha256Bytes(bytes:Uint8Array){const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);return toHex(await crypto.subtle.digest('SHA-256',copy.buffer));}
async function ownedProject(store:EvidenceStore,identity:EvidenceIdentity,projectId:string){return store.db.prepare('SELECT id FROM projects WHERE id=? AND owner IN (?,?)').bind(projectId,...identity.keys).first<{id:string}>();}
async function readObjectBytes(object:any){if(!object)return null;if(typeof object.arrayBuffer==='function')return new Uint8Array(await object.arrayBuffer());if(object.body!==undefined)return new Uint8Array(await new Response(object.body).arrayBuffer());return null;}
async function verifyStoredObject(store:EvidenceStore,objectKey:string,sha256:string,byteSize:number){const object=await store.bucket.get(objectKey),bytes=await readObjectBytes(object);if(!bytes||bytes.byteLength!==byteSize)return false;return (await sha256Bytes(bytes))===sha256;}
function validateRegister(input:RegisterEvidenceInput){
 if(!uuidPattern.test(input.projectId)||!uuidPattern.test(input.evidenceId)||!uuidPattern.test(input.operationId))throw new EvidenceServiceError('案件・Evidence・operation IDが不正です');
 safeText(input.title,300,'Evidenceタイトル');if(!evidenceKinds.has(input.kind))throw new EvidenceServiceError('Evidence種別が不正です');
 if(String(input.description??'').length>200000)throw new EvidenceServiceError('Evidence説明が長すぎます');
 safeText(input.originalFilename,500,'ファイル名');safeText(input.mimeType||'application/octet-stream',200,'MIME type');
 if(!(input.bytes instanceof Uint8Array)||input.bytes.byteLength<1)throw new EvidenceServiceError('空のファイルは登録できません');
 if(input.expectedSha256&& !shaPattern.test(input.expectedSha256))throw new EvidenceServiceError('期待SHA-256が不正です');
}

type UploadRow={operation_id:string;project_id:string;evidence_id:string;owner:string;state:string;object_key:string;sha256:string;byte_size:number;error:string;created_at:string;updated_at:string};
type VersionRow={id:string;evidence_id:string;project_id:string;owner:string;version_no:number;original_filename:string;mime_type:string;byte_size:number;sha256:string;object_key:string;storage_state:string;upload_operation_id:string;created_at:string};
type EvidenceRow={id:string;project_id:string;owner:string;title:string;kind:string;description:string;current_version_id:string|null;created_at:string;updated_at:string};
const versionInfo=(row:VersionRow):EvidenceVersionInfo=>({id:row.id,evidenceId:row.evidence_id,versionNo:row.version_no,originalFilename:row.original_filename,mimeType:row.mime_type,byteSize:row.byte_size,sha256:row.sha256,objectKey:row.object_key,storageState:row.storage_state,uploadOperationId:row.upload_operation_id,createdAt:row.created_at});

async function versionByOperation(store:EvidenceStore,identity:EvidenceIdentity,operationId:string){return store.db.prepare('SELECT * FROM evidence_versions WHERE upload_operation_id=? AND owner IN (?,?)').bind(operationId,...identity.keys).first<VersionRow>();}
async function evidenceById(store:EvidenceStore,identity:EvidenceIdentity,projectId:string,evidenceId:string){return store.db.prepare('SELECT * FROM evidences WHERE id=? AND project_id=? AND owner IN (?,?)').bind(evidenceId,projectId,...identity.keys).first<EvidenceRow>();}

export async function registerEvidence(store:EvidenceStore,identity:EvidenceIdentity,input:RegisterEvidenceInput){
 validateRegister(input);
 if(!await ownedProject(store,identity,input.projectId))throw new EvidenceServiceError('案件が見つかりません',404);
 const computedSha=await sha256Bytes(input.bytes);
 if(input.expectedSha256&&computedSha!==input.expectedSha256.toLowerCase())throw new EvidenceServiceError('送信ファイルのSHA-256が期待値と一致しません',409);
 const byteSize=input.bytes.byteLength,mimeType=input.mimeType||'application/octet-stream',now=new Date().toISOString();
 let upload=await store.db.prepare('SELECT * FROM evidence_uploads WHERE operation_id=? AND owner IN (?,?)').bind(input.operationId,...identity.keys).first<UploadRow>();
 let version=await versionByOperation(store,identity,input.operationId);
 let evidence=await evidenceById(store,identity,input.projectId,input.evidenceId);
 if(upload){
  if(upload.project_id!==input.projectId||upload.evidence_id!==input.evidenceId||upload.sha256!==computedSha||upload.byte_size!==byteSize)throw new EvidenceServiceError('同じoperation IDで異なるファイルは登録できません',409);
  if(!version)throw new EvidenceServiceError('再試行情報が不完全です。管理者確認が必要です',409);
  if(version.original_filename!==input.originalFilename||version.mime_type!==mimeType)throw new EvidenceServiceError('同じoperation IDでファイル属性を変更できません',409);
  if(!evidence)throw new EvidenceServiceError('再試行対象のEvidenceを確認できません。管理者確認が必要です',409);
  if(upload.state==='committed'&&version.storage_state==='available'){if(!evidence.current_version_id)throw new EvidenceServiceError('Evidence current版を確認できません',503);return {evidenceId:input.evidenceId,currentVersionId:evidence.current_version_id,version:versionInfo(version),idempotent:true};}
 }else{
  if(evidence&&(evidence.title!==input.title||evidence.kind!==input.kind))throw new EvidenceServiceError('既存Evidenceのタイトルまたは種別と一致しません',409);
  const max=await store.db.prepare('SELECT COALESCE(MAX(version_no),0) AS n FROM evidence_versions WHERE evidence_id=? AND project_id=? AND owner IN (?,?)').bind(input.evidenceId,input.projectId,...identity.keys).first<{n:number}>();
  const versionNo=Number(max?.n||0)+1,versionId=crypto.randomUUID(),objectKey=`evidence/${input.projectId}/${input.evidenceId}/${versionId}`;
  const statements:any[]=[];
  if(!evidence)statements.push(store.db.prepare('INSERT INTO evidences (id,project_id,owner,title,kind,description,current_version_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner IN (?,?))').bind(input.evidenceId,input.projectId,identity.owner,input.title,input.kind,input.description,null,now,now,input.projectId,...identity.keys));
  statements.push(store.db.prepare('INSERT INTO evidence_uploads (operation_id,project_id,evidence_id,owner,state,object_key,sha256,byte_size,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(input.operationId,input.projectId,input.evidenceId,identity.owner,'reserved',objectKey,computedSha,byteSize,'',now,now));
  statements.push(store.db.prepare('INSERT INTO evidence_versions (id,evidence_id,project_id,owner,version_no,original_filename,mime_type,byte_size,sha256,object_key,storage_state,upload_operation_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(versionId,input.evidenceId,input.projectId,identity.owner,versionNo,input.originalFilename,mimeType,byteSize,computedSha,objectKey,'pending',input.operationId,now));
  try{const results=await store.db.batch(statements);if(!results.length||results.some((r,i)=>i>0&&r.meta.changes!==1))throw new Error('reservation not written');}
  catch(e){throw new EvidenceServiceError('Evidence版を予約できません。最新版を確認して再試行してください。',409);}
  upload=await store.db.prepare('SELECT * FROM evidence_uploads WHERE operation_id=? AND owner IN (?,?)').bind(input.operationId,...identity.keys).first<UploadRow>();
  version=await versionByOperation(store,identity,input.operationId);evidence=await evidenceById(store,identity,input.projectId,input.evidenceId);
  if(!upload||!version||!evidence)throw new EvidenceServiceError('Evidence予約結果を確認できません',503);
 }
 let stored=false;
 if(upload.state==='r2_stored')stored=await verifyStoredObject(store,upload.object_key,computedSha,byteSize);
 if(!stored){
  try{
   await store.bucket.put(upload.object_key,input.bytes,{httpMetadata:{contentType:mimeType},customMetadata:{sha256:computedSha,evidenceId:input.evidenceId,versionId:version.id,operationId:input.operationId}});
   if(!await verifyStoredObject(store,upload.object_key,computedSha,byteSize))throw new Error('stored object hash mismatch');
   await store.db.prepare("UPDATE evidence_uploads SET state='r2_stored',error='',updated_at=? WHERE operation_id=? AND owner IN (?,?)").bind(now,input.operationId,...identity.keys).run();
  }catch(e){
   try{await store.db.prepare("UPDATE evidence_uploads SET state='upload_failed',error=?,updated_at=? WHERE operation_id=? AND owner IN (?,?)").bind(String((e as Error)?.message||'R2 upload failed').slice(0,1000),now,input.operationId,...identity.keys).run();}catch{}
   throw new EvidenceServiceError('Evidence原本を保存できませんでした。同じoperation IDで再試行できます。',503);
  }
 }
 try{
  await store.db.batch([
   store.db.prepare("UPDATE evidence_versions SET storage_state='available' WHERE id=? AND project_id=? AND owner IN (?,?) AND upload_operation_id=? AND storage_state='pending'").bind(version.id,input.projectId,...identity.keys,input.operationId),
   store.db.prepare(`UPDATE evidences
    SET current_version_id=?,updated_at=?
    WHERE id=? AND project_id=? AND owner IN (?,?)
      AND (
       current_version_id IS NULL
       OR EXISTS (
        SELECT 1
        FROM evidence_versions incoming
        JOIN evidence_versions current ON current.id=evidences.current_version_id
        WHERE incoming.id=?
          AND incoming.evidence_id=evidences.id
          AND incoming.project_id=evidences.project_id
          AND incoming.owner=evidences.owner
          AND current.evidence_id=evidences.id
          AND current.project_id=evidences.project_id
          AND current.owner=evidences.owner
          AND incoming.version_no>current.version_no
       )
      )`).bind(version.id,now,input.evidenceId,input.projectId,...identity.keys,version.id),
   store.db.prepare("UPDATE evidence_uploads SET state='committed',error='',updated_at=? WHERE operation_id=? AND project_id=? AND owner IN (?,?) AND state IN ('reserved','r2_stored','upload_failed','committed')").bind(now,input.operationId,input.projectId,...identity.keys),
  ]);
  const committedUpload=await store.db.prepare('SELECT state FROM evidence_uploads WHERE operation_id=? AND project_id=? AND owner IN (?,?)').bind(input.operationId,input.projectId,...identity.keys).first<{state:string}>();
  const finalizedVersion=await versionByOperation(store,identity,input.operationId);
  const finalizedEvidence=await evidenceById(store,identity,input.projectId,input.evidenceId);
  if(committedUpload?.state!=='committed'||finalizedVersion?.storage_state!=='available'||!finalizedEvidence?.current_version_id)throw new Error('metadata commit not confirmed');
  const currentVersion=await store.db.prepare('SELECT version_no FROM evidence_versions WHERE id=? AND evidence_id=? AND project_id=? AND owner IN (?,?)').bind(finalizedEvidence.current_version_id,input.evidenceId,input.projectId,...identity.keys).first<{version_no:number}>();
  if(!currentVersion||currentVersion.version_no<version.version_no)throw new Error('current version did not advance monotonically');
 }catch{
  throw new EvidenceServiceError('原本は保存されましたがメタデータ確定に失敗しました。同じoperation IDで再試行してください。',503);
 }
 version=await versionByOperation(store,identity,input.operationId);if(!version||version.storage_state!=='available')throw new EvidenceServiceError('Evidence版の確定結果を確認できません',503);
 evidence=await evidenceById(store,identity,input.projectId,input.evidenceId);if(!evidence?.current_version_id)throw new EvidenceServiceError('Evidence current版の確定結果を確認できません',503);
 return {evidenceId:input.evidenceId,currentVersionId:evidence.current_version_id,version:versionInfo(version),idempotent:false};
}

export async function listEvidence(store:EvidenceStore,identity:EvidenceIdentity,projectId:string):Promise<EvidenceInfo[]>{
 if(!uuidPattern.test(projectId))throw new EvidenceServiceError('案件IDが不正です');
 if(!await ownedProject(store,identity,projectId))throw new EvidenceServiceError('案件が見つかりません',404);
 const evidences=(await store.db.prepare('SELECT * FROM evidences WHERE project_id=? AND owner IN (?,?) ORDER BY created_at,id').bind(projectId,...identity.keys).all<EvidenceRow>()).results;
 const versions=(await store.db.prepare("SELECT * FROM evidence_versions WHERE project_id=? AND owner IN (?,?) AND storage_state='available' ORDER BY evidence_id,version_no").bind(projectId,...identity.keys).all<VersionRow>()).results;
 return evidences.map(row=>({id:row.id,projectId:row.project_id,title:row.title,kind:row.kind,description:row.description,currentVersionId:row.current_version_id||'',createdAt:row.created_at,updatedAt:row.updated_at,versions:versions.filter(v=>v.evidence_id===row.id).map(versionInfo)}));
}

export async function readEvidenceVersion(store:EvidenceStore,identity:EvidenceIdentity,projectId:string,versionId:string){
 if(!uuidPattern.test(projectId)||!uuidPattern.test(versionId))throw new EvidenceServiceError('案件または版IDが不正です');
 if(!await ownedProject(store,identity,projectId))throw new EvidenceServiceError('案件が見つかりません',404);
 const row=await store.db.prepare("SELECT * FROM evidence_versions WHERE id=? AND project_id=? AND owner IN (?,?) AND storage_state='available'").bind(versionId,projectId,...identity.keys).first<VersionRow>();
 if(!row)throw new EvidenceServiceError('Evidence版が見つかりません',404);
 const object=await store.bucket.get(row.object_key),bytes=await readObjectBytes(object);if(!bytes)throw new EvidenceServiceError('Evidence原本を取得できません',503);
 if(bytes.byteLength!==row.byte_size||await sha256Bytes(bytes)!==row.sha256)throw new EvidenceServiceError('Evidence原本のSHA-256検証に失敗しました',503);
 return {version:versionInfo(row),bytes};
}
