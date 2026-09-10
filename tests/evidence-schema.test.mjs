import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('evidence storage schema keeps records, immutable versions and retry operations separate',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['0000_tiny_living_tribunal','0001_smooth_shotgun','0002_redundant_hiroim','0003_overjoyed_exiles','0004_blue_yellowjacket','0005_evidence_core'])db.exec(readFileSync('drizzle/'+name+'.sql','utf8').replaceAll('--> statement-breakpoint',''));
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evidence%'").all().map(x=>x.name).sort();
 assert.deepEqual(tables,['evidence_uploads','evidence_versions','evidences']);
 db.prepare("INSERT INTO evidences VALUES (?,?,?,?,?,?,?,?,?)").run('E','P','O','title','file','',null,'a','a');
 db.prepare("INSERT INTO evidence_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run('V1','E','P','O',1,'a.txt','text/plain',1,'hash','evidence/P/E/V1','available','OP1','a');
 assert.throws(()=>db.prepare("INSERT INTO evidence_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run('V2','E','P','O',1,'b.txt','text/plain',1,'hash2','evidence/P/E/V2','available','OP2','b'),/UNIQUE/);
 db.prepare("INSERT INTO evidence_uploads VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('OP1','P','E','O','committed','evidence/P/E/V1','hash',1,'','a','a');
 assert.equal(db.prepare('SELECT count(*) n FROM evidence_uploads').get().n,1);
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 const entry=journal.entries.find(x=>x.tag==='0005_evidence_core');
 assert.ok(entry);assert.equal(entry.idx,5);assert.equal(entry.version,'6');
 const snapshot=JSON.parse(readFileSync('drizzle/meta/0005_snapshot.json','utf8'));
 assert.equal(snapshot.prevId,JSON.parse(readFileSync('drizzle/meta/0004_snapshot.json','utf8')).id);
 for(const name of ['evidences','evidence_versions','evidence_uploads'])assert.ok(snapshot.tables[name],`snapshot missing ${name}`);
 assert.deepEqual(snapshot.tables.evidence_versions.indexes.evidence_versions_evidence_version,{name:'evidence_versions_evidence_version',columns:['evidence_id','version_no'],isUnique:true});
 const sqliteIndexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name LIKE 'evidence%' AND sql IS NOT NULL ORDER BY name").all();
 assert.deepEqual(sqliteIndexes.map(x=>x.name),['evidence_uploads_project_owner','evidence_versions_evidence_version','evidence_versions_project_owner','evidences_project_owner']);
 db.close();
});
