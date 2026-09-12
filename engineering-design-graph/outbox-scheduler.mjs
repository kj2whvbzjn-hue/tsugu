export class OutboxScheduler{
  constructor({worker,intervalMs=5000,logger=null}={}){if(!worker?.runOnce)throw new Error('Outbox worker is required');if(!Number.isInteger(intervalMs)||intervalMs<100)throw new Error('intervalMs must be >= 100');this.worker=worker;this.intervalMs=intervalMs;this.logger=logger;this.timer=null;this.running=false;this.lastResult=null;this.lastError=null}
  async tick(){if(this.running)return{skipped:true};this.running=true;try{const result=await this.worker.runOnce();this.lastResult=result;this.lastError=null;this.logger?.info?.('outbox.tick',{...result});return result}catch(error){this.lastError=error;this.logger?.error?.('outbox.tick',{message:String(error?.message||error)});return{fetched:0,published:0,failed:1,errors:[{message:String(error?.message||error)}]}}finally{this.running=false}}
  start(){if(this.timer)return this;this.timer=setInterval(()=>{void this.tick()},this.intervalMs);this.timer.unref?.();return this}
  async stop(){if(this.timer){clearInterval(this.timer);this.timer=null}while(this.running)await new Promise(r=>setTimeout(r,10));return this}
}
