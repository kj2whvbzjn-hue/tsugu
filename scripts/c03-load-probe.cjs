'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Sync=require('../static/core-sync.js');
const Recovery=require('../static/core-sync-recovery.js');
const H=require('../static/core-changeset.js');
const A=require('../static/core-assurance-event.js');
const AH=require('../static/core-architecture-health.js');

const profilePath=process.argv[2]||path.join(__dirname,'../docs/TSUGU_CORE_VNEXT_C03_LOAD_PROFILE.json');
const outputPath=process.argv[3]||path.join(process.cwd(),'c03-load-result.json');
const profile=JSON.parse(fs.readFileSync(profilePath,'utf8'));
function sha(n){return Number(n).toString(16).padStart(40,'0').slice(-40);}
function ref(type,id,version=1){return{type,id,version,hash:H.sha256(`${type}:${id}:${version}`)};}
function buildSyncSeed(count){let s=Sync.createSyncAggregate({projectId:'c03:load'});for(let i=1;i<=count;i++)s=Sync.receiveCommit(s,{id:10,full_name:'benchmark/repo'},sha(i),'main',{now:'2026-09-12T00:00:00Z'}).aggregate;return s;}
function buildAssuranceSeed(count){let a=A.createRegistry({projectId:'c03:load'});for(let i=1;i<=count;i++)a=A.defineEvent(a,{id:`event:${i}`,version:1,name:`event ${i}`,scope:{subject:ref('BOX_INSTANCE',`box:${i}`),requirementSnapshot:ref('REQUIREMENT_SNAPSHOT',`snapshot:${i}`),target:ref('COMMIT','f'.repeat(40))}});return a;}
const syncSeed=buildSyncSeed(profile.integrationRecords);
const assuranceSeed=buildAssuranceSeed(profile.recalculationItems);
let finalSync=syncSeed,health=null;
const impactCore={type:'ImpactGraph',schemaVersion:1,projectId:'c03:load',architectureRevision:1,actualChangeId:'benchmark',relationImpacts:{},impacts:[],edges:[],fullTestScopes:[],requiresFullTest:false,impactedRequirementIds:[],status:'NO_IMPACT'};
const impact={...impactCore,impactHash:H.sha256(impactCore)};
const result=Recovery.runLoadProbe({
  profile,
  now:new Date().toISOString(),
  syncWork(){let s=syncSeed;for(let i=1;i<=profile.missedCommits;i++)s=Sync.receiveCommit(s,{id:10,full_name:'benchmark/repo'},sha(profile.integrationRecords+i),'main',{now:'2026-09-12T00:01:00Z'}).aggregate;finalSync=s;},
  recalculate(){health=AH.buildArchitectureHealth({projectId:'c03:load',assuranceEventRegistry:assuranceSeed,impactGraph:impact},{now:'2026-09-12T00:02:00Z'});}
});
const assessment=Recovery.assessLoadProbe(result,{cause:process.env.C03_LOAD_EXCEEDANCE_CAUSE||''});
const evidence={type:'C03LoadEvidence',profile,result,assessment,observed:{finalIntegrationRecords:finalSync.integrations.length,healthItems:health.items.length,healthHash:health.healthHash},runner:{node:process.version,platform:process.platform,arch:process.arch}};
fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
