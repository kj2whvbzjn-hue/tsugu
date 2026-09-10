import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';

// TSUGU replaced the starter preview page. Check the actual app contract,
// using workerd so Cloudflare imports are tested instead of mocked away.
test("renders TSUGU metadata and sign-in while protecting project APIs in the Worker runtime", async () => {
  const config=JSON.parse(await readFile(new URL('../dist/server/wrangler.json',import.meta.url),'utf8'));
  const runtime=new Miniflare({
    modules:true,
    scriptPath:fileURLToPath(new URL('../dist/server/index.js',import.meta.url)),
    modulesRoot:fileURLToPath(new URL('../dist/server/',import.meta.url)),
    modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs'],fallthrough:true}],
    compatibilityDate:config.compatibility_date,
    compatibilityFlags:config.compatibility_flags,
    d1Databases:['DB'],r2Buckets:['BUCKET'],
    serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},
  });
  try {
  const response = await runtime.dispatchFetch('http://localhost/',{headers:{accept:'text/html'}});

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html=await response.text();
  assert.match(html,/<title>継ぐ — 開発ワークスペース<\/title>/);
  assert.match(html,/<meta name="description" content="目的、議論、決定、作業、検証を次の開発へつなぐ。"/);
  assert.match(html,/<h1>継ぐにサインイン<\/h1>/);
  assert.match(html,/href="\/signin-with-chatgpt\?return_to=%2F"/);
  for(const path of ['/api/projects','/api/projects/task-context','/api/proposals']){
    const denied=await runtime.dispatchFetch('http://localhost'+path);
    assert.equal(denied.status,401,path);
  }
  } finally { await runtime.dispose(); }
});
