const nativeFetch=globalThis.fetch.bind(globalThis);
let project=null;
let current=null;
let opener=null;
let relationStack=[];
let allowOriginalEdit=false;
let editingReturn=null;
let pendingEditedRecord=null;
let editDialogSeen=false;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rowName=r=>r?.title||r?.name||r?.text||r?.id||'名称未設定';
const supported=new Set(['tasks','specifications','checks']);

function decodeBase64Utf8(value){
  const clean=String(value||'').replace(/\s/g,'');
  const binary=atob(clean),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

function captureProject(value){
  if(value&&typeof value==='object'&&value.workspace&&Array.isArray(value.tasks)&&Array.isArray(value.specifications)&&Array.isArray(value.checks)){
    project=value;
    document.dispatchEvent(new CustomEvent('tsugu:project-captured'));
  }
}

function inspectGitHubPayload(payload){
  if(!payload||typeof payload!=='object'||typeof payload.content!=='string')return;
  try{captureProject(JSON.parse(decodeBase64Utf8(payload.content)));}catch{}
}

globalThis.fetch=async(input,init={})=>{
  const response=await nativeFetch(input,init);
  try{
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    if(method==='GET'&&response.ok){
      const payload=await response.clone().json();
      inspectGitHubPayload(payload);
    }else if(method==='PUT'&&init?.body){
      const request=JSON.parse(init.body);
      if(request?.content)captureProject(JSON.parse(decodeBase64Utf8(request.content)));
    }
  }catch{}
  return response;
};

function inlineMarkdown(value){
  let text=esc(value);
  text=text.replace(/`([^`]+)`/g,'<code>$1</code>');
  text=text.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return text;
}

function markdown(value){
  const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
  let html='',inCode=false,inList=false,code=[];
  const endList=()=>{if(inList){html+='</ul>';inList=false;}};
  const endCode=()=>{if(inCode){html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;inCode=false;code=[];}};
  for(const line of lines){
    if(/^```/.test(line)){if(inCode)endCode();else{endList();inCode=true;}continue;}
    if(inCode){code.push(line);continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)$/);
    if(heading){endList();const level=Math.min(4,heading[1].length+1);html+=`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;continue;}
    const item=line.match(/^\s*[-*]\s+(.+)$/);
    if(item){if(!inList){html+='<ul>';inList=true;}html+=`<li>${inlineMarkdown(item[1])}</li>`;continue;}
    endList();
    if(!line.trim()){html+='<div class="tsugu-prose-gap"></div>';continue;}
    html+=`<p>${inlineMarkdown(line)}</p>`;
  }
  endList();endCode();
  return html||'<p class="tsugu-muted">未記入</p>';
}

function record(collection,id){return project?.[collection]?.find(r=>r.id===id)||null;}
function taskById(id){return record('tasks',id);}
function specById(id){return record('specifications',id);}
function taskChecks(id){return project?.checks?.filter(c=>c.target_type==='Task'&&c.target_id===id)||[];}

function relationButton(collection,row,meta=''){
  if(!row)return '';
  return `<button type="button" class="tsugu-relation" data-tsugu-open="${collection}" data-id="${esc(row.id)}"><span><b>${esc(rowName(row))}</b><small>${esc(row.id)}</small></span>${meta?`<span class="tsugu-relation-meta">${esc(meta)}</span>`:''}</button>`;
}

function relationSection(title,body,empty='関連情報はありません。'){
  return `<section class="tsugu-detail-section"><h3>${esc(title)}</h3>${body||`<p class="tsugu-muted">${esc(empty)}</p>`}</section>`;
}

function taskDetail(task){
  const dependencies=(task.depends_on||[]).map(id=>taskById(id));
  const specs=(task.specification_ids||[]).map(id=>specById(id));
  const checks=taskChecks(task.id);
  const blockers=dependencies.filter(t=>t&&t.status!=='Done');
  return `<div class="tsugu-detail-summary"><span class="tsugu-pill">${esc(task.status||'')}</span><span>${esc(task.work_type||'')}</span><span>実行順序 ${esc(task.execution_order)}</span></div>
    ${blockers.length?`<div class="tsugu-callout warning"><b>開始を妨げている先行Task</b><div>${blockers.map(t=>relationButton('tasks',t,t.status)).join('')}</div></div>`:''}
    ${task.body||task.purpose?relationSection('目的・作業内容',`<div class="tsugu-prose">${markdown(task.purpose||task.body)}</div>`):''}
    ${relationSection('受入条件',`<div class="tsugu-prose tsugu-acceptance">${markdown(task.acceptance_criteria)}</div>`,'受入条件は未記入です。')}
    ${relationSection(`依存Task (${dependencies.filter(Boolean).length})`,dependencies.filter(Boolean).map(t=>relationButton('tasks',t,t.status)).join(''),'依存Taskはありません。')}
    ${relationSection(`関連仕様 (${specs.filter(Boolean).length})`,specs.filter(Boolean).map(sp=>relationButton('specifications',sp,sp.status||sp.revision||'')).join(''),'関連仕様はありません。')}
    ${relationSection(`確認事項 (${checks.length})`,checks.map(c=>relationButton('checks',c,`${c.gate||'General'} · ${c.status||''}`)).join(''),'このTaskを対象にした確認事項はありません。')}`;
}

function specDetail(spec){
  const tasks=project.tasks.filter(t=>(t.specification_ids||[]).includes(spec.id));
  return `<div class="tsugu-detail-summary"><span class="tsugu-pill">${esc(spec.status||'')}</span>${spec.revision!==undefined?`<span>版 ${esc(spec.revision)}</span>`:''}</div>
    ${relationSection('仕様本文',`<div class="tsugu-prose tsugu-spec-body">${markdown(spec.body||spec.text||spec.description)}</div>`,'仕様本文は未記入です。')}
    ${spec.acceptance_criteria?relationSection('受入条件',`<div class="tsugu-prose tsugu-acceptance">${markdown(spec.acceptance_criteria)}</div>`):''}
    ${relationSection(`関連Task (${tasks.length})`,tasks.map(t=>relationButton('tasks',t,t.status)).join(''),'この仕様を参照するTaskはありません。')}`;
}

function checkDetail(check){
  const target=check.target_type==='Task'?taskById(check.target_id):null;
  return `<div class="tsugu-detail-summary"><span class="tsugu-pill">${esc(check.status||'')}</span><span>${esc(check.gate||'General')}</span>${check.required?'<span>必須</span>':''}</div>
    ${target?relationSection('対象Task',relationButton('tasks',target,target.status)):relationSection('対象',`<p>${esc(check.target_type||'')} · ${esc(check.target_id||'')}</p>`)}
    ${target?relationSection('対象Taskの受入条件',`<div class="tsugu-prose tsugu-acceptance">${markdown(target.acceptance_criteria)}</div>`):''}
    ${relationSection('確認結果',`<div class="tsugu-prose">${markdown(check.result)}</div>`,'結果は未記入です。')}
    ${relationSection('証跡',`<div class="tsugu-prose">${markdown(check.evidence)}</div>`,'証跡は未記入です。')}`;
}

function detailBody(collection,row){
  if(collection==='tasks')return taskDetail(row);
  if(collection==='specifications')return specDetail(row);
  return checkDetail(row);
}

function removeOverlay(){document.querySelector('#tsugu-detail-overlay')?.remove();}
function renderDetail(){
  removeOverlay();
  if(!current||!project)return;
  const row=record(current.collection,current.id);
  if(!row)return;
  const overlay=document.createElement('div');overlay.id='tsugu-detail-overlay';overlay.className='tsugu-detail-backdrop';
  overlay.innerHTML=`<section class="tsugu-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="tsugu-detail-title"><div class="tsugu-detail-head"><div>${relationStack.length?'<button type="button" class="tsugu-icon-button" data-tsugu-back aria-label="前の詳細へ戻る">←</button>':''}</div><div class="tsugu-detail-title-wrap"><h2 id="tsugu-detail-title" tabindex="-1">${esc(rowName(row))}</h2><div class="tsugu-record-id">${esc(row.id)}</div></div><button type="button" class="tsugu-icon-button" data-tsugu-close aria-label="詳細を閉じる">×</button></div><div class="tsugu-detail-content">${detailBody(current.collection,row)}</div><div class="tsugu-detail-actions"><button type="button" data-tsugu-edit class="primary">編集する</button><button type="button" data-tsugu-close>閉じる</button></div></section>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tsugu-detail-title')?.focus();
}

