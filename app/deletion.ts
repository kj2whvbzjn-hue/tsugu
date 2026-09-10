import {database,originalBucket} from '@/db/store';
/** Retry blob removal after database deletion; failed jobs remain durable and private. */
export async function finishFileDeletions(keys:[string,string]){
 try{const db=database();const jobs=await db.prepare('SELECT object_key FROM deletion_jobs WHERE owner IN (?,?) LIMIT 20').bind(...keys).all();let pending=false;
 for(const row of jobs.results as {object_key:string}[]){try{await originalBucket().delete(row.object_key);await db.prepare('DELETE FROM deletion_jobs WHERE object_key=? AND owner IN (?,?)').bind(row.object_key,...keys).run()}catch(e){console.error('Original file deletion will retry',e);pending=true;}}
 return pending||jobs.results.length===20;
 }catch(e){console.error('File deletion queue unavailable',e);return true;}
}
