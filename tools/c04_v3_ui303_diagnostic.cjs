const fs = require('node:fs');

const sourcePath = 'tests/c04-ui-usability-v3.e2e.cjs';
const outPath = 'tests/c04-ui-usability-v3.diagnostic.cjs';
let s = fs.readFileSync(sourcePath, 'utf8');
const needle = "const ui303=decisionTravel<=844*plan.budgets.projectDecisionInfoTravelMaxViewports;mark('UI3-03',ui303,{startY,endY,decisionTravel,limit:844});assert.equal(ui303,true,JSON.stringify(evidence.scenarios['UI3-03']));";
if ((s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) {
  throw new Error('UI3-03 frozen-test anchor not found exactly once');
}
const replacement = `const ui303diag=await page.evaluate(()=>{\n  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,absTop:r.top+scrollY,absBottom:r.bottom+scrollY}};\n  const panel=document.querySelector('.overview-panel');\n  const grid=document.querySelector('.overview-grid');\n  const fields=[...document.querySelectorAll('.overview-panel label.field')].map(label=>{\n    const span=label.querySelector('span');\n    const control=label.querySelector('input,select,textarea');\n    const cs=control?getComputedStyle(control):null;\n    return{label:span?.textContent?.trim()||'',field:rect(label),control:control?{tag:control.tagName,rows:control.rows||null,box:rect(control),height:cs.height,minHeight:cs.minHeight,lineHeight:cs.lineHeight,paddingTop:cs.paddingTop,paddingBottom:cs.paddingBottom}:null};\n  });\n  const gs=grid?getComputedStyle(grid):null;\n  return{scrollY,innerHeight,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight,maxScroll:document.documentElement.scrollHeight-innerHeight,panel:panel?rect(panel):null,grid:grid?{box:rect(grid),template:gs.gridTemplateColumns,rowGap:gs.rowGap,columnGap:gs.columnGap}:null,fields};\n});\nconsole.log('UI303_DIAG',JSON.stringify({startY,endY,decisionTravel,limit:844,layout:ui303diag}));\nconst ui303=decisionTravel<=844*plan.budgets.projectDecisionInfoTravelMaxViewports;mark('UI3-03',ui303,{startY,endY,decisionTravel,limit:844,diagnostic:ui303diag});`;
s = s.replace(needle, replacement);
fs.writeFileSync(outPath, s);
console.log('C04_UI303_DIAGNOSTIC_COPY_READY', outPath);
