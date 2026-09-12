(()=>{
  'use strict';

  const selector='.field textarea:not(.code)';
  let active=null;

  function fieldLabel(source){
    const field=source.closest('.field');
    const text=field?.querySelector('span')?.textContent?.trim();
    return text||source.getAttribute('aria-label')||'長文テキスト';
  }

  function enhance(root=document){
    const nodes=[];
    if(root instanceof Element&&root.matches(selector))nodes.push(root);
    if(root.querySelectorAll)nodes.push(...root.querySelectorAll(selector));
    for(const source of nodes){
      source.classList.add('longtext-zoomable');
      if(!source.getAttribute('title'))source.setAttribute('title','タップして全画面で編集');
      source.setAttribute('aria-haspopup','dialog');
    }
  }

  function sync(source,editor){
    source.value=editor.value;
    source.dispatchEvent(new Event('input',{bubbles:true}));
  }

  function closeEditor({restoreFocus=true}={}){
    if(!active)return;
    const {source,overlay,editor}=active;
    sync(source,editor);
    active=null;
    overlay.remove();
    document.body.classList.remove('longtext-editor-open');
    if(restoreFocus&&source.isConnected){
      try{source.focus({preventScroll:true})}catch{source.focus()}
    }
  }

  function openEditor(source){
    if(active||!source||source.disabled||source.readOnly)return;

    const label=fieldLabel(source);
    const overlay=document.createElement('div');
    overlay.className='longtext-editor-backdrop';
    overlay.dataset.longtextEditor='';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label',`${label} 全画面編集`);

    const shell=document.createElement('section');
    shell.className='longtext-editor-shell';

    const header=document.createElement('header');
    header.className='longtext-editor-header';

    const heading=document.createElement('div');
    heading.className='longtext-editor-heading';
    const title=document.createElement('strong');
    title.className='longtext-editor-title';
    title.textContent=label;
    const hint=document.createElement('span');
    hint.className='longtext-editor-hint';
    hint.textContent='全画面編集';
    heading.append(title,hint);

    const back=document.createElement('button');
    back.type='button';
    back.className='longtext-editor-back';
    back.textContent='編集画面へ戻る';

    header.append(heading,back);

    const editor=document.createElement('textarea');
    editor.className='longtext-editor-textarea';
    editor.value=source.value;
    editor.setAttribute('aria-label',`${label} 全画面入力`);
    editor.spellcheck=source.spellcheck;

    shell.append(header,editor);
    overlay.append(shell);
    document.body.append(overlay);
    document.body.classList.add('longtext-editor-open');
    active={source,overlay,editor};

    editor.addEventListener('input',()=>sync(source,editor));
    back.addEventListener('click',()=>closeEditor());
    overlay.addEventListener('click',event=>{
      if(event.target===overlay)closeEditor();
    });

    requestAnimationFrame(()=>editor.focus());
  }

  document.addEventListener('click',event=>{
    const source=event.target instanceof Element?event.target.closest(selector):null;
    if(!source)return;
    event.preventDefault();
    openEditor(source);
  },true);

  document.addEventListener('keydown',event=>{
    if(active&&event.key==='Escape'){
      event.preventDefault();
      closeEditor();
    }
  });

  enhance();
  new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.addedNodes){
        if(node instanceof Element)enhance(node);
      }
    }
  }).observe(document.documentElement,{childList:true,subtree:true});

  window.TSUGULongTextEditor=Object.freeze({
    open:openEditor,
    close:closeEditor,
    isOpen:()=>Boolean(active)
  });
})();
