# A-02 source implementation — Repository / Commit / Baseline / Environment / Deployment

- 日付: 2026-09-11
- Stage: TSUGU Core vNext v2.3 / A-02
- 開始HEAD: `18b331e550042a09f8f6f5100f8e9106e550054f`
- 状態: source implementation completed; exact-head acceptance is determined by the dedicated A-02 PR-head workflow and recorded in PR evidence.

## v2.3との対応

A-02は以下を固定する。

- RepositoryとSHAを別々の識別子として保持し、`(repository_id, commit_sha)`でRepositoryCommitRefを一意化する。
- RepositoryBaselineは参照commitとtree、manifest digestをimmutable snapshotとして固定する。
- EnvironmentはProject scopeとstable ID/revisionを持つ。
- DeploymentはEnvironment、RepositoryCommitRef、commit/tree、artifact digest、config version、schema version、provider deployment referenceを固定する。
- 同一commitを再配置しても別provider deployment referenceなら別Deploymentとして保持する。
- COMMIT/DEPLOYMENTの検査targetは既存のimmutable recordから導出し、後からtarget IDやDeployment内容を上書きしない。

## A-01との境界

A-02はA-01の次の契約を再利用する。

- authenticated stable subjectから導出したActor authority
- Project-scoped Role / Permission
- `authorizeProjectAction`によるfail-closed authorization
- request bodyのactor/Roleをauthorityにしない契約

A-02 Domainは`app/model.ts`、legacy `db/schema.ts`、UI、Sites header parsing、Cloudflare runtimeへ直接依存しない。Sites/D1依存はserver/DB側に閉じ込める。

A-01のproduction bootstrap principal値とserver-only BootstrapConfig carrierはHUMAN-PENDINGのままであり、A-02 source implementationはそれらを確定したものと扱わない。

## Source paths

- `app/vnext/domain/deployment-target.ts`
- `app/vnext/server/deployment-target-service.ts`
- `db/vnext/target-schema.ts`
- `db/vnext/target-store.ts`
- `drizzle/0007_vnext_repository_environment_deployment.sql`
- `tests/vnext-a02-boundary.test.mjs`
- `tests/vnext-a02-target-contract.test.mjs`
- `tests/vnext-a02-persistence.test.mjs`
- `.github/workflows/a02-head-verification.yml`

## Data contract

### Repository

Stable internal ID、`project_id`、provider、external repository reference、revisionを持つ。同じProject/provider/external referenceは同一Repositoryとしてidempotentに解決する。名前やpathを主キーにしない。

### RepositoryCommitRef

Stable internal ID、Project、Repository、Repository revision、commit SHA、tree SHAを持つ。commit/treeは40または64桁のhex object IDのみ受理し、commit SHAは小文字へ正規化する。

一意性は`(repository_id, commit_sha)`。同じSHAが別Repositoryに存在する場合は別RepositoryCommitRefとして保持する。同じRepository+SHAを異なるtreeへ再束縛しようとした場合は`IMMUTABLE_CONFLICT`。

### RepositoryBaseline

Repository、Repository revision、RepositoryCommitRef、commit SHA、tree SHA、manifest SHA-256 digestを固定する。CommitRefとcommit/treeが一致しない入力は`COMMIT_MISMATCH`。現在のRepository treeを後から変更しても既存Baselineの参照値を書き換えない。

### Environment

Stable internal ID、Project、environment key、optional provider reference、revisionを持つ。同一Project+keyのprovider referenceを別値へ暗黙上書きしない。A-02ではEnvironment update APIを公開しない。

### Deployment

Stable internal ID、Project、Environment+revision、Repository+revision、RepositoryCommitRef、commit/tree、artifact SHA-256 digest、config version、schema version、provider deployment referenceを固定する。

provider deployment referenceはEnvironment内で一意。同じprovider deployment referenceを異なるartifact/config/schema/commitへ再束縛すると`IMMUTABLE_CONFLICT`。同じcommitを別provider deployment referenceで再配置することは別Deploymentとして許可する。

## Fail-closed rules

