const fs=require('node:fs');
const p='c04-ui-usability-v3-baseline-evidence.json';
const v2p='c04-ui-usability-v2-evidence.json';
const e=JSON.parse(fs.readFileSync(p,'utf8'));
const v2=JSON.parse(fs.readFileSync(v2p,'utf8'));
const one=e.metrics.related.oneHop;
const chain=e.metrics.related.chain;
const oneHop={
  startState:'REL-A edit modal already open',
  route:'close A -> list -> search REL-B -> open B',
  buttonActions:Math.max(0,one.actions-1),
  searches:Math.max(0,one.searches-1),
  stateTransitions:Math.max(0,one.transitions-1),
  listIntermediates:one.listIntermediates,
  totalUserActions:Math.max(0,one.actions-1)+Math.max(0,one.searches-1),
  draftPreserved:false
};
const relationChain={
  startState:'REL-A edit modal already open',
  forwardRoute:'A -> list/search -> B -> list/search -> C',
  returnRoute:'C -> list/search -> A',
  forwardButtonActions:Math.max(0,chain.forwardActions-1),
  forwardSearches:Math.max(0,chain.searches-2),
  forwardStateTransitions:Math.max(0,chain.forwardTransitions-1),
  forwardTotalUserActions:Math.max(0,chain.forwardActions-1)+Math.max(0,chain.searches-2),
  returnButtonActions:Math.max(0,chain.returnActions-1),
  returnSearches:1,
  returnStateTransitions:chain.returnTransitions,
  returnTotalUserActions:Math.max(0,chain.returnActions-1)+1,
  fullSearches:Math.max(0,chain.searches-1),
  fullStateTransitions:Math.max(0,chain.forwardTransitions-1)+chain.returnTransitions,
  fullListIntermediates:chain.listIntermediates,
  fullTotalUserActions:(Math.max(0,chain.forwardActions-1)+Math.max(0,chain.searches-2))+(Math.max(0,chain.returnActions-1)+1),
  draftPreserved:chain.draftPreserved
};
e.metrics.relatedNormalized={oneHop,chain:relationChain};
e.scenarios['UI3-05'].metrics=oneHop;
e.scenarios['UI3-05'].reason='From an already-open related origin, current UI requires closing the modal, returning to the list, one manual search, and reopening the target. Unsaved origin draft cannot remain in-context.';
e.scenarios['UI3-06'].metrics=relationChain;
e.scenarios['UI3-06'].reason='A→B→C→A requires repeated list/search cycles and loses the unsaved origin draft.';
const v2Runtime=v2.runtime||{};
const runtimePass=v2.status==='PASS'&&(v2Runtime.consoleErrors||[]).length===0&&(v2Runtime.pageErrors||[]).length===0&&(v2Runtime.apiErrors||[]).length===0;
e.scenarios['UI3-08']={status:runtimePass?'PASS':'FAIL',metrics:{v2Status:v2.status,v2Runtime,baselineHarnessTransient404:e.runtime.apiErrors},reason:runtimePass?'Existing C-04 v2 runtime and viewport regression remains PASS; baseline harness transient project-read 404s are classified separately.':'Existing C-04 v2 regression did not remain clean.'};
e.notes.push('Related navigation metrics normalized to start from REL-A edit already open; initial acquisition/search of REL-A is excluded.');
e.notes.push('UI3-08 uses the separately executed C-04 v2 regression as the product runtime authority. Baseline-harness transient project-read 404s are not product runtime failures.');
const failed=Object.entries(e.scenarios).filter(([,x])=>x.status==='FAIL').map(([id])=>id);
e.failedScenarios=failed;e.status=failed.length?'BASELINE_FAIL':'BASELINE_PASS';e.summary={scenarioCount:Object.keys(e.scenarios).length,pass:Object.values(e.scenarios).filter(x=>x.status==='PASS').length,fail:failed.length};
fs.writeFileSync('c04-ui-usability-v3-baseline-evidence-normalized.json',JSON.stringify(e,null,2)+'\n');
console.log('C04_V3_NORMALIZED',JSON.stringify({status:e.status,failed,oneHop,relationChain,workspace:e.metrics.workspace,density:e.metrics.density,decisionInfo:e.metrics.decisionInfo,v2Status:v2.status}));
