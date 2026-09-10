# G0-01 physical provenance 診断・characterization 実行記録

- 対象: TSUGU Core vNext 修正版計画 v2.3 / G0-01
- 日付: 2026-09-10
- branch: `vnext-g0-20260910`
- 性質: 読み取り専用診断＋隔離fixture characterization
- 状態: **原因未確定。G0-02承認/A-01は保留。**

## 1. 正規実機読取経路

この作業チャットで利用可能な認可済みブラウザ経路を1回確認したが、`Browser not connected` で接続できなかった。指示どおり再試行ループや別経路への迂回は行っていない。

そのため次は未取得のまま。

- v21 Deployment ID / source identifier
- v21/v22 Environment identifier
- v21/v22 physical D1 ID
- v21/v22 physical R2 ID
- v21/v22 applied migration record
- v21 D1 table counts / owner distribution
- v21/v22 direct R2 existence / size / SHA readback
- v22 signed-in `/api/projects` response原文

必要な最小権限はread-onlyに限定する。

- authenticated Sites version/deployment history read
- Environment / physical D1/R2 binding metadata read
- D1 SELECT / read-only PRAGMA
- R2 object metadata/read

rebind、deploy、migration、D1/R2 write/delete権限は不要。

## 2. 今回追加した診断成果物

- `docs/vnext/G0-01-readonly-diagnostics.sql`
  - SELECTとread-only PRAGMAのみ
  - schema/table/index、table件数、owner lineage件数、orphan、cross-table owner mismatch、Evidence R2照合入力を取得
  - complete owner値を公開出力しない
- `docs/vnext/G0-01-v21-v22-physical-comparison.md`
  - v21/v22比較表
  - 取得元、期待出力、判定規則、未取得欄を明示
  - logical `DB` / `BUCKET` とphysical resource IDを分離
  - R2存在/size/SHA照合手順を定義
- `docs/vnext/G0-01-nondestructive-recovery-matrix.md`
  - 同一DB / 別DB / 旧DB未発見 / ownerのみ不一致の4ケース
  - 必要証拠、backup前提、人間判断、可逆候補、禁止操作を整理
- `tests/g0-runtime-characterization.test.mjs`
  - in-memory SQLite + mock R2のみ
  - 本番D1/API/R2を呼ばない
  - desired vNext specificationではなくcurrent behavior characterizationと明記
- `.github/workflows/g0-head-diagnostics.yml`
  - base固定の既存 `G0 verification` と分離
  - PR head SHAを明示checkoutしてtarget/actual一致を検査
  - targeted characterization、`npm test`、typecheckを実行

## 3. characterizationで固定した現行挙動

### C1 owner互換キー

認証emailがある場合、ownerはlowercase emailのSHA-256を `email:<hex>` とした値。query compatibility keysは `[email owner, authenticated user id]`。

隔離fixtureでemail-owner行と旧user-id-owner行の両方が一覧取得され、無関係owner行は取得されないことを再現した。

**これは現行互換挙動のcharacterizationであり、vNextのActor/Role仕様承認ではない。**

### C2 orphan Evidence readback

親Projectが存在しないfixtureで、Evidence metadataとR2 objectが存在していても `readEvidenceVersion()` は `案件が見つかりません` で拒否し、R2 `get` は0回だった。

従って本番孤児Evidenceに対する現行API拒否は、R2 object不存在を証明しない。

### C3 Project DELETE後のEvidence残存

隔離fixtureで現行 `DELETE /api/projects` を実行すると、Projectとrevisionは消える一方、次は残存した。

- `evidences`: 1
- `evidence_versions`: 1
- `evidence_uploads`: 1
- mock R2 Evidence object: exists

**これは現行欠陥を再現したcharacterizationであり、正しい削除仕様として承認しない。**

## 4. head検査 — 初回無効run

Target SHA: `81b5bdbc13ecbd21b86a0c68efa94eec17fe4d7d`

