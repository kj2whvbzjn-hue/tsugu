const test=require('node:test');
const assert=require('node:assert/strict');
const Architecture=require('../static/core-architecture.js');
const Box=require('../static/core-box.js');
const RuleTest=require('../static/core-rule-test.js');
const Impact=require('../static/core-impact-graph.js');

function publishRule(s,id,constraints){s=RuleTest.createRuleDraft(s,{id,version:1,name:id,constraints});return RuleTest.publishRuleDefinition(s,id,1,{now:'2026-09-12T00:00:00Z'});}
function publishTest(s,id){s=RuleTest.createTestDraft(s,{id,version:1,name:id,runner:'shell',command:`echo ${id}`,evaluationConditions:{exitCode:0}});return RuleTest.publishTestDefinition(s,id,1,{now:'2026-09-12T00:01:00Z'});}
function fixture(){
  let a=Architecture.createProjectArchitecture({projectId:'p:c01',name:'C01',repositoryScopes:[{repositoryId:1,fullName:'acme/app'}]});
  a=Architecture.addArchitectureNode(a,{id:'n:root',name:'Root'});
  a=Architecture.addArchitectureNode(a,{id:'n:child',name:'Child',parentNodeId:'n:root'});
  a=Architecture.addArchitectureNode(a,{id:'n:sibling',name:'Sibling',parentNodeId:'n:root'});
  for(const [id,name] of [['p:src','src.js'],['p:tests','tests.js'],['p:config','config.yml'],['p:migrate','migrate.sql'],['p:orphan','orphan.txt']])a=Architecture.addPathEntry(a,{id,repositoryId:1,kind:'FILE',name});
  a=Architecture.addBinding(a,{id:'ab:impl',pathEntryId:'p:src',architectureNodeId:'n:root',relation:'IMPLEMENTS'});
  a=Architecture.addBinding(a,{id:'ab:tests',pathEntryId:'p:tests',architectureNodeId:'n:child',relation:'TESTS'});
  a=Architecture.addBinding(a,{id:'ab:config',pathEntryId:'p:config',architectureNodeId:'n:child',relation:'CONFIGURES'});
  a=Architecture.addBinding(a,{id:'ab:migrate',pathEntryId:'p:migrate',architectureNodeId:'n:sibling',relation:'MIGRATES'});
  let b=Box.seedSystemDefinitions(Box.migrateFromStageA(a));
  b=Box.createBoxInstance(b,{id:'i:root',boxDefinitionId:'system:box:component',boxDefinitionVersion:1,architectureNodeId:'n:root',config:{name:'root'}});
  b=Box.createBoxInstance(b,{id:'i:child',boxDefinitionId:'system:box:leaf',boxDefinitionVersion:1,architectureNodeId:'n:child',parentBoxInstanceId:'i:root',config:{name:'child'}});
  b=Box.createBoxInstance(b,{id:'i:sibling',boxDefinitionId:'system:box:leaf',boxDefinitionVersion:1,architectureNodeId:'n:sibling',parentBoxInstanceId:'i:root',config:{name:'sibling'}});
  let r=RuleTest.migrateFromB01(b);
  r=publishRule(r,'rule:root',[{type:'MIN',key:'coverage',value:70}]);
  r=RuleTest.addRuleBinding(r,{id:'rb:root',ruleDefinitionId:'rule:root',ruleDefinitionVersion:1,targetType:'BOX_INSTANCE',boxInstanceId:'i:root',inheritToChildren:true});
  r=publishRule(r,'rule:child',[{type:'REQUIRED',key:'tls'}]);
  r=RuleTest.addRuleBinding(r,{id:'rb:child',ruleDefinitionId:'rule:child',ruleDefinitionVersion:1,targetType:'BOX_INSTANCE',boxInstanceId:'i:child',inheritToChildren:false});
  r=publishTest(r,'test:smoke');r=publishTest(r,'test:security');
  r=RuleTest.addRequirementSource(r,{id:'src:smoke',sourceBoxDefinitionId:'system:box:leaf',sourceBoxDefinitionVersion:1,testDefinitionId:'test:smoke',testDefinitionVersion:1,scope:'SELF'});
  r=RuleTest.addRequirementSource(r,{id:'src:security',sourceBoxDefinitionId:'system:box:leaf',sourceBoxDefinitionVersion:1,testDefinitionId:'test:security',testDefinitionVersion:1,scope:'SELF'});
  r=RuleTest.deriveRequirements(r);
  return r;
}
function actual(files){return{id:'actual:c01',projectId:'p:c01',repositoryId:1,files};}
function mapped(path,pathEntryId,changeType='MODIFIED',mappingStatus='MAPPED',previousPath=null){return{path,pathEntryId,changeType,mappingStatus,previousPath};}
function reqIds(state,boxId,testId=null){return state.testRequirements.filter(r=>r.status==='ACTIVE'&&r.target.boxInstanceId===boxId&&(!testId||r.testDefinition.id===testId)).map(r=>r.id).sort();}

