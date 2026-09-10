# TSUGU Core vNext G0-02 Decision候補

- 作成日: 2026-09-10
- 対象計画: TSUGU Core vNext 修正版計画 v2.3
- 前提Task: G0-01
- 状態: **Decision候補。未承認。**

この文書は G0-01 の静的調査と開始SHA固定のbuild/test結果を入力に、G0-02で固定すべき実装契約を整理したもの。ここに記載した内容を人間承認済みDecisionとして扱わない。

## D-G0-02-01 Core vNext と legacy の物理境界

### 計画から固定できる候補

- 新機能を `items` / legacy model に追加しない。
- Core vNext の Domain / API / DB access / Test は legacy と物理的に分離する。
- vNext Domain から legacy `app/model.ts` を直接 import しない。
- legacy の読み取り・変換が必要な場合は boundary adapter / migration / compatibility 層に閉じ込め、vNext Entity の正本にしない。
- 汎用 UI / utility の再利用は業務データモデル非依存のものに限定する。
- writer切替、legacy整理、削除は G0/A では行わず、RのGate後に行う。

### G0-01実測との対応

現行 `Project` は `items[]` と `core` を同時に持ち、typed Core の大半は `projects.body` JSON 内に存在する。この併存構造を vNext の最終 persistence 契約として延長しない。

### 判定候補

**FIX候補。** 計画v2.3 / 運用基準v1.4に明示済みで、人間が方針変更しない限りG0-02で固定可能。

---

## D-G0-02-02 Entity ID / project scope / revision

### 契約候補

- first-class Entity は安定 ID、`project_id`、`revision` を持つ。
- display name、色、path文字列、Git SHA単独を primary identity にしない。
- cross-project 参照は server が所属ProjectとPermissionを確認し、明示した共有関係なしには拒否する。
- RepositoryCommitRef は `(repository_id, commit_sha)` を一意キーにする。
- PathEntry は移動しても stable ID を維持する。
- 構造変更のMVP競合基準は Architecture 全体 revision とし、Repository tree / membership / Policy 等は別preconditionで固定する。

### ID形式候補

新規 vNext first-class Entity は **server-generated UUID** を推奨する。理由は、現行Project/Evidence系で `crypto.randomUUID()` が既に使われ、外部自然キーを主キーにしない計画方針と整合するため。

ただし現行 typed Core の文字列IDを自動的にUUIDへ書き換えることはしない。legacy/import ID と vNext primary ID の対応が必要なら compatibility mapping を別に持つ。

### 人間判断

- vNext内部IDを server-generated UUID に統一するか。
- 既存Core文字列IDを互換参照として保持する場合の mapping scope。

---

## D-G0-02-03 Actor / Role / bootstrap

### 契約候補

- Actor は認証済み request context から server が決定する。
- request body の `actor_id`、`HUMAN` 指定、Role 指定を権限根拠として信用しない。
- Project単位で Role / Permission を評価する。
- actor偽装、別Project参照、Evidence越境取得、Role自己昇格を拒否する。
- Approval / Waiver / protected operation は Actor / Role / Permission を通し、AuditLogへ記録する。
- 初期管理者登録は idempotent bootstrap とし、通常APIからの自己昇格では成立させない。

### G0-01実測との対応

現行は Sites dispatch header から identity を得ており、body actorを信用しない点は再利用可能。一方、Actor / Role / ProjectMembership / Policy first-class persistence は未確認。

### 未確定

認証済み実機に接続できなかったため、bootstrapで利用可能な実identity値と実環境の安全な設定経路は未確認。

### 人間判断

- 最初の管理者として登録する認証済み主体。
- bootstrap source を deployment config / protected seed input 等のどこに置くか。

**禁止候補:** 空DBの最初のアクセス者を無条件にadminへ昇格する方式。

---

## D-G0-02-04 Environment / Deployment / immutable target

### 契約候補

- Environment は stable identifier を持つ。
- Deployment は immutable record とし、最低限 Environment、RepositoryCommitRef、artifact digest、config version、DB schema version を固定する。
- 同じ commit を同じ/別Environmentへ再配置しても別Deploymentとして記録する。
- Check / Assurance の対象は `COMMIT` または `DEPLOYMENT` のどちらか一方とし `target_id` 必須。
- COMMIT は RepositoryCommitRef、DEPLOYMENT は immutable Deployment ID を参照する。
- 実Environment変更を観測できない場合、過去Deploymentの保証を現在実機へ自動適用しない。

### G0-01未確認

- 実 Sites deployment identifier
- 実 deployment commit
- artifact digest
- config version
- DB schema version
- Environment identifier

`.openai/hosting.json` の OpenAI project IDを、そのまま immutable Deployment ID とみなさない。

### 人間判断

Sites側から必要なimmutable deployment metadataが取得できない場合、deploy処理時にTSUGU側のDeployment recordを明示確定する運用を採用するか。

---

## D-G0-02-05 ChangeSet 原子性 / precondition / Outbox

### 契約候補

ChangeSet は最低限次を固定する。