Workflow: `G0 head diagnostics` run #1 / Run ID `34477094634`

初回追加testのfixture objectにJavaScript構文エラーがあり、characterization自体を実行できなかった。

| コマンド | exit | 結果 |
|---|---:|---|
| target SHA一致確認 | 0 | PASS |
| `npm ci` | 0 | PASS |
| `node --test tests/g0-runtime-characterization.test.mjs` | 1 | **INVALID / test構文エラー** |
| `npm test` | 1 | 既存71 PASS、新規test file 1 FAIL。診断結果として不採用 |
| `npx tsc --noEmit --incremental false` | 0 | PASS |

Artifact ID: `10151969518`

Artifact digest: `sha256:83dfe4ca86bd47f88ac86aea9f806fa9e71cfefa7dfa0cd19a304f66b0d15d97`

このFAILをアプリ不具合の証拠として扱わない。testのみ修正し、アプリ本体は変更していない。

## 5. head検査 — 修正後の有効run

Target SHA: `f72e6cadf7f1e2e1c36de452b7065f44336b957e`

Workflow: `G0 head diagnostics` run #2 / Run ID `34477286765`

Runner:

- Node `v22.23.2`
- npm `10.9.8`
- recorded target SHA: `f72e6cadf7f1e2e1c36de452b7065f44336b957e`
- actual checkout SHA: `f72e6cadf7f1e2e1c36de452b7065f44336b957e`

| コマンド | exit | 結果 |
|---|---:|---|
| target SHA一致確認 | 0 | PASS |
| `npm ci` | 0 | PASS |
| `node --test tests/g0-runtime-characterization.test.mjs` | 0 | **3/3 PASS** |
| `npm test` | 0 | **build PASS + 74/74 tests PASS** |
| `npx tsc --noEmit --incremental false` | 0 | PASS |

Characterization集計:

```text
# tests 3
# pass 3
# fail 0
```

Full test集計:

```text
# tests 74
# pass 74
# fail 0
```

Artifact ID: `10152057173`

Artifact digest: `sha256:1443c30f21fae8546961ed97f607c77b6e6e7c26b23446197239d46bd91fc072`

## 6. base固定CIとの区別

既存 `.github/workflows/g0-verify.yml` はG0開始SHA `ad3534750e03345b38a01416e012b9f4dde06701` を明示checkoutする基準検査であり、PR headの検査ではない。

今回追加した `G0 head diagnostics` はPR head SHAを明示checkoutし、headに追加したdocs/test/workflowを含む状態を検査する。両者の結果を混同しない。

## 7. 実機側の現時点の証拠

監督側実測として既に記録済みのv22事実は維持する。

- Sites version 22
- source identifier `de808756e8396b612ee992f83be3df61176f4dda`
- Deployment `appgdep_6aa20602a9c8819192425635a3c76520`
- signed-in UI: projects 0件
- D1 logical binding: `DB`
- `projects`: 1行
- `revisions`: 1行
- `evidences`: 1行
- `evidence_versions`: 2行
- Evidence project_idに対応するProject行なし
- owner lineageは現在認証主体を含め少なくとも3系統

complete owner値はこの公開資料に記録しない。

## 8. 原因判定

新しいphysical provenance証拠は取得できていないため、原因は確定しない。

現在の優先度は維持する。

1. physical D1 binding / Environment divergence — 最優先、未確定
2. owner fragmentation — 存在確認済み、ただし過去26/27 row不在を単独では説明しない
3. parent Project disappearance後のEvidence残存 — characterizationで現行コード上再現、今回の実原因は未確定
4. destructive migration — 現行0000..0005 sourceからは支持されない
5. R2 divergence/object loss — 未確認

## 9. 安全・Gate

今回、次は行っていない。

- production data write
- new project creation
- migration
- owner rewrite
- D1/R2 delete
- physical rebind
- redeploy
- hosting change
- writer switch
- G0-02承認
- A-01着手
- TSUGU Task/Check/Evidence登録

