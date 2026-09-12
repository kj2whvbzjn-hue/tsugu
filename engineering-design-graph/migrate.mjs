import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const defaultMigrationsDir=join(dirname(fileURLToPath(import.meta.url)),'db');
const checksum=text=>createHash('sha256').update(text).digest('hex');

export async function runMigrations({client,migrationsDir=defaultMigrationsDir,logger=console}={}){
  if(!client?.query)throw new Error('PostgreSQL client with query() is required');
  await client.query(`create table if not exists schema_migrations(filename text primary key,checksum text not null,applied_at timestamptz not null default now())`);
  await client.query(`select pg_advisory_lock(hashtext('engineering-design-graph-migrations'))`);
  const result={applied:[],skipped:[]};
  try{
    const files=(await readdir(migrationsDir)).filter(x=>/^\d+.*\.sql$/.test(x)).sort();
    for(const filename of files){
      const sql=await readFile(join(migrationsDir,filename),'utf8'),sha=checksum(sql),existing=await client.query('select checksum from schema_migrations where filename=$1',[filename]);
      if(existing.rows[0]){if(existing.rows[0].checksum!==sha)throw new Error(`Migration checksum mismatch: ${filename}`);result.skipped.push(filename);continue}
      await client.query('begin');
      try{await client.query(sql);await client.query('insert into schema_migrations(filename,checksum) values($1,$2)',[filename,sha]);await client.query('commit');result.applied.push(filename);logger?.info?.(`Applied migration ${filename}`)}catch(error){await client.query('rollback');throw error}
    }
    return result;
  }finally{await client.query(`select pg_advisory_unlock(hashtext('engineering-design-graph-migrations'))`)}
}

async function main(){const pg=await import('pg'),Pool=pg.Pool||pg.default?.Pool;if(!Pool)throw new Error('pg.Pool is required');const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE});try{const client=await pool.connect();try{const result=await runMigrations({client});console.log(JSON.stringify({event:'migrations.complete',...result}))}finally{client.release()}}finally{await pool.end()}}

if(import.meta.url===`file://${process.argv[1]}`)main().catch(error=>{console.error(JSON.stringify({event:'migrations.failed',message:String(error?.message||error)}));process.exitCode=1});
