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
 async function persistentOccupancy(){
  return page.evaluate(async()=>{
   const raf=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const doc=document.documentElement,maxY=Math.max(0,doc.scrollHeight-innerHeight),positions=[['top',0],['middle',Math.round(maxY/2)],['bottom',maxY]];
   const measure=()=>{
    const vw=innerWidth,vh=innerHeight,viewportArea=vw*vh;
    let candidates=[...document.querySelectorAll('body *')].filter(el=>{
      const cs=getComputedStyle(el),r=el.getBoundingClientRect();
      return (cs.position==='fixed'||cs.position==='sticky')&&cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)!==0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<vw&&r.top<vh;
    });
    candidates=candidates.filter(el=>!candidates.some(parent=>parent!==el&&parent.contains(el)));
    const rects=candidates.map(el=>{const r=el.getBoundingClientRect();return {left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(vw,r.right),bottom:Math.min(vh,r.bottom),position:getComputedStyle(el).position,label:`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${[...el.classList].slice(0,3).map(c=>'.'+c).join('')}`};}).filter(r=>r.right>r.left&&r.bottom>r.top);
    const xs=[0,vw,...rects.flatMap(r=>[r.left,r.right])].sort((a,b)=>a-b).filter((v,i,a)=>i===0||v!==a[i-1]);let unionArea=0;
    for(let i=0;i<xs.length-1;i++){const x1=xs[i],x2=xs[i+1];if(x2<=x1)continue;const intervals=rects.filter(r=>r.left<x2&&r.right>x1).map(r=>[r.top,r.bottom]).sort((a,b)=>a[0]-b[0]);let covered=0,start=null,end=null;for(const [a,b] of intervals){if(start===null){start=a;end=b;}else if(a<=end){end=Math.max(end,b);}else{covered+=end-start;start=a;end=b;}}if(start!==null)covered+=end-start;unionArea+=(x2-x1)*covered;}
    return {scrollY:Math.round(scrollY),viewport:{width:vw,height:vh,area:viewportArea},persistentAreaPx:Math.round(unionArea),occupancyPercent:Number((unionArea/viewportArea*100).toFixed(2)),elements:rects.map(r=>({...r,width:Math.round(r.right-r.left),height:Math.round(r.bottom-r.top)}))};
   };
   const samples=[];for(const [name,y] of positions){scrollTo(0,y);await raf();samples.push({name,...measure()});}
   const maxOccupancyPercent=Math.max(...samples.map(s=>s.occupancyPercent));
   return {definition:'Visible fixed/sticky UI union area divided by viewport area; overlapping descendants/regions are not double-counted.',samples,maxOccupancyPercent};
  });
 }
 const result={status:'RUNNING',target,scenarios:[],network:'GitHub API intercepted with stateful optimistic-concurrency fixture',browser:'Chromium',viewport:{width:390,height:844}};
 try{
  await page.goto(target);await connected();await click('＋ 新規案件');await page.locator('#new-project [name=name]').fill('工程移植 E2E');await click('作成');
  await tab('構成');await add('architecture_nodes',{name:'画面開発'});await add('work_boxes',{title:'受付画面',body:'利用者が依頼を登録する'});
  await tab('議論・仕様');const longSpecBody='# 受付保存仕様\n\n'+('保存した内容を再読込して一致を確認する。'.repeat(180));await add('specifications',{title:'受付保存仕様',body:longSpecBody,summary:'登録結果を永続化する正式仕様',acceptance_criteria:'保存後の再読込で入力内容と参照関係が一致する'});const specId=await page.locator('.card').filter({hasText:'受付保存仕様'}).locator('.tiny').first().innerText();
  await tab('構成');await add('tasks',{title:'登録の実装',acceptance_criteria:'受付の結果が保存・再読込後も一致する',requires_human_approval:true,specification_ids:specId});
  result.scenarios.push('Hierarchy creation with required acceptance criteria and linked long-form specification');
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
  const snapshot=JSON.parse(Buffer.from(stored.content,'base64').toString());assert.equal(snapshot.workflow.stage,'Completed');assert.equal(snapshot.tasks[0].status,'Done');assert.equal(snapshot.tasks[0].specification_ids[0],specId);assert.equal(snapshot.checks.find(c=>c.id===failureId).status,'Failed');assert.equal(snapshot.revision,1);
  result.scenarios.push('Immutable FAIL resolved by retest; final approval; Git save');
  await page.reload();await connected();await page.locator('[data-action=open]').first().click();await page.getByRole('heading',{name:'工程移植 E2E',exact:true}).waitFor();
  await tab('Task');const taskButton=page.getByRole('button',{name:'登録の実装',exact:true});await taskButton.click();await page.locator('#tsugu-detail-overlay').waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.id),'tsugu-detail-title');await page.getByText('受付の結果が保存・再読込後も一致する',{exact:true}).waitFor();
  await page.getByRole('button',{name:/受付保存仕様/}).click();await page.locator('#tsugu-detail-title').filter({hasText:'受付保存仕様'}).waitFor();assert.ok((await page.locator('.tsugu-spec-body').innerText()).length>3000);await page.getByRole('button',{name:'前の詳細へ戻る'}).click();await page.getByRole('heading',{name:'登録の実装',exact:true}).waitFor();
  await page.getByRole('button',{name:/初回確認/}).click();await page.getByRole('heading',{name:'初回確認',exact:true}).waitFor();await page.getByText('対象Taskの受入条件',{exact:true}).waitFor();await page.getByText('受付の結果が保存・再読込後も一致する',{exact:true}).waitFor();await page.getByRole('button',{name:'前の詳細へ戻る'}).click();await page.getByRole('heading',{name:'登録の実装',exact:true}).waitFor();
  await page.getByRole('button',{name:'詳細を閉じる'}).click();assert.equal(await taskButton.evaluate(el=>document.activeElement===el),true);result.scenarios.push('IMP-02〜04 read-first detail, direct Task→Spec/Check navigation, back stack, long-form readability and focus restoration');
  const tools=page.locator('#tsugu-workspace-tools');await tools.waitFor();const menu=page.getByRole('button',{name:'検索・絞り込みメニュー',exact:true});const openMenu=async()=>{if((await menu.getAttribute('aria-expanded'))!=='true')await menu.click();};const search=page.locator('#tsugu-quick-search');
  await openMenu();assert.equal(await menu.getAttribute('aria-expanded'),'true');await search.fill('登録の実装');const quickTask=page.locator('[data-tsugu-find="tasks"]').filter({hasText:'登録の実装'});await quickTask.waitFor();await quickTask.click();assert.equal(await menu.getAttribute('aria-expanded'),'false');await page.getByRole('heading',{name:'登録の実装',exact:true}).waitFor();await page.getByRole('button',{name:'詳細を閉じる'}).click();
  await openMenu();await page.locator('#tsugu-filter-status').selectOption('Done');await page.locator('[data-tsugu-find="tasks"]').filter({hasText:'登録の実装'}).waitFor();await page.locator('#tsugu-filter-status').selectOption('');await search.fill('受付画面');const quickBox=page.locator('[data-tsugu-find="work_boxes"]').filter({hasText:'受付画面'});await quickBox.click();assert.equal(await menu.getAttribute('aria-expanded'),'false');await page.getByRole('tab',{name:'構成',exact:true}).waitFor();const boxButton=page.getByRole('button',{name:'受付画面',exact:true});await boxButton.waitFor();await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='受付画面');assert.equal(await boxButton.evaluate(el=>document.activeElement===el),true);
  await openMenu();await page.getByRole('button',{name:'構成を折りたたむ',exact:true}).click();assert.equal(await menu.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.tree details[open]').count(),0);await openMenu();await page.getByRole('button',{name:'構成を展開',exact:true}).click();assert.equal(await menu.getAttribute('aria-expanded'),'false');assert.ok(await page.locator('.tree details[open]').count()>0);result.scenarios.push('IMP-05 compact three-dot menu exposes quick search, filters and structure actions only when needed and auto-closes after use');
  await tab('工程・確認');await page.locator('.stage.current').filter({hasText:'完了'}).waitFor();await page.getByText('Failed → 解決済み',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,JSON.stringify(metrics));
  const mobilePersistentOccupancy=await persistentOccupancy();result.scenarios.push('Visibility metric records persistent fixed/sticky UI viewport occupancy at top, middle and bottom without double-counting overlap');
  await page.screenshot({path:'outputs/workflow-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));const sticky=await page.locator('.tabs').evaluate(el=>Math.round(el.getBoundingClientRect().top));assert.ok(sticky>=-1&&sticky<=1,`sticky tabs top=${sticky}`);const desktopMetrics=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(desktopMetrics.scrollWidth<=desktopMetrics.clientWidth+1,JSON.stringify(desktopMetrics));const desktopPersistentOccupancy=await persistentOccupancy();await page.screenshot({path:'outputs/workflow-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);result.scenarios.push('Reload restores canonical project; no browser persistence; mobile and desktop no overflow; desktop primary navigation remains sticky');result.status='PASS';result.metrics=metrics;result.desktopMetrics=desktopMetrics;result.stickyTabsTop=sticky;result.visibility={persistentOccupancy:{mobile:mobilePersistentOccupancy,desktop:desktopPersistentOccupancy}};result.puts=puts;result.consoleErrors=errors;

 }catch(e){result.error=e.stack;result.status='FAIL';throw e;}finally{fs.writeFileSync('outputs/workflow-ui-evidence.json',JSON.stringify(result,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});