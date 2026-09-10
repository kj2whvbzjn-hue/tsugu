/** Only use identity headers supplied by Sites dispatch. Never accept identity in a request body. */
export async function identityFromHeaders(headers:Headers){
 const id=headers.get('oai-authenticated-user-id')?.trim()||'';
 const email=headers.get('oai-authenticated-user-email')?.trim().toLowerCase()||'';
 if(!email&&!id)return null;
 const digest=email?await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email)):null;
 const emailKey=digest?'email:'+Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join(''):'';
 // Keep old user-id-owned rows accessible when both identity forms are supplied.
 const owner=emailKey||id;
 return {owner,keys:[owner,id||owner] as [string,string]};
}
