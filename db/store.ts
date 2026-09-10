import {env} from 'cloudflare:workers';
export function database(){if(!env.DB)throw Error('保存サービスを利用できません');return env.DB;}

function objectBucket(){if(!env.BUCKET)throw Error('ファイルの保存サービスを利用できません');return env.BUCKET;}
export function originalBucket(){return objectBucket();}
export function evidenceBucket(){return objectBucket();}
