const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

const owner='kj2whvbzjn-hue';
const repo='tsugu';
const token=process.env.GH_TOKEN_E2E||process.env.GITHUB_TOKEN;
const targetUrl=process.env.C04_TARGET_URL||'https://kj2whvbzjn-hue.github.io/tsugu/';
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1';
const tempBranch=`longtext-e2e-${runId}-${runAttempt}`;
if(!token)throw new Error('GitHub token is required');

const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'tsugu-longtext-e2e'};
async function api(path,options={},allow404=false){
  const response=await fetch(`https://api.github.com${path}`,{...options,cache:'no-store',headers:{...headers,...(options.headers||{})}});
  const text=await response.text();
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw new Error(`GitHub ${response.status}: ${text}`);
  return text?JSON.parse(text):null;
}
function emptyCore(){return{architectureNodes:[],workBoxes:[],tasks:[],decisions:[],issues:[],checks:[],approvals:[],evidences:[],evidenceVersions:[],repositories:[],repositoryBaselines:[],pathEntries:[],plannedChanges:[],actualChanges:[],relations:[]}}
const bodyText='本文の長文視認性を確認するためのテキストです。\n'.repeat(18).trim();
const reasonText='理由・根拠を全画面で読解・編集できることを確認します。\n'.repeat(14).trim();
const project={schemaVersion:1,id:'77777777-8888-4999-8aaa-bbbbbbbbbbbb',name:'長文全画面編集E2E',purpose:'長文欄の全画面編集を検証する',rules:'既存C-04基準は変更しない',focus:'本文と理由・根拠',baseline:'user-feedback-2026-09-12',changeControlEnabled:true,next:'全画面編集後に元モーダルへ戻る',stage:'検討',implementationApproved:false,completionApproved:false,core:emptyCore(),items:[{id:'LT-001',kind:'構成',title:'長文全画面編集',body:bodyText,status:'未着手',parentId:'',reason:reasonText}]};
const evidence={type:'TSUGULongTextFullscreenEvidence',runId,runAttempt,targetUrl,tempBranch,status:'RUNNING',viewport:{width:390,height:844},fields:{},runtime:{pageErrors:[]}};
function writeEvidence(){fs.writeFileSync('longtext-fullscreen-evidence.json',JSON.stringify(evidence,null,2)+'\n')}
async function workspaceAction(page,name){const button=page.getByRole('button',{name,exact:true});if(await button.isVisible().catch(()=>false))return button;await page.getByRole('button',{name:'接続・取込メニュー',exact:true}).click();const item=page.getByRole('menuitem',{name,exact:true});await item.waitFor({state:'visible',timeout:5000});return item}

