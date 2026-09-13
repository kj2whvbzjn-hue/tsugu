export function createStructuredLogger({sink=console}={}){
  const entries=[];
  function write(level,event,fields={}){const entry={timestamp:new Date().toISOString(),level,event,...fields};entries.push(entry);const fn=sink?.[level]||sink?.log;if(fn)fn.call(sink,JSON.stringify(entry));return entry}
  return{entries,info:(event,fields)=>write('info',event,fields),warn:(event,fields)=>write('warn',event,fields),error:(event,fields)=>write('error',event,fields)};
}

export function createMetrics(){
  const counters=new Map(),durations=new Map();
  const inc=(name,labels={},value=1)=>{const key=`${name}|${JSON.stringify(labels)}`;counters.set(key,(counters.get(key)||0)+value)};
  const observe=(name,value,labels={})=>{const key=`${name}|${JSON.stringify(labels)}`;const arr=durations.get(key)||[];arr.push(value);durations.set(key,arr)};
  const snapshot=()=>({counters:Object.fromEntries(counters),durations:Object.fromEntries([...durations].map(([k,v])=>[k,{count:v.length,sum:v.reduce((a,b)=>a+b,0),max:v.length?Math.max(...v):0}]))});
  return{inc,observe,snapshot};
}

export function createRateLimiter({limit=120,windowMs=60_000,clock=()=>Date.now()}={}){
  const buckets=new Map();
  return{
    check(key){const now=clock(),current=buckets.get(key);if(!current||now-current.startedAt>=windowMs){const next={startedAt:now,count:1};buckets.set(key,next);return{allowed:true,remaining:limit-1,resetAt:now+windowMs}}
      current.count++;return{allowed:current.count<=limit,remaining:Math.max(0,limit-current.count),resetAt:current.startedAt+windowMs};},
    reset(key){buckets.delete(key)},clear(){buckets.clear()}
  };
}
