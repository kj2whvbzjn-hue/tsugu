import {idempotencyTargetPath,idempotencyFingerprint,idempotencyScope} from './idempotency.mjs';

const conflict=()=>Object.assign(new Error('Idempotency-Key reused with different request payload'),{status:409,code:'IDEMPOTENCY_CONFLICT'});
const inProgress=()=>Object.assign(new Error('Idempotency-Key request is already in progress'),{status:409,code:'IDEMPOTENCY_IN_PROGRESS'});

export class PostgresIdempotencyStore{
  constructor(pool,{ttlMs=86_400_000}={}){if(!pool?.query)throw new Error('PostgreSQL pool/client with query() is required');if(!Number.isInteger(ttlMs)||ttlMs<=0)throw new Error('ttlMs must be positive');this.pool=pool;this.ttlMs=ttlMs}
  appliesTo(method,path){return String(method).toUpperCase()==='POST'&&idempotencyTargetPath(path)}
  async lookup({principal,method,path,key,body}){
    if(!key)return null;const scope=idempotencyScope({principal,method,path,key}),fp=idempotencyFingerprint(method,path,body);
    await this.pool.query('delete from idempotency_records where scope=$1 and expires_at<=now()',[scope]);
    const inserted=await this.pool.query(`insert into idempotency_records(scope,fingerprint,state,response,expires_at) values($1,$2,'pending',null,now()+($3::bigint * interval '1 millisecond')) on conflict(scope) do nothing returning scope`,[scope,fp,this.ttlMs]);
    if(inserted.rows[0])return{scope,fingerprint:fp,hit:false,reserved:true};
    const existing=(await this.pool.query('select fingerprint,state,response from idempotency_records where scope=$1',[scope])).rows[0];if(!existing)return this.lookup({principal,method,path,key,body});if(existing.fingerprint!==fp)throw conflict();if(existing.state==='pending')throw inProgress();return{scope,fingerprint:fp,hit:true,reserved:false,response:existing.response};
  }
  async store({scope,fingerprint,response}){const r=await this.pool.query(`update idempotency_records set state='completed',response=$3::jsonb,updated_at=now() where scope=$1 and fingerprint=$2 returning *`,[scope,fingerprint,JSON.stringify(response)]);if(!r.rows[0])throw new Error('Idempotency reservation missing');return r.rows[0]}
  async release(scope){await this.pool.query(`delete from idempotency_records where scope=$1 and state='pending'`,[scope])}
  async cleanup(){const r=await this.pool.query('delete from idempotency_records where expires_at<=now() returning scope');return r.rows.length}
}