test('C-01 propagates IMPLEMENTS TESTS CONFIGURES MIGRATES independently',()=>{
  const s=fixture(),g=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([
    mapped('src.js','p:src'),mapped('tests.js','p:tests'),mapped('config.yml','p:config'),mapped('migrate.sql','p:migrate')
  ])});
  const child=reqIds(s,'i:child'),sibling=reqIds(s,'i:sibling'),all=[...child,...sibling].sort();
  assert.deepEqual(g.relationImpacts.IMPLEMENTS.requirementIds,all);
  assert.deepEqual(g.relationImpacts.TESTS.requirementIds,child);
  assert.deepEqual(g.relationImpacts.CONFIGURES.requirementIds,child);
  assert.deepEqual(g.relationImpacts.MIGRATES.requirementIds,sibling);
  assert.equal(g.relationImpacts.TESTS.assuranceScope,'MATCHED_REQUIREMENTS_ONLY');
  assert.equal(g.requiresFullTest,false);assert.equal(g.status,'TARGETED');
});

test('TESTS path change does not stale unrelated target requirements',()=>{
  const s=fixture(),g=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([mapped('tests.js','p:tests')])});
  assert.deepEqual(g.impactedRequirementIds,reqIds(s,'i:child'));
  assert.ok(reqIds(s,'i:sibling').every(id=>!g.impactedRequirementIds.includes(id)));
  assert.equal(g.relationImpacts.IMPLEMENTS.requirementIds.length,0);
});

test('explicit mapped rename keeps stable PathEntry targeting while unknown rename falls back to Full test',()=>{
  const s=fixture();
  const known=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([mapped('tests-renamed.js','p:tests','RENAMED','MAPPED_RENAME','tests.js')])});
  assert.equal(known.requiresFullTest,false);assert.deepEqual(known.relationImpacts.TESTS.requirementIds,reqIds(s,'i:child'));
  const unknown=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([{path:'mystery.js',previousPath:null,pathEntryId:null,changeType:'RENAMED',mappingStatus:'CONFIRMATION_REQUIRED'}])});
  assert.equal(unknown.requiresFullTest,true);assert.ok(unknown.fullTestScopes[0].reasonCodes.includes('RENAME_CONFIRMATION_REQUIRED'));
});

test('mapped deletion uses relation, but missing binding and unmapped path require related repository Full test',()=>{
  const s=fixture();
  const removed=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([mapped('config.yml','p:config','REMOVED')])});
  assert.equal(removed.requiresFullTest,false);assert.deepEqual(removed.relationImpacts.CONFIGURES.requirementIds,reqIds(s,'i:child'));
  const missing=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([mapped('orphan.txt','p:orphan')])});
  assert.equal(missing.requiresFullTest,true);assert.ok(missing.fullTestScopes[0].reasonCodes.includes('BINDING_MISSING'));assert.equal(missing.fullTestScopes[0].projectId,'p:c01');
  const unmapped=Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:actual([{path:'new.txt',pathEntryId:null,changeType:'ADDED',mappingStatus:'UNMAPPED'}])});
  assert.equal(unmapped.requiresFullTest,true);assert.ok(unmapped.fullTestScopes[0].reasonCodes.includes('UNMAPPED_PATH'));
});

