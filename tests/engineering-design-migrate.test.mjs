import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMigrations} from '../engineering-design-graph/migrate.mjs';

function fakeClient(){const history=new Map(),queries=[];return{history,queries,async query(sql,args=[]){queries.push({sql,args});if(sql.startsWith('select checksum from schema_migrations'))return{rows:history.has(args[0])?[{checksum:history.get(args[0])}]:[]};if(sql.startsWith('insert into schema_migrations')){history.set(args[0],args[1]);return{rows:[]}}return{rows:[]}}}}

test('migration runner applies once, skips unchanged, and rejects checksum drift',async()=>{const dir=mkdtempSync(join(tmpdir(),'edg-migrate-'));try{writeFileSync(join(dir,'001_first.sql'),'create table first_table(id int);');writeFileSync(join(dir,'002_second.sql'),'create table second_table(id int);');const client=fakeClient(),logger={info(){}};let r=await runMigrations({client,migrationsDir:dir,logger});assert.deepEqual(r.applied,['001_first.sql','002_second.sql']);assert.deepEqual(r.skipped,[]);r=await runMigrations({client,migrationsDir:dir,logger});assert.deepEqual(r.applied,[]);assert.deepEqual(r.skipped,['001_first.sql','002_second.sql']);writeFileSync(join(dir,'001_first.sql'),'create table first_table(id bigint);');await assert.rejects(()=>runMigrations({client,migrationsDir:dir,logger}),/checksum mismatch/i);assert.ok(client.queries.some(q=>q.sql.includes('pg_advisory_lock')));assert.ok(client.queries.some(q=>q.sql==='begin'));assert.ok(client.queries.some(q=>q.sql==='commit'))}finally{rmSync(dir,{recursive:true,force:true})}});
