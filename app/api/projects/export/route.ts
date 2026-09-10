import {database,originalBucket} from '@/db/store';
import {identityFromHeaders} from '@/app/identity';
import {buildHandoff} from '@/app/handoff';
import {makeBackup,fileResponse} from '@/app/backup';
import {readApprovals} from '@/app/approvals';
export const dynamic='force-dynamic';
const error=(message:string,status:number)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
 const identity=await identityFromHeaders(req.headers);if(!identity)return error('サインインが必要です',401);
 try{
  const params=new URL(req.url).searchParams,id=params.get('id'),kind=params.get('kind')||'backup';
  if(!id||!['backup','original','handoff'].includes(kind))return error('取得対象が不正です',400);
  const db=database(),row=await db.prepare('SELECT body,revision,updated_at FROM projects WHERE id=? AND owner IN (?,?)').bind(id,...identity.keys).first<{body:string;revision:number;updated_at:string}>();
  if(!row)return error('案件が見つかりません',404);
  if(params.has('revision')&&Number(params.get('revision'))!==row.revision)return error('案件が更新されています。最新版を読み直してください。',409);
  const record={project:readApprovals(JSON.parse(row.body),row.revision),revision:row.revision,updatedAt:row.updated_at};
  if(kind==='handoff')return fileResponse(buildHandoff(record,params.get('mode')==='full'?'完全版':'簡潔版'),'handoff.md','text/markdown');
  let originalText:string|undefined,originalFetchError:string|undefined;
  if(kind==='original'||(params.get('original')==='1'&&record.project.sourceInfo)){
   try{const ref=await db.prepare('SELECT object_key FROM original_files WHERE project_id=? AND owner IN (?,?)').bind(id,...identity.keys).first<{object_key:string}>();if(!ref)throw Error('元JSONはこの案件に保存されていません');const file=await originalBucket().get(ref.object_key);if(!file)throw Error('元JSONを取得できません');originalText=await new Response(file.body).text();}catch{originalFetchError='元JSONを取得できませんでした。このファイルは案件本体のみです。';}
  }
  if(kind==='original')return originalText?fileResponse(originalText,'original.json'):error(originalFetchError||'元JSONがありません',503);
  return fileResponse(JSON.stringify(makeBackup(record,originalText,originalFetchError),null,2),'project-backup.json');
 }catch{return error('ファイルを取得できません。入力を残したまま再試行してください。',503);}
}
