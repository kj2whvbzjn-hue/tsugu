import Workspace from './workspace';
import {getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath} from './chatgpt-auth';
import {headers} from 'next/headers';
export const dynamic='force-dynamic';
export default async function Home(){
 const user=await getChatGPTUser();
 const requestHeaders=await headers();
 const signInUrl=chatGPTSignInPath('/');
 if(!user&&!requestHeaders.get('oai-authenticated-user-id'))return <main className="signin-panel panel"><p className="eyebrow">TSUGU / WORKSPACE</p><h1>継ぐにサインイン</h1><p>目的・議論・作業・検証をまとめる、自分専用の開発ワークスペースです。</p><p>ChatGPTアカウントでログインすると、自分の案件を作成・保存できます。</p><a className="button primary" href={signInUrl} target="_top">ChatGPTでサインイン</a><p className="muted">サインイン後、自分の案件一覧へ戻ります。ほかの利用者の案件は表示されません。</p><a href="/storage">保存データと利用について</a></main>;
 return <Workspace signInUrl={signInUrl} signOutUrl={chatGPTSignOutPath('/')} accountLabel={user?.email||'ChatGPTアカウント'}/>;
}
