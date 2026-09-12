export class OutboxWorker{
  constructor({store,publisher,batchSize=100,maxAttempts=8,baseDelaySeconds=30}){
    if(!store?.pending||!store?.markPublished)throw new Error('Outbox store with pending() and markPublished() is required');
    if(!publisher?.publish)throw new Error('Publisher with publish() is required');
    this.store=store;this.publisher=publisher;this.batchSize=batchSize;this.maxAttempts=maxAttempts;this.baseDelaySeconds=baseDelaySeconds;
  }
  async runOnce(){
    const events=await this.store.pending(this.batchSize),result={fetched:events.length,published:0,failed:0,deadLettered:0,errors:[]};
    for(const event of events){
      try{
        await this.publisher.publish({id:event.id,type:event.event_type||event.eventType,aggregateType:event.aggregate_type||event.aggregateType,aggregateId:event.aggregate_id||event.aggregateId,payload:event.payload,createdAt:event.created_at||event.createdAt,attemptCount:Number(event.attempt_count??event.attemptCount??0)});
        await this.store.markPublished(event.id);result.published++;
      }catch(error){
        result.failed++;let state=null;if(this.store.markFailed)state=await this.store.markFailed(event.id,error,{maxAttempts:this.maxAttempts,baseDelaySeconds:this.baseDelaySeconds});
        if(state?.dead_lettered_at||state?.deadLetteredAt)result.deadLettered++;
        result.errors.push({id:event.id,message:String(error?.message||error),attemptCount:Number(state?.attempt_count??state?.attemptCount??event.attempt_count??event.attemptCount??0),deadLettered:!!(state?.dead_lettered_at||state?.deadLetteredAt)});
      }
    }
    return result;
  }
}

export function createInMemoryPublisher(){const messages=[];return{messages,async publish(event){messages.push(structuredClone(event));return event}}}
