const TOOL_ID='tsugu-workspace-tools';
const TRIGGER_ID='tsugu-workspace-menu-trigger';

function isOpen(tools){return tools?.classList.contains('tsugu-workspace-tools-open');}
function setOpen(tools,open,{focus=false}={}){
  if(!tools)return;
  tools.classList.toggle('tsugu-workspace-tools-open',open);
  const trigger=tools.querySelector(`#${TRIGGER_ID}`);
  trigger?.setAttribute('aria-expanded',String(open));
  if(open&&focus)requestAnimationFrame(()=>tools.querySelector('#tsugu-quick-search')?.focus());
  if(!open&&focus)trigger?.focus();
}
function enhance(tools){
  if(!tools||tools.dataset.compactMenu==='true')return;
  tools.dataset.compactMenu='true';
  const trigger=document.createElement('button');
  trigger.type='button';
  trigger.id=TRIGGER_ID;
  trigger.className='tsugu-workspace-menu-trigger';
  trigger.setAttribute('aria-label','検索・絞り込みメニュー');
  trigger.setAttribute('aria-expanded','false');
  trigger.setAttribute('aria-controls','tsugu-workspace-menu-content');
  trigger.textContent='⋮';
  const content=document.createElement('div');
  content.id='tsugu-workspace-menu-content';
  content.className='tsugu-workspace-menu-content';
  while(tools.firstChild)content.appendChild(tools.firstChild);
  tools.append(trigger,content);

  trigger.addEventListener('click',()=>setOpen(tools,!isOpen(tools),{focus:!isOpen(tools)}));
  content.addEventListener('focusin',()=>{if(!isOpen(tools))setOpen(tools,true);});
  content.addEventListener('click',event=>{
    if(event.target.closest('[data-tsugu-find],[data-tsugu-collapse],[data-tsugu-expand]'))setOpen(tools,false);
  });
}
function scan(){document.querySelectorAll(`#${TOOL_ID}`).forEach(enhance);}

new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('tsugu:project-captured',()=>queueMicrotask(scan));
document.addEventListener('click',event=>{
  const tools=document.querySelector(`#${TOOL_ID}`);
  if(isOpen(tools)&&!tools.contains(event.target))setOpen(tools,false);
},true);
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const tools=document.querySelector(`#${TOOL_ID}`);
  if(isOpen(tools)){event.stopPropagation();setOpen(tools,false,{focus:true});}
},true);
scan();
