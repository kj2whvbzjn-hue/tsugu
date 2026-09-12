const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const target=process.env.WORKFLOW_TARGET_URL||'http://127.0.0.1:4173/';
fs.mkdirSync('outputs',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];let stored=null,version=0,puts=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!(/404/.test(m.text())&&m.location().url.startsWith('https://api.github.com/repos/kj2whvbzjn-hue/tsugu-data/contents/data/workflow-projects/')))errors.push(m.text())});page.on('dialog',d=>d.accept());
 await page.route('https://api.github.com/**',async route=>{const req=route.request(),u=new URL(req.url());let body={},status=200;
  if(u.pathname==='/user')body={login:'workflow-test',type:'User'};
  else if(u.pathname==='/repos/kj2whvbzjn-hue/tsugu-data')body={private:true,permissions:{push:true}};
  else if(u.pathname.includes('/branches/'))body={name:'main'};
  else if(req.method()==='PUT'){const b=req.postDataJSON();assert.equal(b.branch,'main');if(stored&&b.sha!==stored.sha){status=409;}else{puts++;stored={content:b.content,sha:'sha-'+(++version)};body={content:{sha:stored.sha},commit:{sha:'commit-'+version}};}}
  else if(u.pathname.endsWith('/contents/data/workflow-projects'))body=stored?[{type:'file',name:JSON.parse(Buffer.from(stored.content,'base64').toString()).workspace.id+'.json',path:'data/workflow-projects/'+JSON.parse(Buffer.from(stored.content,'base64').toString()).workspace.id+'.json'}]:[];
  else if(u.pathname.includes('/contents/data/workflow-projects/')){if(stored)body=stored;else{status=404;body={message:'Not Found'};}}
  else {status=404;errors.push('Unexpected '+u.pathname);}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const click=(text)=>page.getByRole('button',{name:text,exact:true}).click();
 async function connected(){const details=page.locator('.connection');if((await details.getAttribute('open'))===null)await details.locator('summary').click();await page.locator('[name=token]').fill('ephemeral-test-token');await click('接続');await page.getByRole('status').filter({hasText:'として接続'}).waitFor();}
 async function tab(text){await page.getByRole('tab',{name:text,exact:true}).click();}
 async function add(collection,values){await page.locator(`[data-action=add][data-collection=${collection}]`).first().click();for(const [k,v] of Object.entries(values)){const e=page.locator(`#record-editor [name=${k}]`);const tag=await e.evaluate(el=>el.tagName);if(tag==='SELECT')await e.selectOption(v);else if(typeof v==='boolean')await e.setChecked(v);else await e.fill(v);}await click('変更を反映');await page.locator('.dialog').waitFor({state:'hidden'});}
 const result={status:'RUNNING',target,scenarios:[],network:'GitHub API intercepted with stateful optimistic-concurrency fixture',browser:'Chromium',viewport:{width:390,height:844}};
 try{
  await page.goto(target);await connected();await click('＋ 新規案件');await page.locator('#new-project [name=name]').fill('工程移植 E2E');await click('作成');
  await tab('構成');await add('architecture_nodes',{name:'画面開発'});await add('work_boxes',{title:'受付画面',body:'利用者が依頼を登録する'});
  await add('tasks',{title:'登録の実装',acceptance_criteria:'受付の結果が保存・再読込後も一致する',requires_human_approval:true});
  result.scenarios.push('Hierarchy creation with required acceptance criteria');
  await tab('工程・確認');await click('実装準備へ');assert.equal(await page.getByRole('button',{name:'実装開始を承認',exact:true}).isDisabled(),true);
  await add('checks',{title:'開始前確認',gate:'Implementation',status:'Passed',result:'仕様を確認',evidence:'仕様レビュー記録'});
  await click('実装開始を承認');await page.locator('.stage.current').filter({hasText:'実装'}).waitFor();
  await tab('Task');await click('Taskを承認');await click('開始');await page.locator('.badge').filter({hasText:'Doing'}).waitFor();
  await tab('工程・確認');await add('checks',{target_type:'Task',title:'初回確認',gate:'Completion',status:'Failed',result:'再読込で不一致',evidence:'run-1'});
  const failureId=await page.locator('.card').filter({hasText:'初回確認'}).locator('.tiny').first().innerText();
  await tab('Task');await click('完了');await page.getByRole('alert').first().waitFor();
  result.scenarios.push('Human start and task approvals; mandatory FAIL blocks completion');
  await tab('工程・確認');await add('checks',{target_type:'Task',title:'再確認',gate:'Completion',status:'Passed',result:'再読込後も一致',evidence:'run-2',resolves_check_ids:failureId});
  await page.getByText('Failed → 解決済み',{exact:true}).waitFor();
  await tab('Task');await click('完了');await page.locator('.badge').filter({hasText:'Done'}).waitFor();
  await tab('工程・確認');await click('確認工程へ');await click('完了を承認');await page.locator('.stage.current').filter({hasText:'完了'}).waitFor();
  await click('GitHubへ保存');await page.getByRole('status').filter({hasText:'GitHubへ保存しました'}).waitFor();assert.equal(puts,1);
  const snapshot=JSON.parse(Buffer.from(stored.content,'base64').toString());assert.equal(snapshot.workflow.stage,'Completed');assert.equal(snapshot.tasks[0].status,'Done');assert.equal(snapshot.checks.find(c=>c.id===failureId).status,'Failed');assert.equal(snapshot.revision,1);
  result.scenarios.push('Immutable FAIL resolved by retest; final approval; Git save');
  await page.reload();await connected();await page.locator('[data-action=open]').first().click();await page.getByRole('heading',{name:'工程移植 E2E',exact:true}).waitFor();
  await tab('工程・確認');await page.locator('.stage.current').filter({hasText:'完了'}).waitFor();await page.getByText('Failed → 解決済み',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,JSON.stringify(metrics));
  await page.screenshot({path:'outputs/workflow-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'outputs/workflow-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);result.scenarios.push('Reload restores canonical project; no browser persistence; mobile no overflow');result.status='PASS';result.metrics=metrics;result.puts=puts;result.consoleErrors=errors;

 }catch(e){result.error=e.stack;result.status='FAIL';throw e;}finally{fs.writeFileSync('outputs/workflow-ui-evidence.json',JSON.stringify(result,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
