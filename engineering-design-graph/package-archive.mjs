import {buildImplementationPackage} from './core.mjs';

const enc=new TextEncoder();
const u16=n=>[n&255,(n>>>8)&255];
const u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
const concat=parts=>{const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out};
const json=x=>JSON.stringify(x,null,2)+'\n';
const folder=t=>({task:'tasks',requirement:'requirements',specification:'specifications',domain:'domain',system:'systems',module:'modules',interface:'interfaces',decision:'decisions',question:'questions',source:'sources'}[t]||'artifacts');

let crcTable;
function crc32(bytes){if(!crcTable){crcTable=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0}}let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function dosDateTime(d=new Date()){const year=Math.max(1980,d.getUTCFullYear()),time=(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|(d.getUTCSeconds()>>1),date=((year-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate();return{time,date}}
async function sha256(bytes){const buf=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function textEntry(name,text){return{name,bytes:enc.encode(text)}}

export function packageEntries(pkg){
  const entries=[];
  entries.push(textEntry('README.md',`# Engineering Design Graph Implementation Package\n\nProject: ${pkg.manifest.projectId}\nRoot tasks: ${pkg.manifest.rootTaskIds.join(', ')}\nReadiness snapshot: ${pkg.manifest.readinessSnapshotId}\n`));
  for(const a of pkg.artifacts)entries.push(textEntry(`${folder(a.type)}/${a.key}.json`,json(a)));
  entries.push(textEntry('traceability.json',json(pkg.relations)));
  entries.push(textEntry('validation.json',json(pkg.validation)));
  const c=pkg.codingContext||{};
  entries.push(textEntry('coding-context.md',`# Coding Context\n\n## Objective\n${(c.objective||[]).map(x=>`- ${x}`).join('\n')||'- N/A'}\n\n## Constraints\n${(c.constraints||[]).map(x=>`- ${x}`).join('\n')||'- None'}\n\n## Test Conditions\n${(c.testConditions||[]).map(x=>`- ${x}`).join('\n')||'- None'}\n`));
  return entries.sort((a,b)=>a.name.localeCompare(b.name));
}

export async function finalizeManifest(pkg,entries){
  const canonical=concat(entries.flatMap(e=>[enc.encode(e.name+'\n'),e.bytes,enc.encode('\n')]));
  return {...pkg.manifest,hash:`sha256:${await sha256(canonical)}`};
}

export function createZip(entries,{date=new Date()}={}){
  const locals=[],centrals=[];let offset=0;const dt=dosDateTime(date);
  for(const e of entries){const name=enc.encode(e.name),data=e.bytes,crc=crc32(data);const local=Uint8Array.from([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(dt.time),...u16(dt.date),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...name,...data]);locals.push(local);const central=Uint8Array.from([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(dt.time),...u16(dt.date),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...name]);centrals.push(central);offset+=local.length}
  const centralBytes=concat(centrals),localBytes=concat(locals),end=Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(centralBytes.length),...u32(localBytes.length),...u16(0)]);return concat([localBytes,centralBytes,end]);
}

export async function createImplementationPackageArchive(project,taskIds,options={}){
  const pkg=buildImplementationPackage(project,taskIds,options);
  const entries=packageEntries(pkg);
  const manifest=await finalizeManifest(pkg,entries);
  const all=[textEntry('manifest.json',json(manifest)),...entries].sort((a,b)=>a.name.localeCompare(b.name));
  const zip=createZip(all),archiveHash=`sha256:${await sha256(zip)}`;
  return {manifest,entries:all.map(e=>e.name),zip,archiveHash,fileName:`implementation-package-${taskIds.length===1?(project.artifacts.find(a=>a.id===taskIds[0])?.key||'task'):'tasks'}.zip`};
}
