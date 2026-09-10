export const vnextPermissions=['project.read','project.write','membership.manage','policy.manage','audit.read'] as const;
export type Permission=typeof vnextPermissions[number];

export type Actor={
  id:string;
  subjectId:string;
  emailHash:string;
  createdAt:string;
};

export type Role={
  id:string;
  projectId:string;
  name:string;
  permissions:readonly Permission[];
  createdAt:string;
};

export type ProjectMembership={
  id:string;
  projectId:string;
  actorId:string;
  roleId:string;
  revision:number;
  createdAt:string;
};

export type Policy={
  id:string;
  projectId:string;
  version:number;
  documentJson:string;
  createdAt:string;
  updatedAt:string;
};

export type AuthPrincipal={
  subjectId:string;
  emailHash:string;
};

export type BootstrapReceipt={
  id:string;
  generation:string;
  subjectId:string;
  actorId:string;
  projectId:string;
  membershipId:string;
  configFingerprint:string;
  createdAt:string;
};

export function assertOpaqueId(value:string,label:string){
  const id=String(value??'').trim();
  if(!id||id.length>200)throw new Error(`${label} ID is invalid`);
  return id;
}

export function assertPolicyVersion(value:number,label='policy version'){
  if(!Number.isSafeInteger(value)||value<1)throw new Error(`${label} is invalid`);
  return value;
}

export function normalizePermissions(values:readonly string[]):Permission[]{
  const allowed=new Set<string>(vnextPermissions);
  const out=[...new Set(values.map(String))];
  if(out.some(value=>!allowed.has(value)))throw new Error('permission is invalid');
  return out as Permission[];
}
