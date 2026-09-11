# TSUGU Core vNext G0-02 実装契約

**固定日:** 2026-09-11  
**対象:** `kj2whvbzjn-hue/tsugu` / GitHub Pages + Private data repository  
**基準:** `docs/TSUGU_CORE_VNEXT_PLAN.md` / `docs/TSUGU_CORE_VNEXT_WBS.md`

## 1. Aggregate / ChangeSet確定境界

- 1 Project = `data/projects/<projectId>.json` 1ファイルを現行Aggregateとする。
- 保存前に現行Git blob SHAと案件`revision`を再取得する。
- 更新はGitHub Contents APIの1回のPUTを確定点とする。
- `revision`は既存版+1、新規は1だけを許可する。
- blob SHA不一致、revision不一致、案件ID不一致は部分適用せず拒否する。
- 複数ファイル原子確定が必要になるTaskまではGit tree/commit APIへ拡張しない。

## 2. Actor / Permission

- Actorの本人同定はGitHub `GET /user` の結果だけを正本とする。
- Actor IDはGitHub user idを基準に `github:<id>` とする。idが取得不能な場合だけloginを補助識別に使う。
- Project権限は案件データRepositoryに対するGitHub permissionから導出する。
  - `admin` または `maintain` → `PROJECT_ADMIN`
  - `push` → `EDITOR`
  - それ以外 → `VIEWER`
- `PROJECT_ADMIN`だけがApproval/Waiverの新規主体になれる。
- payload内のactor文字列、AI自己申告、Raw JSON編集を本人確認として使わない。
- `core.actors` / `core.permissions` はCore Guard管理とし、UI payloadから直接昇格・削除・置換できない。

## 3. Project scope

- 保存pathの`projectId`とpayloadの`project.id`は必ず一致させる。
- Core内に`projectId` / `project_id`を持つEntityは同一Projectだけを参照できる。
- 別Project IDが混入した保存は `PROJECT_SCOPE_VIOLATION` で拒否する。

## 4. Audit

- Project保存ごとに`core.auditEvents`へ追記する。
- Auditは少なくとも actor ID/login、Project、案件revision、base blob SHA、payload SHA-256、時刻、CREATE/UPDATE種別を固定する。
- 過去Auditの削除・上書きは保存境界で拒否する。
- Auditのpayload hashはSystem管理配列を除外した案件payloadから計算し、自己参照を避ける。

## 5. Evidence / Deployment / Repository

- Evidenceは将来 `tsugu-data` 内immutable pathへ版別保存し、SHA-256、size、Git blob SHA、対象revisionをreadback後に確定する。A-01ではEvidence本体をまだ実装しない。
- DeploymentはGitHub Pagesのsource commit、Actions run/deployment、公開URL、取得時刻を固定する。A-02でtyped recordへ実装する。
- RepositoryCommitRefはrepository + full commit SHAを一意参照とする。同じSHA文字列でも別Repositoryなら別参照とする。

## 6. 復旧

- 旧server runtime、D1、R2、Sitesを復旧経路にしない。
- コードはGit履歴の既知正常commitとの差分を確認し、修正commitで復旧する。
- 案件データはPrivate data repositoryのGit履歴を保持し、コード撤去とデータ削除を同一操作にしない。

## 7. A-01受入条件への接続

A-01では本契約に従い、公開UIの既存保存処理の前段にCore Guardを置く。以下を自動検査する。

- GitHub認証主体からActorを導出する
- Repository permissionからProject roleを導出する
- 別Project参照を拒否する
- actor偽装を拒否する
- 権限配列の直接編集による自己昇格を拒否する
- Approval/Waiverを非管理者が新規作成することを拒否する
- Audit履歴の改ざんを拒否し、保存ごとにAuditを追記する
- revisionが1ずつ進まない保存を拒否する
