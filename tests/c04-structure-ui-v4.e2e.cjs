const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

const plan=JSON.parse(fs.readFileSync('static/c04-structure-ui-plan-v4.json','utf8'));
assert.equal(plan.planVersion,4);
assert.equal(plan.status,'FROZEN_BEFORE_IMPLEMENTATION');

const targetUrl=process.env.C04_TARGET_URL||'http://127.0.0.1:4173/';
const evidence={
  type:'TSUGUC04StructureUIV4Evidence',planVersion:4,targetUrl,
  sourceSha:process.env.GITHUB_SHA||'',status:'RUNNING',scenarios:{},runtime:{consoleErrors:[],pageErrors:[],apiErrors:[]},metrics:{}
};
const write=()=>fs.writeFileSync('c04-structure-ui-v4-evidence.json',JSON.stringify(evidence,null,2)+'\n');
const mark=(id,status,detail={})=>{evidence.scenarios[id]={status,...detail};write()};

function privateRepoRoutes(page){
  return page.route('https://api.github.com/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    let status=200,body={};
    if(path==='/user')body={login:'c04-v4-e2e',id:1,type:'User'};
    else if(path==='/repos/kj2whvbzjn-hue/tsugu')body={id:1363396531,name:'tsugu',full_name:'kj2whvbzjn-hue/tsugu',private:true,permissions:{admin:true,push:true,pull:true}};
    else if(path==='/repos/kj2whvbzjn-hue/tsugu/branches/c04-v4-e2e-data')body={name:'c04-v4-e2e-data',commit:{sha:'1111111111111111111111111111111111111111'}};
    else if(path==='/repos/kj2whvbzjn-hue/tsugu/contents/data/projects')body=[];
    else if(path.startsWith('/repos/kj2whvbzjn-hue/tsugu/contents/data/projects/')){status=404;body={message:'Not Found'};}
    else {status=404;body={message:`Unhandled mock ${req.method()} ${path}`};}
    if(status>=400)evidence.runtime.apiErrors.push({status,path,expected:status===404&&path.includes('/contents/data/projects/')});
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
}
async function clickTab(page,name){const b=page.getByRole('button',{name,exact:true}).first();await b.scrollIntoViewIfNeeded();await b.click();}
async function submit(form){await form.locator('button[type="submit"]').click();}
async function rawProject(page){await clickTab(page,'高度なJSON');return JSON.parse(await page.locator('#rawProject').inputValue());}
async function selectOptionByLabel(select,label){await select.selectOption({label});}
function scenarioIds(){return plan.acceptance.map(x=>x.id)}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('console',m=>{if(m.type()==='error')evidence.runtime.consoleErrors.push({text:m.text(),url:m.location()?.url||''})});
  page.on('pageerror',e=>evidence.runtime.pageErrors.push({text:e.message}));
  await privateRepoRoutes(page);
  page.on('dialog',async d=>{if(d.type()==='prompt')await d.accept('C-04 v4 構造UI実機候補');else await d.accept()});
  try{
    await page.goto(`${targetUrl}?c04v4=${Date.now()}`,{waitUntil:'networkidle',timeout:60000});
    await page.locator('#owner').fill('kj2whvbzjn-hue');
    await page.locator('#repo').fill('tsugu');
    await page.locator('#branch').fill('c04-v4-e2e-data');
    await page.locator('#token').fill('github_pat_c04_v4_placeholder');
    await page.getByRole('button',{name:'接続',exact:true}).click();
    await page.getByText(/GitHubから0件を読み込みました/).waitFor({timeout:10000});
    await page.getByRole('button',{name:/新規案件/}).click();
    await page.getByRole('heading',{name:'構造マップ',exact:true}).waitFor();

    // UI4-01 / UI4-02: hierarchy + branching.
    let form=page.locator('#coreNodeForm');
    await form.locator('[name="name"]').fill('Root Architecture');await submit(form);
    await form.locator('[name="name"]').fill('Branch A');await selectOptionByLabel(form.locator('[name="parentNodeId"]'),'Root Architecture');await submit(form);
    await form.locator('[name="name"]').fill('Branch B');await selectOptionByLabel(form.locator('[name="parentNodeId"]'),'Root Architecture');await submit(form);
    assert.equal(await page.locator('.architecture-tree .architecture-node-card').count(),3,'three architecture nodes should render');
    assert.ok(await page.locator('.architecture-tree ul .architecture-node-card').count()>=2,'two child branches should render under root');
    const branchA=page.getByRole('button',{name:'Branch A',exact:true}).first();await branchA.click();
    let inspector=page.locator('.core-inspector');
    assert.match(await inspector.innerText(),/CHILD_NODE/);
    assert.match(await inspector.innerText(),/Root Architecture/);
    await inspector.getByRole('button',{name:/Root Architecture/,exact:false}).click();
    inspector=page.locator('.core-inspector');
    const rootText=await inspector.innerText();assert.match(rootText,/Branch A/);assert.match(rootText,/Branch B/);
    mark('UI4-01','PASS',{architectureNodes:3,branches:2});

    // UI4-03: WorkBox dedicated registration and hierarchy.
    await clickTab(page,'Box');form=page.locator('#coreBoxForm');
    await form.locator('[name="name"]').fill('Box Alpha');await selectOptionByLabel(form.locator('[name="architectureNodeId"]'),'Branch A');await submit(form);
    await form.locator('[name="name"]').fill('Box Alpha Child');await selectOptionByLabel(form.locator('[name="architectureNodeId"]'),'Branch A');await selectOptionByLabel(form.locator('[name="parentWorkBoxId"]'),'Box Alpha');await submit(form);
    await form.locator('[name="name"]').fill('Box Beta');await selectOptionByLabel(form.locator('[name="architectureNodeId"]'),'Branch B');await submit(form);
    assert.equal(await page.locator('[data-core-open^="WORKBOX::"]').count()>=3,true);
    await clickTab(page,'構造');
    assert.equal(await page.locator('[data-workbox-id]').count(),3);
    assert.ok(await page.locator('.workbox-children [data-workbox-id]').count()>=1,'child workbox should be nested');
    await page.getByRole('button',{name:'Box Alpha Child',exact:true}).first().click();
    inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/CHILD_WORKBOX/);assert.match(await inspector.innerText(),/Box Alpha/);
    await inspector.getByRole('button',{name:/Box Alpha/,exact:false}).click();
    assert.match(await page.locator('.core-inspector').innerText(),/Box Alpha Child/);
    mark('UI4-02','PASS',{architectureBidirectional:true,workBoxBidirectional:true});
    mark('UI4-03','PASS',{workBoxes:3,nested:1});

    // Requirement/specification is a typed entity attached to a WorkBox.
    await clickTab(page,'要求・仕様');form=page.locator('#coreRequirementForm');
    await form.locator('[name="name"]').fill('Requirement A');await selectOptionByLabel(form.locator('[name="workBoxId"]'),'Box Alpha');await form.locator('[name="body"]').fill('Box Alphaが満たすべき要求');await submit(form);

    // UI4-04: Task registration and reverse navigation.
    await clickTab(page,'Task');form=page.locator('#coreTaskForm');
    await form.locator('[name="name"]').fill('Task Producer');await selectOptionByLabel(form.locator('[name="subject"]'),'WorkBox: Box Alpha');await form.locator('[name="purpose"]').fill('Eventを生成する');await submit(form);
    await form.locator('[name="name"]').fill('Task Consumer');await selectOptionByLabel(form.locator('[name="subject"]'),'WorkBox: Box Alpha Child');await form.locator('[name="purpose"]').fill('Eventを待って処理する');await submit(form);
    await page.getByRole('button',{name:'Task Consumer',exact:true}).first().click();
    inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/SUBJECT_OF_TASK/);assert.match(await inspector.innerText(),/Box Alpha Child/);
    await inspector.getByRole('button',{name:/WorkBox: Box Alpha Child/,exact:false}).click();
    assert.match(await page.locator('.core-inspector').innerText(),/Task Consumer/);
    mark('UI4-04','PASS',{tasks:2,subjectReverse:true});

    // UI4-05: Test dedicated configuration and reverse navigation.
    await clickTab(page,'テスト');form=page.locator('#coreTestForm');
    await form.locator('[name="name"]').fill('Test Alpha');await selectOptionByLabel(form.locator('[name="target"]'),'WorkBox: Box Alpha');await form.locator('[name="runner"]').fill('PLAYWRIGHT');await form.locator('[name="command"]').fill('npm test -- alpha');await form.locator('[name="evaluationConditions"]').fill('{"required":"PASS"}');await submit(form);
    await page.getByRole('button',{name:'Test Alpha',exact:true}).first().click();
    inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/TESTED_BY/);assert.match(await inspector.innerText(),/Box Alpha/);
    await inspector.getByRole('button',{name:/WorkBox: Box Alpha/,exact:false}).click();
    assert.match(await page.locator('.core-inspector').innerText(),/Test Alpha/);
    mark('UI4-05','PASS',{runner:'PLAYWRIGHT',command:true,evaluationConditions:true,reverse:true});

    // UI4-06: Task -> Event -> Task and reverse, cycle rejection.
    await clickTab(page,'依存');let eventForm=page.locator('#coreEventForm'),depForm=page.locator('#coreDependencyForm');
    await eventForm.locator('[name="name"]').fill('Event Produced');await selectOptionByLabel(eventForm.locator('[name="producerTaskId"]'),'Task Producer');await submit(eventForm);
    await selectOptionByLabel(depForm.locator('[name="taskId"]'),'Task Consumer');await selectOptionByLabel(depForm.locator('[name="eventDefinitionId"]'),'Event Produced');await submit(depForm);
    let chain=page.locator('.dependency-path').filter({hasText:'Event Produced'});assert.match(await chain.innerText(),/Task Producer/);assert.match(await chain.innerText(),/Task Consumer/);
    await chain.getByRole('button',{name:'Task Consumer',exact:true}).click();inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/REQUIRED_BY/);assert.match(await inspector.innerText(),/Event Produced/);
    await inspector.getByRole('button',{name:/Event: Event Produced/,exact:false}).click();inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/Task Producer/);assert.match(await inspector.innerText(),/Task Consumer/);
    await eventForm.locator('[name="name"]').fill('Event Consumer Done');await selectOptionByLabel(eventForm.locator('[name="producerTaskId"]'),'Task Consumer');await submit(eventForm);
    await selectOptionByLabel(depForm.locator('[name="taskId"]'),'Task Producer');await selectOptionByLabel(depForm.locator('[name="eventDefinitionId"]'),'Event Consumer Done');await submit(depForm);
    await page.getByText(/Task \/ Event dependency が循環しています/).waitFor();
    const depJson=await rawProject(page);assert.equal(depJson.core.taskDependencies.length,1,'cycle-causing dependency must not be committed');
    mark('UI4-06','PASS',{forward:true,reverse:true,cycleRejected:true,storedDependencies:1});

    // UI4-07: reverse index from one stored directional relation.
    await clickTab(page,'構造');await page.getByRole('button',{name:'Box Alpha',exact:true}).first().click();
    inspector=page.locator('.core-inspector');const boxText=await inspector.innerText();assert.match(boxText,/Requirement A/);assert.match(boxText,/Task Producer/);assert.match(boxText,/Test Alpha/);
    assert.match(boxText,/HAS_REQUIREMENT/);assert.match(boxText,/SUBJECT_OF_TASK/);assert.match(boxText,/TESTED_BY/);
    mark('UI4-07','PASS',{incomingOutgoing:true,typedRelations:['HAS_REQUIREMENT','SUBJECT_OF_TASK','TESTED_BY']});

    // UI4-08: legacy isolation.
    const project=await rawProject(page);
    assert.equal(project.items.length,0,'new typed operations must not add project.items');
    assert.equal(project.core.workBoxes.length,3);assert.equal(project.core.tasks.length,2);assert.equal(project.core.testDefinitions.length,1);assert.equal(project.core.taskDependencies.length,1);
    assert.ok(project.core.tasks.every(t=>!Object.prototype.hasOwnProperty.call(t,'dependsOn')),'new Task must not use legacy dependsOn');
    mark('UI4-08','PASS',{legacyItemCount:project.items.length,legacyDependsOnWrites:0});

    // UI4-09: mobile layout, targets and unsaved draft preservation.
    await clickTab(page,'Task');form=page.locator('#coreTaskForm');await form.locator('[name="name"]').fill('未保存Draft保持');
    await clickTab(page,'構造');await page.getByRole('button',{name:'Box Beta',exact:true}).first().click();await clickTab(page,'Task');
    assert.equal(await page.locator('#coreTaskForm [name="name"]').inputValue(),'未保存Draft保持');
    const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(overflow.scrollWidth<=overflow.clientWidth+1,`mobile horizontal overflow ${JSON.stringify(overflow)}`);
    for(const name of ['構造','Box','Task','テスト','依存']){const b=page.getByRole('button',{name,exact:true}).first(),box=await b.boundingBox();assert.ok(box&&box.height>=44,`${name} target height ${box&&box.height}`)}
    mark('UI4-09','PASS',{viewport:'390x844',horizontalOverflow:false,draftPreserved:true});

    // UI4-10 runtime half; contract suites are executed by workflow after this script.
    const unexpectedApi=evidence.runtime.apiErrors.filter(x=>!x.expected);
    assert.deepEqual(evidence.runtime.pageErrors,[],'page errors');assert.deepEqual(evidence.runtime.consoleErrors,[],'console errors');assert.deepEqual(unexpectedApi,[],'unexpected API errors');
    mark('UI4-10','PASS_UI_RUNTIME',{consoleErrors:0,pageErrors:0,unexpectedApiErrors:0});

    assert.deepEqual(scenarioIds(),['UI4-01','UI4-02','UI4-03','UI4-04','UI4-05','UI4-06','UI4-07','UI4-08','UI4-09','UI4-10']);
    evidence.status='PASS_UI4_01_TO_10_UI_RUNTIME';
    evidence.metrics={architectureNodes:project.core.architectureNodes.length,workBoxes:project.core.workBoxes.length,requirements:project.core.requirements.length,tasks:project.core.tasks.length,tests:project.core.testDefinitions.length,events:project.core.eventDefinitions.length,dependencies:project.core.taskDependencies.length,legacyItems:project.items.length};
    write();
    await page.screenshot({path:'c04-structure-ui-v4-mobile.png',fullPage:true});
  }catch(error){evidence.status='FAIL';evidence.error=error.stack||String(error);write();throw error}finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
