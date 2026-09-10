import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const record=JSON.parse(readFileSync('change-records/FT-13.json','utf8'));

test('historical FT-13 ledger explains its recorded deviations independently of later work',()=>{
 const actual=record.actualFiles;
 assert.equal(new Set(actual).size,actual.length);
 const planned=new Set(record.plannedFiles);
 for(const path of actual)if(!planned.has(path))assert.ok(record.deviations[path],`計画外差分の理由がありません: ${path}`);
});

test('FT-13 ledger retains baseline, dependencies, protected areas, tests and rollback',()=>{
 assert.match(record.baseline.gitCommit,/^[a-f0-9]{40}$/);
 assert.ok(record.baseline.siteVersion>0&&record.baseline.projectRevision>0);
 for(const key of ['dependencies','protectedAreas','verificationPlan','verificationEvidence'])assert.ok(record[key].length,`${key} is empty`);
 assert.ok(record.rollbackPlan.trim());
});
