# G0-02 契約レビュー結果

- 日付: 2026-09-10
- 対象: TSUGU Core vNext 修正版計画 v2.3
- 入力: `G0-02-decision-candidates-2026-09-10.md` の8候補、G0-01実測、`D-G0-02-09` 旧案件データ非保護Decision
- 状態: **技術レビュー完了。人間入力が必要な項目は明示して未確定のまま。A-01実装準備可。**

この文書は既存8候補を削除せず再評価する。旧文書の「旧26/27件復旧・legacy ID mapping・physical provenanceが揃うまでG0-02全体を止める」という読み方は、`D-G0-02-09` 後は本レビューで置き換える。

## 結果一覧

| Decision候補 | 判定 | G0-02で固定する内容 | 後段へ残すもの |
|---|---|---|---|
| D-G0-02-01 Core/legacy境界 | **TECH-ADOPT** | vNext Domain/API/DB/Testをlegacyから物理分離。`app/model.ts`をvNext Domainから直接importしない。legacy itemsへ新機能を足さない | writer切替/legacy整理はR Gate |
| D-G0-02-02 ID/scope/revision | **TECH-ADOPT + 修正** | stable opaque ID、`project_id`、revision、server-side scope検証。新規vNext IDはserver-generated UUIDを技術defaultとする | 旧案件救済目的のlegacy ID mappingは不要。外部import互換が将来必要なら別Decision |
| D-G0-02-03 Actor/Role/bootstrap | **TECH-ADOPT / HUMAN-PENDING一部** | Actorは認証済みrequest contextのみ。body actor/Roleを信用しない。Project-scoped Permission、self-elevation拒否、Audit、idempotent bootstrap | 本番初期adminの認証principal値と、保護されたbootstrap設定の実carrier |
| D-G0-02-04 Environment/Deployment | **TECH-ADOPT** | immutable Environment/Deployment model、COMMIT/DEPLOYMENT target、provider metadataとphysical resourceを区別 | Environment/physical D1/R2 IDのlive取得はA-02/integration Gate |
| D-G0-02-05 ChangeSet/Outbox | **TECH-ADOPT** | candidate hash、idempotency、base revision/precondition、原子的D1 apply+Audit+Outbox、STALE_CHANGESET | 実D1でtransaction/rollback挙動をStage A integration test |
| D-G0-02-06 RequirementSnapshot/Check | **TECH-ADOPT** | CheckはCOMMIT/DEPLOYMENTのみ。design validationはValidationRecord。RequirementSnapshot固定。FAIL上書き禁止 | Stage Bで具体schema/API |
| D-G0-02-07 migration/rollback/restore | **REVISE-ADOPT** | G0/A destructive migration禁止。新vNextデータのbackup/restore・cutover safetyは維持 | **現在の旧案件26/27件の復元・保存・owner移行はGateから除外**。本番全DB/R2削除は未承認 |
| D-G0-02-08 Stage/Gate | **REVISE-ADOPT** | A/B/C/R依存は維持。A-01 source-level実装は旧案件復旧やphysical provenanceを待たない | live binding/Deployment/D1/R2は該当Stage integration/cutover Gate |

## 1. Core/legacy境界

計画v2.3の「新Coreを旧itemsの延長にしない」を採用する。既存 `app/model.ts` / `app/core-model.ts` は現行実装の参照資料・compatibility sourceとして扱えるが、vNext first-class persistenceの正本にしない。

A-01では新規 `app/vnext/**` と `db/vnext/**` を境界とし、legacy modelを直接importするコードをstatic testで拒否する。

## 2. ID / project scope / revision

計画が要求するstable ID / `project_id` / revisionを採用する。ID形式は業務Decisionではなく実装詳細として、既存コードでも使用している `crypto.randomUUID()` に合わせ **server-generated UUID** をdefaultにする。

旧案件が非保護になったため、既存Core文字列IDを26/27件救済のためにmappingする要件は削除する。ただし、これにより新規データのcross-project参照検証やstable ID要件を弱めない。

## 3. Actor / Role / Bootstrap

採用:

