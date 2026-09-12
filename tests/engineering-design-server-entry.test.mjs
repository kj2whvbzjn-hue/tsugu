import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installShutdownHandlers} from '../engineering-design-graph/server-entry.mjs';

test('shutdown handlers close runtime once on SIGTERM/SIGINT',async()=>{const processRef=new EventEmitter();processRef.pid=123;processRef.exitCode=null;let closes=0;const entries=[],logger={info:(event,fields)=>entries.push({event,...fields}),error:(event,fields)=>entries.push({event,...fields})},runtime={logger,async close(){closes++}};installShutdownHandlers(runtime,{processRef,logger});processRef.emit('SIGTERM');processRef.emit('SIGINT');await new Promise(r=>setImmediate(r));assert.equal(closes,1);assert.equal(processRef.exitCode,0);assert.equal(entries[0].event,'server.shutdown_requested');assert.equal(entries[0].signal,'SIGTERM')});