function openDetail(collection,id,{push=true,trigger=null}={}){
  if(!project||!supported.has(collection)||!record(collection,id))return false;
  if(trigger&&!opener)opener=trigger;
  if(current&&push)relationStack.push(current);
  current={collection,id};renderDetail();return true;
}
function closeDetail(){removeOverlay();current=null;relationStack=[];const target=opener;opener=null;target?.focus?.();}
function backDetail(){const previous=relationStack.pop();if(previous){current=previous;renderDetail();}else closeDetail();}

function originalEditButton(){return document.querySelector(`[data-action="edit"][data-collection="${CSS.escape(current.collection)}"][data-id="${CSS.escape(current.id)}"]`);}
function editCurrent(){
  const button=originalEditButton();if(!button)return;
  editingReturn={...current};pendingEditedRecord=null;editDialogSeen=false;removeOverlay();current=null;
  allowOriginalEdit=true;button.click();allowOriginalEdit=false;
}

function formCandidate(form,base){
  const fd=new FormData(form),copy=structuredClone(base);
  for(const [key,value] of Object.entries(base)){
    if(!form.elements.namedItem(key))continue;
    const raw=String(fd.get(key)||'');
    if(typeof value==='boolean')copy[key]=fd.has(key);
    else if(typeof value==='number')copy[key]=Number(raw);
    else if(Array.isArray(value))copy[key]=raw.split(',').map(x=>x.trim()).filter(Boolean);
    else if(value&&typeof value==='object'){try{copy[key]=JSON.parse(raw);}catch{}}
    else copy[key]=raw;
  }
  return copy;
}

