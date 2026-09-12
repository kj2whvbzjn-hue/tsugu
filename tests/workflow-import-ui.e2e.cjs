const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const target=process.env.WORKFLOW_TARGET_URL||'http://127.0.0.1:4173/';
const sample=fs.readFileSync('static/project-import-example.json','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}}),files=new Map(),errors=[];let puts=0,failAt=Infinity;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://api.github.com/**',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname.split('/contents/')[1];let body={},status=200;
  if(u.pathname==='/user')body={login:'import-test',type:'User'};
  else if(u.pathname==='/repos/kj2whvbzjn-hue/tsugu-data')body={private:true,permissions:{push:true}};
  else if(u.pathname.includes('/branches/'))body={name:'main'};
  else if(req.method()==='PUT'){
   puts++;const b=req.postDataJSON();assert.equal(b.branch,'main');
   if(puts===failAt){await route.abort('failed');return;}
   assert.ok(!files.has(path),'Import must not overwrite an existing file');assert.ok(!b.sha);
   files.set(path,{content:b.content,sha:'blob-'+puts});body={content:{sha:'blob-'+puts},commit:{sha:'a'.repeat(39)+puts}};
  }else if(path==='data/workflow-projects')body=[...files.keys()].map(path=>({type:'file',name:path.split('/').at(-1),path}));
  else if(path?.startsWith('data/workflow-projects/')){body=files.get(path);if(!body){body={message:'Not Found'};status=404;}}
  else throw new Error('Unexpected route '+u.pathname);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 async function connect(){await page.locator('[name=token]').fill('test-token');await click('接続');await page.getByRole('status').filter({hasText:'として接続'}).waitFor();}
 async function preview(text){await click('JSON一括取り込み');await page.locator('#import-editor textarea').fill(text);await click('取り込み内容を確認');await page.getByRole('dialog',{name:'新規案件の一括登録',exact:true}).waitFor();}
 const evidence={status:'RUNNING',network:'Stateful GitHub API fixture',scenarios:[]};
 try{
  await page.goto(target);assert.equal(await page.getByRole('link',{name:'取り扱い説明書',exact:true}).getAttribute('href'),'./manual.html');
  const manual=await browser.newPage({viewport:{width:390,height:844}});await manual.goto(new URL('manual.html',target).href);await manual.getByRole('heading',{name:'取り扱い説明書',exact:true}).waitFor();assert.ok(await manual.getByRole('link',{name:'サンプルJSONをダウンロード（2案件）'}).count());
  const downloaded=await (await manual.request.get(new URL('project-import-example.json',target).href)).json();assert.equal(downloaded.projects.length,2);
  const metrics=await manual.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));assert.ok(metrics.s<=metrics.w+1);await manual.screenshot({path:'outputs/manual-mobile.png',fullPage:true});await manual.close();
  await connect();await click('JSON一括取り込み');await page.locator('#import-editor textarea').fill('{bad');await click('取り込み内容を確認');await page.getByRole('alert').first().waitFor();assert.equal(puts,0);
  const broken=JSON.parse(sample);broken.projects[1].tasks[0].box_id='missing';await page.locator('#import-editor textarea').fill(JSON.stringify(broken));await click('取り込み内容を確認');await page.getByRole('alert').first().filter({hasText:'案件 2'}).waitFor();assert.equal(puts,0);
  await page.locator('#import-file').setInputFiles({name:'new-projects.json',mimeType:'application/json',buffer:Buffer.from(sample)});await page.getByRole('status').filter({hasText:'ファイルを読み込み'}).waitFor();await click('取り込み内容を確認');await page.getByRole('dialog',{name:'新規案件の一括登録',exact:true}).waitFor();assert.equal(puts,0);
  await click('2案件をGitHubへ登録');await page.getByRole('status').filter({hasText:'2案件をGitHubへ登録しました'}).waitFor();assert.equal(puts,2);assert.equal(files.size,2);
  const download=page.waitForEvent('download');await click('登録結果JSONを保存');await (await download).saveAs('outputs/import-receipt-test.json');const receipt=JSON.parse(fs.readFileSync('outputs/import-receipt-test.json'));assert.ok(receipt.entries.every(e=>e.status==='登録済み'));assert.ok(!JSON.stringify(receipt).includes('test-token'));
  await click('閉じる');await page.getByRole('button',{name:'新サービスの受付機能',exact:true}).click();await page.getByRole('heading',{name:'新サービスの受付機能',exact:true}).waitFor();await page.getByRole('tab',{name:'Task',exact:true}).click();await page.getByRole('button',{name:'受付仕様を整理する',exact:true}).waitFor();await click('案件一覧');
  await page.reload();await connect();assert.equal(await page.locator('[data-action=open]').count(),2);
  evidence.scenarios.push('Public manual and sample; invalid JSON and later-project validation write nothing; file upload preview; two-project save receipt and reload');
  failAt=puts+2;await preview(JSON.stringify({schema_version:'tsugu-project-import/1',projects:[{name:'部分成功'},{name:'通信失敗'},{name:'未送信'}]}));await click('3案件をGitHubへ登録');await page.getByRole('alert').first().filter({hasText:'停止'}).waitFor();assert.equal(puts,4);assert.equal(files.size,3);
  const dialog=page.getByRole('dialog');await dialog.getByText('要確認',{exact:true}).waitFor();await dialog.getByText('未登録',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'3案件をGitHubへ登録',exact:true}).count(),0);
  await page.screenshot({path:'outputs/import-result-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'outputs/import-result-desktop.png',fullPage:true});
  evidence.scenarios.push('Paste input; partial failure preserves saved projects, stops later writes and disables retry');assert.deepEqual(errors,[]);evidence.status='PASS';evidence.puts=puts;
 }catch(e){evidence.status='FAIL';evidence.error=e.stack;throw e;}finally{fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/import-ui-evidence.json',JSON.stringify(evidence,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
