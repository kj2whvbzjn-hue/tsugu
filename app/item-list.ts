import {statusByKind,type Item,type ItemKind} from './model';
export const pendingLabels:Record<ItemKind,string>={構成:'未完了のみ',作業:'未完了のみ',議論:'未解決・保留のみ',決定:'未確定のみ',検証:'未確認・FAILのみ'};
const settled:Record<ItemKind,readonly string[]>={構成:['完了'],作業:['完了','中止'],議論:['解決'],決定:['確定','却下','廃止'],検証:['PASS','免除']};
export const itemSorts=['元の順序','状態順','タイトル順'] as const;
export function visibleItems(items:Item[],kind:ItemKind,filter='すべて',sort='元の順序'){
 const rows=items.filter(i=>i.kind===kind&&(filter==='すべて'||(filter===pendingLabels[kind]?!settled[kind].includes(i.status):i.status===filter)));
 if(sort==='タイトル順')rows.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true}));
 if(sort==='状態順')rows.sort((a,b)=>(statusByKind[kind] as readonly string[]).indexOf(a.status)-(statusByKind[kind] as readonly string[]).indexOf(b.status));
 return rows;
}