- access Projectとrecord Projectの不一致: `CROSS_PROJECT`
- expected Repository/Environment revision不一致: `STALE_INPUT`
- Repository/Environment/CommitRef不存在: `NOT_FOUND`
- invalid SHA/digest/empty required reference: `INVALID_REFERENCE`
- CommitRefとBaseline/Deploymentのcommit/tree/repository不一致: `COMMIT_MISMATCH`
- 既存immutable identityへの異なる値の再束縛: `IMMUTABLE_CONFLICT`
- A-01 authorizationが拒否する未認証、Actor偽装、権限不足、stale policy等はそのまま拒否する。

## Immutable verification target

`resolveVerificationTarget`は`COMMIT`または`DEPLOYMENT`だけを受理する。

COMMIT targetはRepositoryCommitRefから`repository_id`と`commit_sha`を導出する。DEPLOYMENT targetはDeploymentからEnvironment、RepositoryCommitRef、commit SHA、artifact digest、config version、schema versionを導出する。返却targetはfreezeし、target IDの差し替えを許可しない。

Stage BのCheck/Assuranceはこのtarget contractを参照できるが、A-02からStage B EntityへのFKは導入しない。

## Persistence / migration

`0007_vnext_repository_environment_deployment.sql`はadditive sourceのみで、次を新規作成する。

- `vnext_repositories`
- `vnext_repository_commit_refs`
- `vnext_repository_baselines`
- `vnext_environments`
- `vnext_deployments`

既存migration/table/dataをDROP/ALTER/UPDATE/DELETE/REPLACEしない。legacy `projects`へのFKを作らない。A-01 tableへseed/INSERTしない。

`db/vnext/target-store.ts`はA-02 recordについてcreate/read operationだけを公開し、UPDATE/DELETE operationを公開しない。

## Isolated acceptance conditions

A-02 source-level acceptanceには以下を要求する。

1. A-02 Domainがlegacy/UI/Sites runtimeから分離されている。
2. same Repository+SHAはidempotent、same SHA across different repositoriesは別参照。
3. cross-project、stale Repository/Environment revision、commit/tree mismatchをfail closed。
4. RepositoryBaselineがcommit/tree/manifest digestを固定する。
5. same commit再Deploymentは別Deployment IDで保持できる。
6. same provider deployment identityへの異なるimmutable valuesの上書きを拒否する。
7. COMMIT/DEPLOYMENT verification targetがProject scopedかつimmutable。
8. 0007 migration sourceがadditiveで既存table/dataを書き換えない。
9. production D1/R2/API/hosting/binding/writerを使わないisolated testsで検証する。
10. exact PR headで`npm ci`、A-02 targeted tests、`npm test`、`npx tsc --noEmit --incremental false`が成功する。

専用検査コマンド:

```text
npm ci
node --test tests/vnext-a02-boundary.test.mjs tests/vnext-a02-target-contract.test.mjs tests/vnext-a02-persistence.test.mjs
npm test
npx tsc --noEmit --incremental false
```

## UNVERIFIED / live gate

以下はsourceへ推測値を埋めず、正規に認可されたlive read/registration経路が利用可能になった時点で実体参照として登録・検証する。

- actual Environment identifier
- physical D1 resource ID / binding target
- physical R2 resource ID / binding target
- current live Deployment/provider deployment referenceのA-02 recordへの正式登録
- live artifact digest
- live config version
- live applied DB schema version/migration journal
- authenticated live API/UIでのreadback

logical `DB`/`BUCKET`、provider deployment container ID、env revision等からphysical resource identityを推測しない。

## Production non-actions

A-02 source implementationでは次を実施しない。

- production migration `0007` apply
- A-01 live bootstrap
- production D1/R2 write/delete
- hosting/binding change、rebind、redeploy
- writer cutover
- existing Evidence変更
- TSUGU登録

## A-03 handoff

A-03へ渡すsource contract:

- stable Project-scoped Repository ID
- immutable RepositoryCommitRef and RepositoryBaseline
- Environment stable ID/revision
- immutable Deployment record and verification target resolver
- expected Repository/Environment revisionによるstale-input rejection

A-03のProject/ArchitectureNode/PathEntry/Node BindingはこれらのRepository/target参照を使う。A-03でもphysical D1/R2 identityやlive Deployment値を推測して埋めず、必要なlive verificationはStage-specific gateとして保持する。
