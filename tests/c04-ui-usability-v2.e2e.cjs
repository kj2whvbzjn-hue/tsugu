const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const plan = JSON.parse(fs.readFileSync('static/c04-ui-usability-plan-v2.json','utf8'));
assert.equal(plan.status,'FROZEN_BEFORE_EXECUTION');
assert.equal(plan.version,2);

const owner='kj2whvbzjn-hue';
const repo='tsugu';
const token=process.env.GH_TOKEN_E2E || process.env.GITHUB_TOKEN;
const targetUrl=process.env.C04_TARGET_URL || plan.target.publishedUrl;
const runId=process.env.GITHUB_RUN_ID || String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT || '1';
const sourceSha=process.env.GITHUB_SHA || '';
if(!token) throw new Error('GitHub token is required');
const tempBranch=`c04-ui-v2-e2e-${runId}-${runAttempt}`;
const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'tsugu-c04-ui-v2-e2e'};

async function api(path, options={}, allow404=false){
  const r=await fetch(`https://api.github.com${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const text=await r.text(); let body=null; try{body=text?JSON.parse(text):null;}catch{body={message:text};}
  if(allow404 && r.status===404) return null;
  if(!r.ok) throw new Error(`GitHub ${r.status}: ${text}`);
  return body;
}
async function listProjects(){
  const rows=await api(`/repos/${owner}/${repo}/contents/data/projects?ref=${encodeURIComponent(tempBranch)}`,{},true);
  return Array.isArray(rows)?rows.filter(x=>x.type==='file'&&x.name.endsWith('.json')):[];
}
async function readProjectOnce(path){
  const f=await api(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(tempBranch)}`);
  return JSON.parse(Buffer.from(f.content.replace(/\n/g,''),'base64').toString('utf8'));
}
async function readProject(path){
  for(let i=0;i<12;i++){
    try{return await readProjectOnce(path);}catch(e){if(!String(e&&e.message||e).includes('GitHub 404')||i===11)throw e;await new Promise(r=>setTimeout(r,500));}
  }
}
function emptyCore(){return{architectureNodes:[],workBoxes:[],tasks:[],decisions:[],issues:[],checks:[],approvals:[],evidences:[],evidenceVersions:[],repositories:[],repositoryBaselines:[],pathEntries:[],plannedChanges:[],actualChanges:[],relations:[]};}
function planProject(){
  return {
    schemaVersion:1,
    id:'33333333-4444-4555-8666-777777777777',
    name:'C-04 UI/使用性テスト計画 v2',
    purpose:'絶対上下移動量・直接到達・保存削除reloadを事前固定基準でPlaywright実機確認する',
    rules:'v2結果確認後に合格基準を緩めない。旧v1結果をv2合格の代用にしない。承認・完了状態を推測変更しない。',
    focus:'検索・絞込・20件以下のページ表示・sticky操作・絶対スクロール量・削除再読込整合',
    baseline:'C-04|version=2|static/c04-ui-usability-plan-v2.json',
    changeControlEnabled:true,
    next:'登録済みv2基準どおりUI2-01〜UI2-08を実行する',
    stage:'検討',implementationApproved:false,completionApproved:false,core:emptyCore(),
    items:plan.scenarios.map(s=>({id:s.id,kind:'検証',title:s.name,body:`Actions\n${JSON.stringify(s.actions||[],null,2)}\n\nPass\n${JSON.stringify(s.pass||[],null,2)}`,status:'未確認',parentId:'',reason:'C-04 frozen acceptance plan v2'}))
  };
}
function workloadProject(){
  const items=[];
  items.push({id:'ARC-NIP',kind:'構成',title:'修正版34仕様実装',body:'全項目の独立計画',status:'未着手',parentId:'',reason:''});
  for(let i=1;i<=34;i++)items.push({id:`GS-${String(i).padStart(2,'0')}`,kind:'構成',title:`仕様 ${i}`,body:`仕様本文 ${i}`,status:'要確認',parentId:'ARC-NIP',reason:'ユーザー提供仕様'});
  for(let i=1;i<=37;i++)items.push({id:`WB-${String(i).padStart(2,'0')}`,kind:'作業',title:`Work Box ${i}`,body:`Work Box ${i}`,status:'未着手',parentId:'ARC-NIP',reason:''});
  for(let i=1;i<=90;i++)items.push({id:`TASK-${String(i).padStart(3,'0')}`,kind:'作業',title:`Task ${i}`,body:`Task ${i} implementation`,status:i<=16?'保留':'未着手',parentId:`WB-${String(((i-1)%37)+1).padStart(2,'0')}`,reason:'',task:{workType:'DEVELOPMENT_ONLY',executionOrder:i,dependsOn:i>1?[`TASK-${String(i-1).padStart(3,'0')}`]:[],acceptanceCriteria:[`Task ${i} acceptance`],requiresHumanApproval:false,references:[],reviewRequired:false}});
  for(let i=1;i<=34;i++)items.push({id:`CHECK-${String(i).padStart(2,'0')}`,kind:'検証',title:`Check ${i}`,body:'',status:'未確認',parentId:`TASK-${String(i).padStart(3,'0')}`,reason:''});
  assert.equal(items.length,196);
  return {schemaVersion:1,id:'11111111-2222-4333-8444-555555555555',name:'C-04 UI負荷・使用性テスト v2 196項目',purpose:'C-04 v2代表ワークロード',rules:'承認・完了を推測しない',focus:'検索・絞込・ページングによる直接到達',baseline:'C-04 v2 representative workload',changeControlEnabled:true,next:'v2 UIテスト後に削除',stage:'検討',implementationApproved:false,completionApproved:false,core:emptyCore(),items};
}

