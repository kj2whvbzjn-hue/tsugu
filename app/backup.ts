import type {RecordData,Item} from './model';
export type DraftState={item?:Item;proposalText?:string};
export function makeBackup(record:RecordData,originalText?:string,originalFetchError?:string,draftState?:DraftState){
 return {...structuredClone(record),backupInfo:{originalIncluded:!!originalText,originalFetchError:originalFetchError||null,createdAt:new Date().toISOString()},...(originalText?{originalText}:{}),...(draftState?{draftState}:{} )};
}
export function fileResponse(text:string,name:string,type='application/json'){
 return new Response(text,{headers:{'Content-Type':type+'; charset=utf-8','Content-Disposition':`attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