(async()=>{
  const mainRef=await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
  await api(`/repos/${owner}/${repo}/git/refs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:`refs/heads/${tempBranch}`,sha:mainRef.object.sha})});
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:evidence.viewport});
  page.on('pageerror',error=>evidence.runtime.pageErrors.push(error.message));
  await page.addInitScript(({token,owner,repo})=>{
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=typeof input==='string'?input:input.url;
      if(url==='https://api.github.com/user')return new Response(JSON.stringify({login:owner,id:1,type:'User'}),{status:200,headers:{'content-type':'application/json'}});
      const h=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined)||{});
      if(url.startsWith('https://api.github.com/'))h.set('Authorization',`Bearer ${token}`);
      const response=await nativeFetch(input,{...init,headers:h,cache:'no-store'});
      if(url===`https://api.github.com/repos/${owner}/${repo}`&&response.ok){
        const data=await response.clone().json();
        data.private=true;data.permissions={admin:true,maintain:true,push:true,pull:true};
        return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
      }
      return response;
    };
  },{token,owner,repo});

  try{
    await page.goto(`${targetUrl}?longtext=${runId}`,{waitUntil:'networkidle',timeout:60000});
    await page.locator('#owner').fill(owner);
    await page.locator('#repo').fill(repo);
    await page.locator('#branch').fill(tempBranch);
    await page.locator('#token').fill('github_pat_longtext_placeholder');
    await page.getByRole('button',{name:'接続',exact:true}).click();
    await page.getByText(/GitHubから\d+件を読み込みました/).waitFor({timeout:30000});

    const chooserPromise=page.waitForEvent('filechooser');
    await (await workspaceAction(page,'JSONから新規取込')).click();
    const chooser=await chooserPromise;
    await chooser.setFiles({name:'longtext-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project,null,2)+'\n')});
    await page.getByRole('button',{name:'項目',exact:true}).click();
    await page.locator('#itemSearch').fill('LT-001');
    await page.locator('[data-item-row="LT-001"] [data-edit]').click();
    const modal=page.locator('.modal');
    await modal.getByText('項目編集',{exact:true}).waitFor();
    const textareas=modal.locator('.field textarea:not(.code)');
    assert.ok(await textareas.count()>=2,'expected body and reason textareas');

    const body=textareas.nth(0);
    assert.equal(await body.inputValue(),bodyText);
    assert.equal(await body.getAttribute('aria-haspopup'),'dialog');
    await body.click();
    const overlay=page.locator('[data-longtext-editor]');
    await overlay.waitFor({state:'visible'});
    const overlayBox=await overlay.boundingBox();
    assert.ok(overlayBox&&overlayBox.width>=389&&overlayBox.height>=843,`overlay not fullscreen: ${JSON.stringify(overlayBox)}`);
    assert.match(await overlay.locator('.longtext-editor-title').textContent(),/本文/);
    const editor=overlay.locator('.longtext-editor-textarea');
    assert.equal(await editor.inputValue(),bodyText);
    const editedBody=`${bodyText}\n\n全画面編集で追記済み`;
    await editor.fill(editedBody);
    const editorBox=await editor.boundingBox();
    assert.ok(editorBox&&editorBox.height>=560,`editor too short: ${JSON.stringify(editorBox)}`);
    await page.screenshot({path:'longtext-fullscreen-mobile.png',fullPage:true});
    await overlay.getByRole('button',{name:'編集画面へ戻る',exact:true}).click();
    assert.equal(await body.inputValue(),editedBody);
    evidence.fields.body={label:'本文',overlay:overlayBox,editor:editorBox,roundTrip:'PASS'};

    const reason=textareas.nth(1);
    assert.equal(await reason.inputValue(),reasonText);
    await reason.click();
    await overlay.waitFor({state:'visible'});
    assert.match(await overlay.locator('.longtext-editor-title').textContent(),/理由・根拠/);
    const editedReason=`${reasonText}\n\n全画面編集で追記済み`;
    await overlay.locator('.longtext-editor-textarea').fill(editedReason);
    await overlay.getByRole('button',{name:'編集画面へ戻る',exact:true}).click();
    assert.equal(await reason.inputValue(),editedReason);
    evidence.fields.reason={label:'理由・根拠',roundTrip:'PASS'};

    await modal.getByRole('button',{name:'編集内容へ反映',exact:true}).click();
    await page.locator('[data-item-row="LT-001"] [data-edit]').click();
    await page.locator('.modal').getByText('項目編集',{exact:true}).waitFor();
    const reopened=page.locator('.modal .field textarea:not(.code)');
    assert.equal(await reopened.nth(0).inputValue(),editedBody);
    assert.equal(await reopened.nth(1).inputValue(),editedReason);
    await page.locator('.modal').getByRole('button',{name:'閉じる',exact:true}).click();

    assert.equal(evidence.runtime.pageErrors.length,0,JSON.stringify(evidence.runtime.pageErrors));
    evidence.status='PASS';
    evidence.persistence='PASS_AFTER_ITEM_APPLY_AND_REOPEN';
    writeEvidence();
    console.log('LONGTEXT_FULLSCREEN_PASS',JSON.stringify(evidence));
  }catch(error){
    evidence.status='FAIL';
    evidence.error={name:error.name,message:error.message,stack:error.stack};
    writeEvidence();
    throw error;
  }finally{
    await browser.close().catch(()=>{});
    await api(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(tempBranch)}`,{method:'DELETE'},true).catch(()=>{});
  }
})();
