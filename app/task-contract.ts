import {z} from 'zod';
import {changeControlSchema} from './change-control';

export const workTypes=['DEVELOPMENT_ONLY','SOURCE_UPDATE','GAME_DATA'] as const;
export const materialSections=['specifications','system_contracts','implementation_records','project_rules','system_nodes','system_connections','system_impacts','specification_candidates','checks','tasks','records','workflow','lifecycle','authority','source_baseline'] as const;
export const materialRefSchema=z.object({section:z.enum(materialSections),id:z.string().min(1).max(300),projectId:z.string().uuid().optional(),baseRevision:z.number().int().positive().optional()}).strict().superRefine((ref,ctx)=>{
 if((ref.projectId===undefined)!==(ref.baseRevision===undefined))ctx.addIssue({code:'custom',message:'別案件の資料には案件IDと基準版を両方指定してください'});
});
export const materialKey=(ref:{section:string;id:string;projectId?:string;baseRevision?:number})=>JSON.stringify([ref.projectId??null,ref.baseRevision??null,ref.section,ref.id]);
export const taskContractSchema=z.object({
 workType:z.enum(workTypes).nullable(),
 executionOrder:z.number().int().nonnegative().nullable(),
 dependsOn:z.array(z.string().min(1).max(300)).max(1000),
 acceptanceCriteria:z.array(z.string().min(1).max(20000)).max(100),
 requiresHumanApproval:z.boolean().nullable(),
 references:z.array(materialRefSchema).max(100),
 reviewRequired:z.boolean().optional(),
 changeControl:changeControlSchema.optional(),
}).strict().superRefine((t,ctx)=>{
 if(new Set(t.dependsOn).size!==t.dependsOn.length)ctx.addIssue({code:'custom',message:'依存する作業IDが重複しています'});
 if(new Set(t.references.map(materialKey)).size!==t.references.length)ctx.addIssue({code:'custom',message:'資料参照が重複しています'});
});
export const sourceRefSchema=z.object({kind:z.enum(['source','game_data']),repository:z.string().min(1).max(1000),branch:z.string().min(1).max(300),commit:z.string().regex(/^[a-f0-9]{40,64}$/i,'Commitは省略しないSHAで指定してください'),path:z.string().max(1000)}).strict();
export type TaskContract=z.infer<typeof taskContractSchema>;
export type MaterialRef=z.infer<typeof materialRefSchema>;
export const emptyTask=():TaskContract=>({workType:null,executionOrder:null,dependsOn:[],acceptanceCriteria:[],requiresHumanApproval:null,references:[]});