const findState={query:'',box:'',status:'',mode:'all'};
function taskReady(task){
  const deps=(task.depends_on||[]).map(taskById).filter(Boolean);
  const depsDone=deps.every(t=>t.status==='Done');
  const approved=!task.requires_human_approval||task.approval?.status==='Approved';
  return task.status==='Todo'&&depsDone&&approved;
}
function taskBlocked(task){return task.status==='Blocked'||(task.status==='Todo'&&!taskReady(task));}
function searchableText(row){return [rowName(row),row.id,row.body,row.summary,row.purpose,row.acceptance_criteria,row.result,row.evidence].filter(Boolean).join(' ').toLowerCase();}
function resultRows(){
  if(!project)return [];
  const q=findState.query.trim().toLowerCase();
  const rows=[];
  for(const [collection,label] of [['architecture_nodes','作業分類'],['work_boxes','WorkBox'],['tasks','Task'],['specifications','正式仕様'],['checks','確認事項']]){
    for(const row of project[collection]||[]){
      if(q&&!searchableText(row).includes(q))continue;
      if(collection==='tasks'){
        if(findState.box&&row.box_id!==findState.box)continue;
        if(findState.status&&row.status!==findState.status)continue;
        if(findState.mode==='ready'&&!taskReady(row))continue;
        if(findState.mode==='blocked'&&!taskBlocked(row))continue;
      }else if(findState.box||findState.status||findState.mode!=='all')continue;
      rows.push({collection,label,row});
    }
  }
  return rows.slice(0,30);
}
function workspaceResultsHtml(){
  const rows=resultRows();
  if(!findState.query&&!findState.box&&!findState.status&&findState.mode==='all')return '<div class="tsugu-find-hint">検索またはフィルタを指定すると候補を表示します。</div>';
  return rows.length?rows.map(({collection,label,row})=>`<button type="button" class="tsugu-find-result" data-tsugu-find="${collection}" data-id="${esc(row.id)}"><span><b>${esc(rowName(row))}</b><small>${esc(label)} · ${esc(row.id)}</small></span>${collection==='tasks'?`<span class="tsugu-relation-meta">${esc(row.status||'')}</span>`:''}</button>`).join(''):'<div class="tsugu-find-hint">一致する項目はありません。</div>';
}
function renderWorkspaceResults(){const box=document.querySelector('#tsugu-find-results');if(box)box.innerHTML=workspaceResultsHtml();}
function workspaceTools(){
  const workboxes=(project?.work_boxes||[]).map(b=>`<option value="${esc(b.id)}">${esc(rowName(b))}</option>`).join('');
  const statuses=[...new Set((project?.tasks||[]).map(t=>t.status).filter(Boolean))].map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const node=document.createElement('section');node.id='tsugu-workspace-tools';node.className='tsugu-workspace-tools';node.setAttribute('aria-label','案件内検索と絞り込み');
  node.innerHTML=`<div class="tsugu-find-row"><label class="tsugu-search-label"><span>案件内検索</span><input id="tsugu-quick-search" type="search" placeholder="Task・WorkBox・仕様・確認事項を名前またはIDで検索" autocomplete="off"></label><div class="tsugu-find-controls"><label>WorkBox<select id="tsugu-filter-box"><option value="">すべて</option>${workboxes}</select></label><label>状態<select id="tsugu-filter-status"><option value="">すべて</option>${statuses}</select></label><label>開始可否<select id="tsugu-filter-mode"><option value="all">すべて</option><option value="ready">開始可能</option><option value="blocked">ブロック</option></select></label><div class="tsugu-structure-actions"><button type="button" data-tsugu-collapse>構成を折りたたむ</button><button type="button" data-tsugu-expand>構成を展開</button></div></div></div><div id="tsugu-find-results" class="tsugu-find-results" aria-live="polite">${workspaceResultsHtml()}</div>`;
  return node;
}
function ensureWorkspaceTools(){
  if(!project||document.querySelector('#tsugu-workspace-tools'))return;
  const tabs=document.querySelector('#app .tabs');if(!tabs)return;
  tabs.insertAdjacentElement('afterend',workspaceTools());
}
function setStructure(open){for(const d of document.querySelectorAll('.tree details'))d.open=open;}
function switchToStructureThenFocus(collection,id){
  const tab=[...document.querySelectorAll('#app .tabs button')].find(b=>b.textContent.trim()==='構成');tab?.click();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const target=document.querySelector(`[data-action="edit"][data-collection="${CSS.escape(collection)}"][data-id="${CSS.escape(id)}"]`);
    if(!target)return;
    for(const d of document.querySelectorAll('.tree details'))if(d.contains(target))d.open=true;
    target.scrollIntoView({block:'center'});target.focus();
  }));
}