test('RuleDefinition and RuleBinding changes use exact effective-rule provenance',()=>{
  const s=fixture(),child=reqIds(s,'i:child'),sibling=reqIds(s,'i:sibling');
  const rule=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'RULE_DEFINITION',id:'fact:rule',ruleDefinitionId:'rule:child',ruleDefinitionVersion:1}]});
  assert.deepEqual(rule.impactedRequirementIds,child);assert.ok(sibling.every(id=>!rule.impactedRequirementIds.includes(id)));
  const binding=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'RULE_BINDING',id:'fact:rb',ruleBindingId:'rb:child'}]});
  assert.deepEqual(binding.impactedRequirementIds,child);assert.equal(binding.requiresFullTest,false);
});

test('TestDefinition change impacts only requirements that reference that test version',()=>{
  const s=fixture(),expected=[...reqIds(s,'i:child','test:smoke'),...reqIds(s,'i:sibling','test:smoke')].sort();
  const g=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'TEST_DEFINITION',id:'fact:test',testDefinitionId:'test:smoke',testDefinitionVersion:1}]});
  assert.deepEqual(g.relationImpacts.TESTS.requirementIds,expected);
  assert.ok(s.testRequirements.filter(r=>r.testDefinition.id==='test:security').every(r=>!g.impactedRequirementIds.includes(r.id)));
});

test('ArchitectureBinding retarget evaluates both previous and current relation scopes',()=>{
  const s=fixture(),expected=[...reqIds(s,'i:child'),...reqIds(s,'i:sibling')].sort();
  const g=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'ARCHITECTURE_BINDING',id:'fact:move',repositoryId:1,
    previousBinding:{id:'ab:move:old',projectId:'p:c01',pathEntryId:'p:tests',relation:'TESTS',targetType:'BOX_INSTANCE',boxInstanceId:'i:child'},
    currentBinding:{id:'ab:move:new',projectId:'p:c01',pathEntryId:'p:tests',relation:'TESTS',targetType:'BOX_INSTANCE',boxInstanceId:'i:sibling'}
  }]});
  assert.deepEqual(g.relationImpacts.TESTS.requirementIds,expected);assert.equal(g.requiresFullTest,false);
});

test('unknown binding target and unclassified fact do not infer no-impact',()=>{
  const s=fixture();
  const x=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'ARCHITECTURE_BINDING',id:'fact:unknown',repositoryId:1,bindingId:'missing'}]});
  assert.equal(x.requiresFullTest,true);assert.ok(x.fullTestScopes[0].reasonCodes.includes('ARCHITECTURE_BINDING_TARGET_UNKNOWN'));
  const y=Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'UNCLASSIFIED',id:'fact:unknown2',repositoryId:1}]});
  assert.equal(y.requiresFullTest,true);assert.ok(y.fullTestScopes[0].reasonCodes.includes('UNCLASSIFIED_CHANGE'));
});

test('Impact Graph is deterministic, hash-fixed and does not mutate source registries',()=>{
  const s=fixture(),before=RuleTest.serialize(s),input={ruleTestRegistry:s,actualChange:actual([mapped('src.js','p:src'),mapped('tests.js','p:tests')])};
  const a=Impact.buildImpactGraph(input),b=Impact.buildImpactGraph(input);
  assert.equal(a.impactHash,b.impactHash);assert.match(a.impactHash,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(a,b);assert.equal(RuleTest.serialize(s),before);
});

test('cross-Project ActualChange and facts are rejected',()=>{
  const s=fixture();
  assert.throws(()=>Impact.buildImpactGraph({ruleTestRegistry:s,actualChange:{id:'x',projectId:'other',repositoryId:1,files:[]}}),e=>e.code==='PROJECT_SCOPE_VIOLATION');
  assert.throws(()=>Impact.buildImpactGraph({ruleTestRegistry:s,changeFacts:[{type:'UNCLASSIFIED',id:'f',projectId:'other',repositoryId:1}]}),e=>e.code==='PROJECT_SCOPE_VIOLATION');
});
