const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

const plan=JSON.parse(fs.readFileSync('static/c04-box-registry-plan-v5.json','utf8'));
assert.equal(plan.planVersion,5);
assert.equal(plan.status,'FROZEN_BEFORE_V5_IMPLEMENTATION');
const targetUrl=process.env.C04_TARGET_URL||'http://127.0.0.1:4173/';
const evidence={type:'TSUGUC04BoxRegistryV5Evidence',planVersion:5,targetUrl,sourceSha:process.env.GITHUB_SHA||'',status:'RUNNING',scenarios:{},runtime:{consoleErrors:[],pageErrors:[],apiErrors:[]},metrics:{}};
const write=()=>fs.writeFileSync('c04-box-registry-v5-evidence.json',JSON.stringify(evidence,null,2)+'\n');
const mark=(id,status,detail={})=>{evidence.scenarios[id]={status,...detail};write()};

function routes(page){return page.route('https://api.github.com/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;let status=200,body={};if(path==='/user')body={login:'c04-v5-e2e',id:1,type:'User'};else if(path==='/repos/kj2whvbzjn-hue/tsugu')body={id:1363396531,name:'tsugu',full_name:'kj2whvbzjn-hue/tsugu',private:true,permissions:{admin:true,push:true,pull:true}};else if(path==='/repos/kj2whvbzjn-hue/tsugu/branches/c04-v5-e2e-data')body={name:'c04-v5-e2e-data',commit:{sha:'1111111111111111111111111111111111111111'}};else if(path==='/repos/kj2whvbzjn-hue/tsugu/contents/data/projects')body=[];else if(path.startsWith('/repos/kj2whvbzjn-hue/tsugu/contents/data/projects/')){status=404;body={message:'Not Found'}}else{status=404;body={message:`Unhandled mock ${req.method()} ${path}`}}if(status>=400)evidence.runtime.apiErrors.push({status,path,expected:status===404&&path.includes('/contents/data/projects/')});await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})})}
async function clickTab(page,name){const b=page.getByRole('button',{name,exact:true}).first();await b.scrollIntoViewIfNeeded();await b.click()}
async function submit(form){await form.locator('button[type="submit"]').click()}
async function rawProject(page){await clickTab(page,'高度なJSON');return JSON.parse(await page.locator('#rawProject').inputValue())}
async function choose(select,label){await select.selectOption({label})}
function card(page,title){return page.locator('.box-card-v5').filter({hasText:title}).first()}

(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('console',m=>{if(m.type()==='error')evidence.runtime.consoleErrors.push({text:m.text(),url:m.location()?.url||''})});
 page.on('pageerror',e=>evidence.runtime.pageErrors.push({text:e.message}));
 await routes(page);
 page.on('dialog',async d=>{if(d.type()==='prompt')await d.accept('C-04 v5 Box Registry');else await d.accept()});
 try{
  await page.goto(`${targetUrl}?c04v5=${Date.now()}`,{waitUntil:'networkidle',timeout:60000});
  await page.locator('#owner').fill('kj2whvbzjn-hue');await page.locator('#repo').fill('tsugu');await page.locator('#branch').fill('c04-v5-e2e-data');await page.locator('#token').fill('github_pat_c04_v5_placeholder');await page.getByRole('button',{name:'接続',exact:true}).click();
  await page.getByText(/GitHubから0件を読み込みました/).waitFor({timeout:10000});await page.getByRole('button',{name:/新規案件/}).click();await clickTab(page,'Box');await page.getByRole('heading',{name:'Box登録',exact:true}).waitFor();

  let form=page.locator('#v5BoxForm');
  async function addBox(title,type,custom=''){await form.locator('[name="title"]').fill(title);await form.locator('[name="boxType"]').selectOption(type);if(custom)await form.locator('[name="customBoxType"]').fill(custom);await submit(form);form=page.locator('#v5BoxForm')}
  await addBox('案件UI','ui');await addBox('Project Schema','schema');await addBox('Regression','test');await addBox('API Bridge','custom','api');
  assert.equal(await page.locator('.box-card-v5').count(),4);assert.equal(await card(page,'案件UI').getAttribute('data-box-type'),'ui');assert.equal(await card(page,'Project Schema').getAttribute('data-box-type'),'schema');assert.equal(await card(page,'Regression').getAttribute('data-box-type'),'test');assert.equal(await card(page,'API Bridge').getAttribute('data-box-type'),'api');
  let project=await rawProject(page);assert.ok(project.core.workBoxes.every(x=>x.boxId&&x.boxType));mark('UI5-01','PASS',{boxes:4,builtIn:['ui','schema','test'],custom:'api'});

  await clickTab(page,'Task');form=page.locator('#v5TaskForm');
  async function addTask(title,boxLabel){await form.locator('[name="title"]').fill(title);await choose(form.locator('[name="boxId"]'),boxLabel);await submit(form);form=page.locator('#v5TaskForm')}
  await addTask('UI Render','UI Box: 案件UI');await addTask('UI State','UI Box: 案件UI');await addTask('Schema Migration','Schema Box: Project Schema');await addTask('Test Support','Test Box: Regression');
  project=await rawProject(page);const uiBox=project.core.workBoxes.find(x=>x.title==='案件UI'),schemaBox=project.core.workBoxes.find(x=>x.title==='Project Schema'),testBox=project.core.workBoxes.find(x=>x.title==='Regression');assert.equal(project.core.tasks.filter(x=>x.boxId===uiBox.id).length,2);assert.ok(project.core.tasks.every(x=>x.boxId));
  await clickTab(page,'Box');assert.match(await card(page,'案件UI').innerText(),/Task 2/);mark('UI5-02','PASS',{uiBoxTasks:2,allTasksHaveBox:true});

  await clickTab(page,'テスト');form=page.locator('#v5TestForm');
  async function addTest(title,boxLabel,command){await form.locator('[name="title"]').fill(title);await choose(form.locator('[name="boxId"]'),boxLabel);await form.locator('[name="runner"]').fill('PLAYWRIGHT');await form.locator('[name="command"]').fill(command);await form.locator('[name="evaluationConditions"]').fill('{"required":"PASS"}');await submit(form);form=page.locator('#v5TestForm')}
  await addTest('Regression Mobile','Test Box: Regression','npm test -- mobile');await addTest('Regression Dependency','Test Box: Regression','npm test -- dependency');
  project=await rawProject(page);assert.equal(project.core.testDefinitions.filter(x=>x.boxId===testBox.id).length,2);await clickTab(page,'Box');const testCard=card(page,'Regression');assert.match(await testCard.innerText(),/Task 1/);assert.match(await testCard.innerText(),/Test 2/);mark('UI5-03','PASS',{testBoxTasks:1,testBoxTests:2});

  const uiRender=project.core.tasks.find(x=>x.title==='UI Render'),schemaMigration=project.core.tasks.find(x=>x.title==='Schema Migration'),regressionMobile=project.core.testDefinitions.find(x=>x.title==='Regression Mobile');
  assert.ok(uiRender&&schemaMigration&&regressionMobile);

  await clickTab(page,'依存');form=page.locator('#v5DependencyForm');
  async function addDep(dependentLabel,prereqLabel,kind='uses',risk='NORMAL',note=''){await choose(form.locator('[name="dependentRef"]'),dependentLabel);await choose(form.locator('[name="prerequisiteRef"]'),prereqLabel);await form.locator('[name="kind"]').selectOption(kind);await form.locator('[name="risk"]').selectOption(risk);await form.locator('[name="note"]').fill(note);await submit(form);form=page.locator('#v5DependencyForm')}
  await addDep('Box: 案件UI','Box: Project Schema','schema','NORMAL','UIはSchemaに依存');await addDep('Task: UI Render','Task: Schema Migration','data','CRITICAL','描画変更はschema migrationに依存');await addDep('Test: Regression Mobile','Task: UI Render','test','WATCH','UI変更で回帰テストに影響');
  await clickTab(page,'Box');const uiCard=card(page,'案件UI'),schemaCard=card(page,'Project Schema');const uiText=await uiCard.innerText(),schemaText=await schemaCard.innerText();assert.match(uiText,/依存 2/);assert.match(uiText,/影響 1/);assert.match(uiText,/要確認/);assert.match(schemaText,/依存 0/);assert.match(schemaText,/影響 2/);mark('UI5-04','PASS',{uiDepends:2,uiImpacts:1,schemaImpacts:2,dangerVisible:true});
  project=await rawProject(page);assert.equal(project.core.dependencies.length,3);assert.equal(Object.prototype.hasOwnProperty.call(project.core,'impacts'),false);mark('UI5-05','PASS',{storedDependencies:3,reverseStoredSeparately:false});

  await clickTab(page,'構造');assert.ok(await page.getByRole('heading',{name:'UI Box',exact:true}).count());assert.ok(await page.getByRole('heading',{name:'Schema Box',exact:true}).count());assert.ok(await page.getByRole('heading',{name:'Test Box',exact:true}).count());assert.match(await card(page,'案件UI').innerText(),/Task 2/);assert.match(await card(page,'Regression').innerText(),/Test 2/);mark('UI5-06','PASS',{typedGroups:true,summaryOnCards:true});

  await card(page,'Project Schema').getByRole('button',{name:'Project Schema',exact:true}).click();let inspector=page.locator('.core-inspector');let text=await inspector.innerText();assert.match(text,/変更時の影響先（impacts） 2/);await inspector.getByRole('button',{name:'Box: 案件UI',exact:true}).click();inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/依存先（depends on） 2/);await inspector.getByRole('button',{name:'戻る',exact:true}).click();assert.match(await page.locator('.core-inspector').innerText(),/Project Schema/);
  await clickTab(page,'Task');await page.getByRole('button',{name:'UI Render',exact:true}).first().click();inspector=page.locator('.core-inspector');text=await inspector.innerText();assert.match(text,/依存先（depends on） 1/);assert.match(text,/変更時の影響先（impacts） 1/);mark('UI5-07','PASS',{boxForward:true,boxReverse:true,taskDependsAndImpacts:true,back:true});

  await clickTab(page,'依存');form=page.locator('#v5DependencyForm');let before=(await rawProject(page)).core.dependencies.length;await clickTab(page,'依存');form=page.locator('#v5DependencyForm');await form.locator('[name="dependentRef"]').evaluate(sel=>{const o=new Option('Missing Box','WORKBOX::missing-box');sel.add(o);sel.value=o.value});await choose(form.locator('[name="prerequisiteRef"]'),'Box: Project Schema');await submit(form);await page.getByText(/存在するBox \/ Task \/ Testを選択してください/).waitFor();assert.equal((await rawProject(page)).core.dependencies.length,before);
  await clickTab(page,'依存');form=page.locator('#v5DependencyForm');await choose(form.locator('[name="dependentRef"]'),'Box: Project Schema');await choose(form.locator('[name="prerequisiteRef"]'),'Box: Project Schema');await submit(form);await page.getByText(/自己依存は登録できません/).waitFor();assert.equal((await rawProject(page)).core.dependencies.length,before);
  await clickTab(page,'依存');form=page.locator('#v5DependencyForm');await choose(form.locator('[name="dependentRef"]'),'Box: Project Schema');await choose(form.locator('[name="prerequisiteRef"]'),'Box: 案件UI');await submit(form);await page.getByText(/dependency が循環しています/).waitFor();assert.equal((await rawProject(page)).core.dependencies.length,before);
  await clickTab(page,'Box');await card(page,'Project Schema').getByRole('button',{name:'Project Schema',exact:true}).click();inspector=page.locator('.core-inspector');assert.match(await inspector.innerText(),/削除影響 2/);assert.equal(await inspector.locator('.delete-impact-v5').getAttribute('data-blocked'),'true');mark('UI5-08','PASS',{missingRejected:true,selfRejected:true,cycleRejected:true,deletionImpactPreview:true});

  const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(overflow.scrollWidth<=overflow.clientWidth+1,`mobile overflow ${JSON.stringify(overflow)}`);await clickTab(page,'構造');const mobileCard=card(page,'案件UI');const mobileText=await mobileCard.innerText();assert.match(mobileText,/UI BOX/i);assert.match(mobileText,/Task 2/);assert.match(mobileText,/依存 2/);assert.match(mobileText,/影響 1/);for(const name of ['構造','Box','Task','テスト','依存']){const b=page.getByRole('button',{name,exact:true}).first(),bb=await b.boundingBox();assert.ok(bb&&bb.height>=44,`${name} target ${bb&&bb.height}`)}mark('UI5-09','PASS',{viewport:'390x844',horizontalOverflow:false,summaryVisible:true,targets44:true});

  project=await rawProject(page);assert.equal(project.items.length,0);assert.ok(project.core.tasks.filter(x=>Number(x.uiModelVersion)>=5).every(x=>!Object.prototype.hasOwnProperty.call(x,'dependsOn')));assert.equal(project.core.dependencies.length,3);const unexpectedApi=evidence.runtime.apiErrors.filter(x=>!x.expected);assert.deepEqual(evidence.runtime.consoleErrors,[]);assert.deepEqual(evidence.runtime.pageErrors,[]);assert.deepEqual(unexpectedApi,[]);mark('UI5-10','PASS_UI_RUNTIME',{legacyItems:0,legacyDependsOnWrites:0,consoleErrors:0,pageErrors:0,unexpectedApiErrors:0});

  assert.deepEqual(plan.acceptance.map(x=>x.id),['UI5-01','UI5-02','UI5-03','UI5-04','UI5-05','UI5-06','UI5-07','UI5-08','UI5-09','UI5-10']);evidence.status='PASS_UI5_01_TO_10_UI_RUNTIME';evidence.metrics={boxes:project.core.workBoxes.length,tasks:project.core.tasks.length,tests:project.core.testDefinitions.length,dependencies:project.core.dependencies.length,legacyItems:project.items.length};write();await page.screenshot({path:'c04-box-registry-v5-mobile.png',fullPage:true});
 }catch(error){evidence.status='FAIL';evidence.error=error.stack||String(error);write();throw error}finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