既存Evidence、stable ID、FAIL履歴を変更していない。

## 10. 次に監督側から必要な最小入力

次のread-only結果だけでよい。完全owner値や認証秘密は不要。

1. v21: Deployment ID、source identifier、Environment identifier
2. v21/v22: physical D1 resource IDの一致/不一致
3. v21/v22: physical R2 resource IDの一致/不一致
4. `G0-01-readonly-diagnostics.sql` の件数・orphan・owner lineage集計結果（owner完全値は除外）
5. v21側 `projects` count と、過去26/27案件相当が存在するか
6. 対象Evidence R2 objectの `EXISTS/NOT_FOUND`、actual size、SHA一致/不一致/未確認

これらが揃うまでrebind/owner変更/migration/redeployは行わない。

## 11. 監督追補 — v21/v22 deployment control-plane 確定情報

2026-09-10、監督側の正規な読取経路で次が追加確認された。本節は、上記「v21 Deployment ID / source identifier 未取得」という旧記述をこの2項目について更新する。physical resource未確認の扱いは変更しない。

### v21

- Sites version: `21`
- source identifier: `a61060a798454fc457bce4afc05d24202f8c656e`
- Deployment ID: `appgdep_6aa122d6d9f481919bb334743dfad300`
- status: `succeeded`
- updated: `2026-09-09T09:12:44.881187Z`
- provider_deployment_id: `site---6a9d191e8fd48191ac8b14311ccfa935`
- env_set_revision: `0`

### v22

- Sites version: `22`
- source identifier: `de808756e8396b612ee992f83be3df61176f4dda`
- Deployment ID: `appgdep_6aa20602a9c8819192425635a3c76520`
- status: `succeeded`
- updated: `2026-09-10T01:22:01.373021Z`
- provider_deployment_id: `site---6a9d191e8fd48191ac8b14311ccfa935`
- env_set_revision: `0`

Sites environment variables は監督読取で revision `0`、entries empty と確認された。

### この一致から結論してよいこと / いけないこと

`provider_deployment_id` が同一、`env_set_revision` が両方0、environment variablesもrevision 0 / entries emptyであることは、同一provider-side site familyおよび同じenvironment-set metadataを使っている観測として記録する。

ただし、これらのmetadataにはphysical D1 database ID、physical R2 bucket ID、logical bindingからphysical resourceへの解決先、Environment identifierが含まれていない。従って **v21/v22が同じphysical D1/R2を使うとは結論しない**。

特にenvironment variable entriesが空であることはD1/R2 bindingsが空、同一、または不存在であることの証拠ではない。resource binding metadataとは別に取得する必要がある。

### 追補後も UNVERIFIED の項目

- v21/v22 Environment identifier
- v21/v22 physical D1 resource ID
- v21/v22 physical R2 resource ID
- v21/v22 applied migration record / migration journal
- v21 D1 table counts / owner distribution / historic 26/27 project inventory
- direct R2 object existence / actual size / SHA readback
- v22 signed-in `/api/projects` response原文

### 阻害と必要な最小権限 / 画面

この作業チャットの認可済みブラウザ経路は `Browser not connected` のため追加取得不能。再試行・迂回は行わない。

残項目を埋めるには、Sitesのversion/deployment詳細画面または同等のread-only管理APIで、**Environment identifierとD1/R2 bindingのphysical resource identifierを表示できる権限**が必要。加えて、対象physical D1へのSELECT/read-only PRAGMA権限と、対象physical R2へのobject metadata/read権限が必要である。write、rebind、deploy、migration、delete権限は不要。

次に監督側から必要な入力は、上記で新たに確定したv21 deployment/sourceを除き、physical D1/R2 IDの一致/不一致、v21 inventory、R2 EXISTS/size/SHA、Environment identifierのみでよい。
