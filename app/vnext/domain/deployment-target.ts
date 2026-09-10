export type StableRevision=number;

export type Repository={
  readonly id:string;
  readonly projectId:string;
  readonly provider:string;
  readonly externalRef:string;
  readonly revision:StableRevision;
  readonly createdAt:string;
};

export type RepositoryCommitRef={
  readonly id:string;
  readonly projectId:string;
  readonly repositoryId:string;
  readonly repositoryRevision:StableRevision;
  readonly commitSha:string;
  readonly treeSha:string;
  readonly createdAt:string;
};

export type RepositoryBaseline={
  readonly id:string;
  readonly projectId:string;
  readonly repositoryId:string;
  readonly repositoryRevision:StableRevision;
  readonly commitRefId:string;
  readonly commitSha:string;
  readonly treeSha:string;
  readonly manifestDigest:string;
  readonly createdAt:string;
};

export type Environment={
  readonly id:string;
  readonly projectId:string;
  readonly key:string;
  readonly providerRef:string;
  readonly revision:StableRevision;
  readonly createdAt:string;
};

export type Deployment={
  readonly id:string;
  readonly projectId:string;
  readonly environmentId:string;
  readonly environmentRevision:StableRevision;
  readonly repositoryId:string;
  readonly repositoryRevision:StableRevision;
  readonly commitRefId:string;
  readonly commitSha:string;
  readonly treeSha:string;
  readonly artifactDigest:string;
  readonly configVersion:string;
  readonly schemaVersion:string;
  readonly providerDeploymentRef:string;
  readonly createdAt:string;
};

export type CommitVerificationTarget={
  readonly projectId:string;
  readonly targetType:'COMMIT';
  readonly targetId:string;
  readonly repositoryId:string;
  readonly commitRefId:string;
  readonly commitSha:string;
};

export type DeploymentVerificationTarget={
  readonly projectId:string;
  readonly targetType:'DEPLOYMENT';
  readonly targetId:string;
  readonly repositoryId:string;
  readonly commitRefId:string;
  readonly commitSha:string;
  readonly environmentId:string;
  readonly artifactDigest:string;
  readonly configVersion:string;
  readonly schemaVersion:string;
};

export type VerificationTarget=CommitVerificationTarget|DeploymentVerificationTarget;

export const isGitObjectId=(value:string)=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export const isSha256Digest=(value:string)=>/^sha256:[a-f0-9]{64}$/.test(value);
export const isPositiveRevision=(value:number)=>Number.isSafeInteger(value)&&value>0;
