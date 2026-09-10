import {database,evidenceBucket} from '@/db/store';
import {identityFromHeaders} from '@/app/identity';
import {EvidenceServiceError,listEvidence,readEvidenceVersion,registerEvidence} from '@/app/evidence-service';

export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const unauthenticated=()=>json({error:'ChatGPTへのサインインが必要です',code:'AUTH_REQUIRED'},401);
const sameOrigin=(req:Request)=>{const origin=req.headers.get('origin');return !origin||origin===new URL(req.url).origin;};
const store=()=>({db:database() as any,bucket:evidenceBucket() as any});
function serviceError(e:unknown){if(e instanceof EvidenceServiceError)return json({error:e.message},e.status);console.error(e);return json({error:'Evidenceを処理できませんでした。同じoperation IDで再試行できます。'},503);}

export async function GET(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return unauthenticated();
 try{
  const params=new URL(req.url).searchParams,projectId=params.get('projectId')||'',versionId=params.get('versionId')||'';
  if(versionId){
   const result=await readEvidenceVersion(store(),identity,projectId,versionId),name=result.version.originalFilename.replace(/[^\x20-\x7E]|["\\]/g,'_');
   return new Response(result.bytes,{headers:{'Content-Type':result.version.mimeType||'application/octet-stream','Content-Length':String(result.bytes.byteLength),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Evidence-SHA256':result.version.sha256,'Content-Disposition':`attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(result.version.originalFilename)}`}});
  }
  return json({evidences:await listEvidence(store(),identity,projectId)});
 }catch(e){return serviceError(e);}
}

export async function POST(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return unauthenticated();
 if(!sameOrigin(req))return json({error:'許可されていない操作です'},403);
 try{
  const form=await req.formData(),file=form.get('file') as any;
  if(!file||typeof file.arrayBuffer!=='function')return json({error:'登録するファイルを選択してください'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const result=await registerEvidence(store(),identity,{
   projectId:String(form.get('projectId')||''),evidenceId:String(form.get('evidenceId')||''),operationId:String(form.get('operationId')||''),
   title:String(form.get('title')||''),kind:String(form.get('kind')||'file'),description:String(form.get('description')||''),
   originalFilename:String(file.name||form.get('originalFilename')||'evidence.bin'),mimeType:String(file.type||form.get('mimeType')||'application/octet-stream'),
   bytes,expectedSha256:String(form.get('expectedSha256')||'')||undefined,
  });
  return json(result,result.idempotent?200:201);
 }catch(e){return serviceError(e);}
}
