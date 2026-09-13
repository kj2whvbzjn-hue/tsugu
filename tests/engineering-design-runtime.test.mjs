import test from 'node:test';
import assert from 'node:assert/strict';
import {PooledProjectAccessRepository,PooledProjectRepository,PooledOutboxStore} from '../engineering-design-graph/runtime.mjs';

function poolWith(handler){let connects=0,releases=0;return{get counts(){return{connects,releases}},async connect(){connects++;return{async query(sql,args){return handler(sql,args)},release(){releases++}}}}}

test('pooled project repository checks out and releases a dedicated client',async()=>{const pool=poolWith(sql=>sql.startsWith('select id from projects')?{rows:[]}:{rows:[]}),repo=new PooledProjectRepository(pool);assert.deepEqual(await repo.list(),[]);assert.deepEqual(pool.counts,{connects:1,releases:1})});

test('pooled project access repository releases client after role lookup',async()=>{const pool=poolWith(()=>({rows:[{role:'architect'}]})),repo=new PooledProjectAccessRepository(pool);assert.equal(await repo.roleFor('p1','user-1'),'architect');assert.deepEqual(pool.counts,{connects:1,releases:1})});

test('pooled outbox store releases client after pending lookup',async()=>{const pool=poolWith(()=>({rows:[{id:'e1'}]})),store=new PooledOutboxStore(pool);assert.deepEqual(await store.pending(10),[{id:'e1'}]);assert.deepEqual(pool.counts,{connects:1,releases:1})});