const evidence={type:'TSUGUC04UIUsabilityV2Evidence',taskId:'C-04',planVersion:2,sourceSha,targetUrl,runId,runAttempt,tempBranch,status:'RUNNING',scenarios:{},saved:{},viewports:{},lookups:{},filters:{},navigation:[],runtime:{consoleErrors:[],pageErrors:[],apiErrors:[]},cleanup:{}};
function mark(id,status,detail={}){evidence.scenarios[id]={status,...detail};}
function writeEvidence(){fs.writeFileSync('c04-ui-usability-v2-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
function shaText(text){return crypto.createHash('sha256').update(text).digest('hex');}
async function noOverflow(page,label){const x=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(x.scrollWidth<=x.clientWidth+1,`${label}: horizontal overflow ${JSON.stringify(x)}`);}
async function visibleProjectTexts(page){return page.locator('.project-list button').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';}).map(e=>(e.textContent||'').trim()));}
async function visibleItemRows(page){return page.locator('.item-card-compact:visible').count();}
async function pageMetrics(page){return page.evaluate(()=>({scrollY:window.scrollY,scrollHeight:document.documentElement.scrollHeight,clientHeight:window.innerHeight,clientWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}));}
async function touchAtLeast44(locator,label){const b=await locator.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,`${label}: ${b&&`${b.width}x${b.height}`}`);}
async function centerUncovered(page,locator,label){const box=await locator.boundingBox();assert.ok(box,`${label}: no bounding box`);const h=await locator.elementHandle();assert.ok(h,`${label}: no handle`);const ok=await page.evaluate(({x,y,target})=>{const hit=document.elementFromPoint(x,y);return !!hit&&(hit===target||target.contains(hit));},{x:box.x+box.width/2,y:box.y+box.height/2,target:h});assert.equal(ok,true,`${label}: covered`);}
async function connect(page){
  const inputs=page.locator('input');assert.ok(await inputs.count()>=4,'connection inputs missing');
  await inputs.nth(0).fill(owner);await inputs.nth(1).fill(repo);await inputs.nth(2).fill(tempBranch);await inputs.nth(3).fill('github_pat_c04_v2_placeholder');
  await page.getByRole('button',{name:'接続',exact:true}).click();
  await page.getByText(/GitHubから\d+件を読み込みました/).waitFor({timeout:30000});
}
async function importAndSave(page,project,fileName){
  const text=JSON.stringify(project,null,2)+'\n';
  const chooserPromise=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'JSONから新規取込',exact:true}).click();
  const chooser=await chooserPromise;await chooser.setFiles({name:fileName,mimeType:'application/json',buffer:Buffer.from(text)});
  await page.getByRole('button',{name:'GitHubへ保存',exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'GitHubへ保存',exact:true}).click();
  await page.getByText(/GitHubへ保存しました。案件版 1/).waitFor({timeout:30000});
  return shaText(text);
}
async function findSavedByPrefix(prefix){
  for(let t=0;t<30;t++){
    const rows=await listProjects();
    for(const row of rows){try{const rec=await readProject(row.path);if(rec?.project?.name?.startsWith(prefix))return{row,rec};}catch(e){if(!String(e.message).includes('GitHub 404'))throw e;}}
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error(`saved project not found: ${prefix}`);
}
async function waitProjectCounts(page,apiCount,visibleCount,timeoutMs=30000){
  const end=Date.now()+timeoutMs;let a=-1,v=[];
  while(Date.now()<end){a=(await listProjects()).length;v=await visibleProjectTexts(page);if(a===apiCount&&v.length===visibleCount)return{api:a,visible:v};await page.waitForTimeout(250);}
  throw new Error(`project counts did not converge: api=${a}, visible=${JSON.stringify(v)}`);
}
async function lookupObjective(page,id,maxTravel){
  const input=page.locator('#itemSearch');await input.waitFor({state:'visible'});
  const start=await page.evaluate(()=>window.scrollY);let last=start,travel=0;
  const sample=async()=>{const y=await page.evaluate(()=>window.scrollY);travel+=Math.abs(y-last);last=y;};
  await input.fill(id);await sample();await input.press('Enter');await page.waitForTimeout(100);await sample();
  assert.equal(await visibleItemRows(page),1,`${id}: visible rows`);
  const row=page.locator(`[data-item-row="${id}"]`);await row.waitFor({state:'visible',timeout:10000});await row.scrollIntoViewIfNeeded();await sample();
  assert.equal((await row.locator('.item-id').textContent()).trim(),id);
  const edit=row.locator('[data-edit]');await edit.click();await page.getByText('項目編集',{exact:true}).waitFor();await sample();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();await sample();
  assert.ok(travel<=maxTravel,`${id}: travel ${travel} > ${maxTravel}`);
  return {startY:start,endY:last,travel};
}

(async()=>{
  const mainRef=await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  await api(`/repos/${owner}/${repo}/git/refs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:`refs/heads/${tempBranch}`,sha:mainRef.object.sha})});
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let expectedWorkspace404=true, expectedMutation404=false;
  page.on('console',m=>{if(m.type()!=='error')return;const text=m.text();if(text.startsWith('Failed to load resource: the server responded with a status of 404')&&(expectedWorkspace404||expectedMutation404))return;evidence.runtime.consoleErrors.push({text,url:m.location()?.url||''});});
  page.on('pageerror',e=>evidence.runtime.pageErrors.push({text:e.message}));
  page.on('response',r=>{if(!r.url().startsWith('https://api.github.com/')||r.status()<400)return;if(r.status()===404&&(expectedWorkspace404||expectedMutation404))return;evidence.runtime.apiErrors.push({url:r.url(),status:r.status()});});
  let navTracking=false;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&navTracking)evidence.navigation.push({url:frame.url(),at:new Date().toISOString()});});
  page.on('dialog',async d=>{if(d.type()==='prompt')await d.accept('C-04 v2 UI/使用性E2E');else await d.accept();});
  await page.addInitScript(({token,owner,repo})=>{
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input.url;
      if(url==='https://api.github.com/user')return new Response(JSON.stringify({login:owner,id:1,type:'User'}),{status:200,headers:{'content-type':'application/json'}});
      const h=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined)||{});if(url.startsWith('https://api.github.com/'))h.set('Authorization',`Bearer ${token}`);
      const r=await nativeFetch(input,{...init,headers:h});
      if(url===`https://api.github.com/repos/${owner}/${repo}`&&r.ok){const data=await r.clone().json();data.private=true;data.permissions={admin:true,maintain:true,push:true,pull:true};return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});}return r;
    };
  },{token,owner,repo});

  try{
    await page.goto(`${targetUrl}?c04v2=${runId}`,{waitUntil:'networkidle',timeout:60000});navTracking=true;
    await connect(page);expectedWorkspace404=false;
    assert.equal((await listProjects()).length,0);

    expectedMutation404=true;
    const planHash=await importAndSave(page,planProject(),'c04-v2-plan.json');
    expectedMutation404=false;
    const savedPlan=await findSavedByPrefix('C-04 UI/使用性テスト計画 v2');
    assert.equal(savedPlan.rec.revision,1);assert.equal(savedPlan.rec.project.items.length,plan.scenarios.length);assert.match(savedPlan.rec.project.baseline,/version=2/);assert.equal(savedPlan.rec.project.implementationApproved,false);assert.equal(savedPlan.rec.project.completionApproved,false);
    evidence.saved.plan={path:savedPlan.row.path,projectId:savedPlan.rec.project.id,fixtureSha256:planHash};

    expectedMutation404=true;
    const workloadHash=await importAndSave(page,workloadProject(),'c04-v2-workload.json');
    expectedMutation404=false;
    const savedWork=await findSavedByPrefix('C-04 UI負荷・使用性テスト v2 196項目');
    assert.equal(savedWork.rec.project.items.length,196);assert.equal(savedWork.rec.project.items.filter(x=>x.task).length,90);assert.equal(savedWork.rec.project.implementationApproved,false);assert.equal(savedWork.rec.project.completionApproved,false);
    evidence.saved.workload={path:savedWork.row.path,projectId:savedWork.rec.project.id,fixtureSha256:workloadHash};

    // Mobile bounded default item view.
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
    await page.getByRole('button',{name:'項目',exact:true}).click();await page.locator('#itemSearch').waitFor();
    const mobileRows=await visibleItemRows(page);const mobileMetrics=await pageMetrics(page);
    assert.ok(mobileRows<=plan.budgets.maxVisibleItemRows,`mobile rows ${mobileRows}`);
    assert.equal(await page.locator('.item-card-compact p').count(),0,'item body expanded by default');
    assert.ok(mobileMetrics.scrollHeight<=mobileMetrics.clientHeight*plan.budgets.mobileDefaultItemPageMaxViewportHeights,`mobile height ${mobileMetrics.scrollHeight}/${mobileMetrics.clientHeight}`);
    await noOverflow(page,'mobile item page');
    for(const [sel,label] of [['#itemSearch','search'],['#itemKindFilter','kind filter'],['#itemStatusFilter','status filter'],['#applyItemFilter','apply filter'],['#clearItemFilter','clear filter'],['#itemNext','next page']])await touchAtLeast44(page.locator(sel),`mobile ${label}`);
    evidence.viewports.mobile={...mobileMetrics,visibleRows:mobileRows,heightRatio:mobileMetrics.scrollHeight/mobileMetrics.clientHeight};
    mark('UI2-01','PASS',{mobile:evidence.viewports.mobile});

    const t90=await lookupObjective(page,'TASK-090',plan.budgets.mobilePerLookupCumulativeVerticalTravelPx);
    await page.locator('#clearItemFilter').click();
    const c34=await lookupObjective(page,'CHECK-34',plan.budgets.mobilePerLookupCumulativeVerticalTravelPx);
    evidence.lookups.mobile={TASK090:t90,CHECK34:c34};
    mark('UI2-02','PASS',{mobile:evidence.lookups.mobile});

    await page.locator('#clearItemFilter').click();
    await page.locator('#itemKindFilter').selectOption({label:'検証'});await page.waitForTimeout(100);
    assert.match((await page.locator('.item-result-head strong').textContent()),/\/ 34$/);assert.ok(await visibleItemRows(page)<=20);
    assert.equal(await page.locator('[data-item-row]').evaluateAll(rows=>rows.every(r=>(r.textContent||'').includes('検証'))),true);
    const navBefore=evidence.navigation.length;await page.locator('#itemNext').click();await page.waitForTimeout(100);assert.equal(evidence.navigation.length,navBefore,'pager navigated document');assert.ok(await visibleItemRows(page)<=20);assert.match((await page.locator('.item-result-head .muted').textContent()),/ページ 2/);
    await page.locator('#clearItemFilter').click();await page.locator('#itemStatusFilter').selectOption({label:'未着手'});await page.waitForTimeout(100);
    assert.match((await page.locator('.item-result-head strong').textContent()),/\/ 112$/);assert.ok(await visibleItemRows(page)<=20);
    evidence.filters={kindCheckCount:34,statusTodoCount:112};mark('UI2-03','PASS',evidence.filters);

    // Sticky controls must remain reachable with no return traversal.
    await page.locator('#clearItemFilter').click();
    const panel=page.locator('.item-panel');await panel.scrollIntoViewIfNeeded();await page.evaluate(()=>scrollBy(0,1200));await page.waitForTimeout(100);
    const save=page.getByRole('button',{name:'GitHubへ保存',exact:true});const tabs=page.getByRole('button',{name:'項目',exact:true});
    assert.equal(await save.isVisible(),true);assert.equal(await tabs.isVisible(),true);await centerUncovered(page,save,'mobile sticky save');await centerUncovered(page,tabs,'mobile sticky item tab');
    const yBefore=await page.evaluate(()=>scrollY);await save.scrollIntoViewIfNeeded();const yAfter=await page.evaluate(()=>scrollY);const returnTravel=Math.abs(yAfter-yBefore);assert.ok(returnTravel<=844*plan.budgets.primaryActionReturnTravelMaxViewportHeights,`mobile primary return ${returnTravel}`);
    mark('UI2-04','PASS',{mobilePrimaryReturnTravel:returnTravel});

    // Desktop bounded view and direct lookup budgets.
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.locator('#itemSearch').waitFor();
    const desktopRows=await visibleItemRows(page),desktopMetrics=await pageMetrics(page);assert.ok(desktopRows<=20);assert.ok(desktopMetrics.scrollHeight<=desktopMetrics.clientHeight*plan.budgets.desktopDefaultItemPageMaxViewportHeights,`desktop height ${desktopMetrics.scrollHeight}`);await noOverflow(page,'desktop item page');
    evidence.viewports.desktop={...desktopMetrics,visibleRows:desktopRows,heightRatio:desktopMetrics.scrollHeight/desktopMetrics.clientHeight};
    const dt90=await lookupObjective(page,'TASK-090',plan.budgets.desktopPerLookupCumulativeVerticalTravelPx);await page.locator('#clearItemFilter').click();const dc34=await lookupObjective(page,'CHECK-34',plan.budgets.desktopPerLookupCumulativeVerticalTravelPx);await page.locator('#clearItemFilter').click();evidence.lookups.desktop={TASK090:dt90,CHECK34:dc34};
    await page.screenshot({path:'c04-v2-desktop.png',fullPage:true});

    // Navigation efficiency: no page navigation has occurred during tabs/search/filter/pager.
    assert.equal(evidence.navigation.length,0,`unexpected document navigations ${evidence.navigation.length}`);mark('UI2-06','PASS',{unintendedNavigations:0});
    await page.setViewportSize({width:390,height:844});await noOverflow(page,'mobile final');await touchAtLeast44(page.locator('#itemSearch'),'mobile search final');await page.screenshot({path:'c04-v2-mobile.png',fullPage:true});mark('UI2-07','PASS');

    // Save/reload/delete convergence. Browser reload itself is explicit and not counted as unintended.
    navTracking=false;await page.reload({waitUntil:'networkidle',timeout:60000});await connect(page);navTracking=true;
    await waitProjectCounts(page,2,2);
    const workloadCard=page.locator('.project-list button').filter({hasText:/C-04 UI負荷・使用性テスト v2 196項目/}).first();await workloadCard.click();
    expectedMutation404=true;await page.getByRole('button',{name:'削除',exact:true}).click();await page.getByText(/GitHub上の案件ファイルを削除しました/).waitFor({timeout:30000});await page.getByRole('button',{name:'GitHubから再読込',exact:true}).click();const afterOne=await waitProjectCounts(page,1,1);expectedMutation404=false;assert.match(afterOne.visible[0],/C-04 UI\/使用性テスト計画 v2/);
    const planCard=page.locator('.project-list button').filter({hasText:/C-04 UI\/使用性テスト計画 v2/}).first();await planCard.click();
    expectedMutation404=true;await page.getByRole('button',{name:'削除',exact:true}).click();await page.getByText(/GitHub上の案件ファイルを削除しました/).waitFor({timeout:30000});await page.getByRole('button',{name:'GitHubから再読込',exact:true}).click();const afterZero=await waitProjectCounts(page,0,0);expectedMutation404=false;await page.waitForTimeout(5000);assert.equal((await listProjects()).length,0);assert.equal((await visibleProjectTexts(page)).length,0);
    evidence.cleanup={afterFirstDelete:afterOne,afterFinalDelete:afterZero,stableAfter5s:true};mark('UI2-05','PASS',evidence.cleanup);

    assert.equal(evidence.runtime.pageErrors.length,0,JSON.stringify(evidence.runtime.pageErrors));assert.equal(evidence.runtime.apiErrors.length,0,JSON.stringify(evidence.runtime.apiErrors));assert.equal(evidence.runtime.consoleErrors.length,0,JSON.stringify(evidence.runtime.consoleErrors));mark('UI2-08','PASS',{runtime:evidence.runtime});
    for(const id of plan.scenarios.map(x=>x.id))assert.equal(evidence.scenarios[id]?.status,'PASS',`${id} not PASS`);
    evidence.status='PASS';writeEvidence();
    console.log('C04_V2_PASS',JSON.stringify({mobile:evidence.viewports.mobile,desktop:evidence.viewports.desktop,lookups:evidence.lookups,cleanup:evidence.cleanup}));
  }catch(e){evidence.status='FAIL';evidence.error={name:e.name,message:e.message,stack:e.stack};writeEvidence();throw e;}finally{
    await browser.close().catch(()=>{});
    await api(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(tempBranch)}`,{method:'DELETE'},true).catch(()=>{});
  }
})();