- candidate content hash
- idempotency key
- base Architecture revision
- 必要な Repository / membership / Policy 等の preconditions
- 対象Entity一覧
- validation result

Apply時に server は認証・Permission・Approval・参照整合・循環・preconditionを再検証する。

D1内では次を一つの原子的確定単位にする。

1. revision / precondition照合
2. Entity変更
3. ChangeSet applied記録
4. AuditLog
5. 再計算・外部処理を予約するOutbox

競合時は `STALE_CHANGESET` として全変更を拒否し、部分変更を残さない。同じidempotency key + 同じpayloadは同じ結果を返し、同じkey + 異なるpayloadは拒否する。

R2 / GitHubをD1 transactionと同時commitできるとは扱わず、Outbox / state machine / retry / reconciliationで回復する。

### G0-01実測との対応

現行 `projects` save は baseRevision と D1 batch を使用し、stale writeを409で拒否する。思想は再利用できるが、汎用ChangeSet、candidate hash、idempotency、AuditLog、Outboxは未確認。

### 技術確認が必要

計画v2.3が要求する通り、D1で「revision不一致時に後続書込みが残らない」ことを Stage A の integration test で実環境確認する。事前SELECTだけで合格にしない。

---

## D-G0-02-06 RequirementSnapshot / Check / ValidationRecord

### FIX候補

- Check target type は `COMMIT | DEPLOYMENT` のみ。
- commit未存在の設計検証をCheckへ偽装しない。
- 設計案 / ChangeSet の検証は `ValidationRecord` へ保存する。
- RequirementSnapshot は TestRequirement version、BoxDefinition version、Effective Rules、継承経路、評価条件、TestDefinition version を固定する。
- Check は RequirementSnapshot、subject + version、immutable target、command、runner、EvidenceVersion、timestamp、resultを記録する。
- 再テストは新しいCheck。既存FAILを上書きしない。
- Stage A schema から Stage B Entityへの先行FKは持たない。Stage Aでは target / snapshot の契約だけを固定する。

### G0-01実測との対応

現行Checkは `task | decision | pathEntry` をtargetにするため、これはvNext契約とは異なる。既存Core Checkを破壊せず、vNext Checkは別Domain/API/DBで新契約を実装する。

---

## D-G0-02-07 migration / rollback / restore

### 契約候補

- G0/Aで destructive migration を行わない。
- vNext schemaはlegacyと物理分離し、additive migrationから開始する。
- 旧DB / R2原本 / code / settings を保全する。
- writer切替前に隔離環境で backup / restore を実証する。
- rollback時は先にvNext writeを停止し、切替後のvNext DB / R2 / Audit / sync差分を保全する。
- GitHub commit自体を自動rollbackしない。復元環境と外部Git事実を再照合する。
- legacy job / retryが復元後へ書かないようgenerationで拒否する契約をRで持つ。

### G0-02で固定する範囲

G0でR-02の詳細手順や停止時間を決め切らない。少なくとも「復旧手段が存在し、切替前に実証するまでwriter切替を許可しない」というGateを固定する。

### 未確認

現行 Sites / D1 / R2 の実backup・restore操作経路と権限は認証済み環境に接続できず未確認。

### 人間判断（R-02へ送る）

- 復旧責任者
- 保持期間
- 許容停止条件
- 切替/rollback承認者

---

## D-G0-02-08 Stage依存と着手Gate

### 契約候補

- G0-02合格前にA-01のwriter/schema実装へ進めない。
- Aは認証/権限、Project/Node/Repository/Environment/Deployment/ChangeSet/Sync/Bootstrapの基盤。
- BはBox/Rule/RequirementSnapshot/Task/Approval/Check/Evidence/Assurance/Event。
- A schemaからB Entityへの先行依存を持たない。
- Bの安全性を確立する前にCの影響範囲最適化へ進めない。
- CutoverはRのbackup/restore・全writer確認後。

## 9. G0-02 技術的に先へ進める項目

認証済み実機が未確認でも、次は契約として整理・レビューできる。

- Core/legacy物理境界
- Entity scope / revision原則
- COMMIT / DEPLOYMENT target contract
- ChangeSet / Outbox原則
- RequirementSnapshot / ValidationRecord / Check境界
- additive migration / rollback Gate
- Stage A/B境界

## 10. G0-02 完了を止める未確認/人間判断

次は未確認または人間Decisionなしに確定扱いにしない。

- 初期adminの実identityとbootstrap入力経路
- 実Environment identifier
- 実Deployment metadata取得経路
- 実D1 schema/migrationの現在値
- 実R2 bucket/readback
- 実backup/restore経路
- UUID統一とlegacy ID mapping方針の最終選択

## 11. 推奨G0-02完了条件

1. 上記D-G0-02-01〜08をDecisionとして採用/修正/保留に分類する。
2. 人間判断項目に明示Decision IDまたはIssueを付ける。
3. 認証済み環境で未確認の項目は未確認のまま残し、架空のEnvironment/Deployment値を登録しない。
4. A-01の初回変更対象pathと受入testを確定する。
5. G0-02のDecision結果をTSUGU本体へ反映してからA-01を開始する。
