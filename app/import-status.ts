import {isStatusForKind,type ItemKind,type ItemStatus} from './model';

const legacyStatusByKind:Record<ItemKind,Record<string,ItemStatus>>={
  '構成':{Todo:'未着手',Doing:'進行中',Done:'完了'},
  '作業':{Todo:'未着手',Doing:'進行中',Blocked:'保留',Done:'完了'},
  '議論':{Open:'未解決',Resolved:'解決',Closed:'解決',Blocked:'保留',Pending:'未解決'},
  '決定':{Approved:'確定',Accepted:'確定',Proposed:'提案中',Draft:'提案中',Pending:'提案中',Rejected:'却下',Superseded:'廃止',Deprecated:'廃止'},
  '検証':{Pending:'未確認',Passed:'PASS',Failed:'FAIL',Waived:'免除'},
};

export function importStatus(kind:ItemKind,value:unknown,id:string,allowMissing=false):{status:ItemStatus;warning?:string}{
  const source=value==null?'':typeof value==='string'?value:JSON.stringify(value);
  // Architecture nodes and work boxes in the old format have no status field.
  if(allowMissing&&source==='')return {status:'未着手'};
  const status=Object.hasOwn(legacyStatusByKind[kind],source)?legacyStatusByKind[kind][source]:undefined;
  if(status&&isStatusForKind(kind,status))return {status};
  // Already normalized values keep their meaning during legacy-format imports.
  if(isStatusForKind(kind,source))return {status:source};
  return {status:'要確認',warning:`${kind} / ${id}: 元の状態 ${JSON.stringify(source||'（未指定）')} を解釈できないため「要確認」にしました。`};
}