document.addEventListener('click',event=>{
  const result=event.target.closest?.('[data-tsugu-find]');
  if(result){event.preventDefault();const c=result.dataset.tsuguFind,id=result.dataset.id;if(supported.has(c))openDetail(c,id,{trigger:result});else switchToStructureThenFocus(c,id);return;}
  if(event.target.closest?.('[data-tsugu-collapse]')){event.preventDefault();setStructure(false);return;}
  if(event.target.closest?.('[data-tsugu-expand]')){event.preventDefault();setStructure(true);return;}
  const relation=event.target.closest?.('[data-tsugu-open]');
  if(relation){event.preventDefault();openDetail(relation.dataset.tsuguOpen,relation.dataset.id);return;}
  if(event.target.closest?.('[data-tsugu-close]')){event.preventDefault();closeDetail();return;}
  if(event.target.closest?.('[data-tsugu-back]')){event.preventDefault();backDetail();return;}
  if(event.target.closest?.('[data-tsugu-edit]')){event.preventDefault();editCurrent();return;}
  const button=event.target.closest?.('[data-action="edit"][data-collection][data-id]');
  if(!button||allowOriginalEdit||!supported.has(button.dataset.collection))return;
  if(openDetail(button.dataset.collection,button.dataset.id,{trigger:button})){
    event.preventDefault();event.stopImmediatePropagation();
  }
},true);

document.addEventListener('input',event=>{
  if(event.target?.id==='tsugu-quick-search'){findState.query=event.target.value;renderWorkspaceResults();}
});
document.addEventListener('change',event=>{
  if(event.target?.id==='tsugu-filter-box')findState.box=event.target.value;
  else if(event.target?.id==='tsugu-filter-status')findState.status=event.target.value;
  else if(event.target?.id==='tsugu-filter-mode')findState.mode=event.target.value;
  else return;
  renderWorkspaceResults();
});

document.addEventListener('submit',event=>{
  if(!editingReturn||event.target?.id!=='record-editor'||!project)return;
  const base=record(editingReturn.collection,editingReturn.id);
  if(base)pendingEditedRecord=formCandidate(event.target,base);
},true);

document.addEventListener('keydown',event=>{
  if(!document.querySelector('#tsugu-detail-overlay'))return;
  if(event.key==='Escape'){event.preventDefault();relationStack.length?backDetail():closeDetail();}
});

document.addEventListener('tsugu:project-captured',()=>queueMicrotask(ensureWorkspaceTools));
const observer=new MutationObserver(()=>{
  ensureWorkspaceTools();
  if(!editingReturn)return;
  const appDialog=document.querySelector('#app .dialog');
  if(appDialog){editDialogSeen=true;return;}
  if(!editDialogSeen)return;
  if(pendingEditedRecord&&project?.[editingReturn.collection]){
    const index=project[editingReturn.collection].findIndex(r=>r.id===editingReturn.id);
    if(index>=0)project[editingReturn.collection][index]=pendingEditedRecord;
  }
  current={...editingReturn};editingReturn=null;pendingEditedRecord=null;editDialogSeen=false;renderDetail();
});
observer.observe(document.documentElement,{childList:true,subtree:true});