- 認証principalはserverがSites dispatch headerから取得する。
- request bodyのactor/Role/HUMAN指定は権限根拠にしない。
- vNext writeはcanonical ActorとProjectMembership/Policyで認可する。
- 別Projectアクセス、actor偽装、Role自己昇格をfail closedする。
- protected operationはAuditLogへappendする。
- bootstrapはidempotentで、通常APIの「最初に来たユーザー」をadminにしない。

技術推奨は、stable authenticated subject IDをserver-onlyのbootstrap allowlist/configと照合する方式。メールhashはlegacy owner互換には使えても、vNext admin identityの第一キーにはしない。

### HUMAN-PENDING

本番bootstrap前に次だけは人間入力が必要。

1. 最初の本番adminにする認証済みprincipal/subject。
2. Sitesでそのallowlistを保持できる保護されたserver-side config carrier。request body/client storageは不可。

この値が未決でも、A-01コードは `BootstrapConfig` interfaceを注入可能にして実装・unit testできる。本番bootstrap実行済みとは扱わない。

## 4. Environment / Deployment

v21/v22の `provider_deployment_id` / `env_set_revision` が一致してもphysical D1/R2同一とは扱わないというG0-01境界をそのまま採用する。

vNext Deployment recordは、入手できたprovider deployment ID、Environment、RepositoryCommitRef、artifact digest、config version、DB schema version等を分離して保持する。未取得値はunknownのまま。

physical resource ID未取得はA-01を止めず、A-02およびlive integrationのGateへ送る。

## 5. ChangeSet

候補を採用する。D1 transaction内に revision/precondition再確認、entity mutations、ChangeSet applied、AuditLog、Outbox enqueueを置き、外部GitHub/R2 actionはOutbox/reconciliationへ分離する。

事前SELECTだけで原子性を証明したことにしない。Stage Aで実D1または正式なD1 integration環境により、stale時に後続writeが残らないことを検証する。

## 6. RequirementSnapshot / Check

候補を採用する。Check targetは `COMMIT | DEPLOYMENT`。未commit設計案/ChangeSetの検査はValidationRecord。既存FAILはimmutable historyとして残し、retestは新Checkにする。

旧案件を捨てる方針でも、FAIL履歴の新規vNext仕様は維持する。

## 7. migration / rollback / restore の修正

`D-G0-02-09` により、**現在のlegacy案件datasetの復元、旧D1探索、旧owner救済、旧案件用R2原本保全をG0-02/A-01の前提にしない。**

ただし次は維持する。

- G0/Aではdestructive migrationをしない。
- vNext schemaはadditive・分離から開始する。
- vNextで新しく作られるデータはbackup/restore検証なしにwriter cutoverしない。
- GitHub historyを自動rewind/rewriteしない。
- D1/R2の無差別削除は今回のDecisionに含まれない。

## 8. Stage Gateの修正

G0-02の技術レビューは、Environment/physical D1/R2のlive値が取れなくても進める。A-01のsource-level設計・実装準備も進める。

一方、以下は該当Stageまでに必須。

- A-02/live integration: Environment/Deployment/physical resourceの取得・照合方法
- A-04: D1 transaction/atomic applyのintegration evidence
- Evidence/Stage B: R2 readback、size/SHA、project scope
- R/cutover: 新vNextデータのbackup/restore、writer一覧、rollback条件

## 現時点の本質的な人間判断

G0-02レビュー後に残る即時の人間入力は、主として本番bootstrapに関する2点である。その他のphysical resource未確認は「人間の設計判断」ではなくlive evidence不足として後段Gateへ送る。

推奨:

- admin principal: providerのstable authenticated user/subject ID
- bootstrap config: clientから書換えできないserver-only allowlist/config

実値・carrierがまだ確認できないため、決定済みとは記載しない。

## G0-02からA-01への状態

- 8候補の技術レビュー: **完了**
- 旧データ非保護Decision: **決定済み**
- Git内旧案件payload削除: **対象なし**
- A-01対象/受入test定義: `A-01-implementation-plan-2026-09-10.md`
- G0-02の全項目を人間承認済みとする処理: **未実施**
- TSUGU本体へのDecision/Task登録: **未実施**

source-levelのA-01準備は開始可能。hosting変更、production writer切替、rebind/redeployは引き続き別Gateとする。