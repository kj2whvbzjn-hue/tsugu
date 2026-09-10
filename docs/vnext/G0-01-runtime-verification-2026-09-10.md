# TSUGU Core vNext G0-01 実行・実機検証記録

- 検証日: 2026-09-10
- 対象計画: TSUGU Core vNext 修正版計画 v2.3
- Task: G0-01 現状調査
- Repository: `kj2whvbzjn-hue/tsugu`
- 基準 branch: `main`
- G0 開始 SHA: `ad3534750e03345b38a01416e012b9f4dde06701`
- 作業 branch: `vnext-g0-20260910`
- Draft PR: `#1 G0-01: record current-state survey and verification`
- 状態: **進行中。GitHub/CI基準検証は完了。公開版22の実D1可視性異常を診断中。G0-02契約確定/A-01着手は保留。**

この記録は `G0-01-current-state-2026-09-10.md` の静的調査をやり直さず、未確認だった実行系・実機系だけを追加検証した結果である。2026-09-10の監督側による認証済みSites/D1実測を追補し、GitHubコードと照合した。

## 1. Deployment / source 対応

### 1.1 公開 Sites 版22

監督側の認証済み実機確認で次を確認済みとして扱う。

- Sites version: `22`
- Sites source/commit identifier: `de808756e8396b612ee992f83be3df61176f4dda`
- Deployment: `appgdep_6aa20602a9c8819192425635a3c76520`
- 公開URL: `https://continuity-workbench.pzs4d5yv7g.chatgpt.site/`

重要: `de808756...` は repository `kj2whvbzjn-hue/tsugu` の Git commit ではない。GitHub APIで同SHAのcommitは解決できなかった。

GitHub `main` の `ad3534750e03345b38a01416e012b9f4dde06701` は、`tsugu-source-v22-de808756(1).zip` を検証して172ファイルを取り込んだ commit であり、commit message は `Import TSUGU source v22 de808756`。import workflow が記録したZIP SHA-256は次。

```text
895a2e25d8dc1b7c71015f855f649e5fec1b375133c79984f1e9fb4c506ffa6c
```

従って今後は次を別IDとして扱う。

- Sites側 version/source identifier: `22 / de808756...`
- Sites Deployment ID: `appgdep_6aa20602a9c8819192425635a3c76520`
- GitHub import baseline: `ad353475...`

両者を「同一commit SHA」とは呼ばない。

### 1.2 旧 Sites 版21

**未確認。**

旧版21の immutable deployment identifier / source commit / physical D1 / physical R2 は、現在この作業チャットから認証済みSites version historyへアクセスできないため取得できていない。GitHub repositoryにもv21 sourceを直接表すcommitは存在しない。

過去に26/27件の案件が可視だったという運用観測は重要な復旧手掛かりだが、v21のDeployment・bindingを推測で補完しない。

次の読み取り専用照合で取得する。

- version 21 の Deployment ID
- source/commit identifier
- Environment identifier
- physical D1 identifier
- physical R2 identifier
- applied migration/schema state
- `projects` / `revisions` 件数と owner 分布

## 2. 公開版22の認証済みUI / D1 実測

監督側の認証済み実機およびSites D1読取確認による事実。

### UI

- 認証済みUIで再読込しても案件一覧は **0件**。

UI実装は起動時に `GET /api/projects` を呼び、返却された配列をそのまま案件一覧へ設定する。クライアント側に追加ownerフィルタはない。

### D1 binding

- logical binding: `DB`

### D1 table inventory

| table | 実測 | owner / project 状況 |
|---|---:|---|
| `projects` | 1行 | `かんたん検索`。owner prefix `email:04b442...` |
| `revisions` | 1行 | 上記案件と同系統 |
| `evidences` | 1行 | owner prefix `email:167749...`、project_id `73f74cc8-...` |
| `evidence_versions` | 2行 | 上記Evidence系統 |

`evidences.project_id = 73f74cc8-...` に対応する `projects.id` 行は、監督側が読んだ現在のD1には存在しない。

さらに現在の認証主体から導出される owner は上記2つと異なるため、少なくとも次の3系統が分断している。

1. 現在の認証主体から導出される owner
2. `projects` の `email:04b442...`
3. Evidence系の `email:167749...`

ownerの完全値や元メールアドレスは診断文書へ追加しない。

### 判定

「案件0」は単なるUI表示不具合としては扱えない。現在bindingされているD1自体の `projects` 総数が1行しかなく、過去に見えていた26/27件を現在D1内のownerフィルタだけで再表示することはできない。

データ削除とは断定しない。**D1 physical binding差替え / Environment分離 / owner正規化・照合不整合 / 親Project消失後のEvidence残存** を分離して診断する。

## 3. owner変換と案件一覧条件のコード追跡

### 3.1 認証主体 → owner

`app/identity.ts` は Sites dispatch の次のheaderだけを使う。

```text
oai-authenticated-user-id
oai-authenticated-user-email
```

処理は次。

1. user id をtrim
2. emailをtrim + lowercase
3. emailがあれば SHA-256
4. `email:<64 hex>` を owner候補にする
5. emailがなければ user id を ownerにする
6. query用の `keys` は `[owner, id || owner]`

従って現行コードで1リクエストが参照できるownerは最大2系統であり、emailがある場合は原則 `email hash + authenticated user id`。

READMEにも、Sitesの認証済みメールからハッシュownerを生成し、旧user-id-owned rowは両headerが併存するとき互換参照する設計が記録されている。

### 3.2 案件一覧

`GET /api/projects` の一覧SQLは次の条件。

```sql
SELECT body,revision,updated_at
FROM projects
WHERE owner IN (?,?)
ORDER BY updated_at DESC
```

bind値は `identity.keys`。

UI `Workspace.load()` は `/api/projects` を呼び、その結果を直接 `records` に設定する。

### 3.3 owner不一致で説明できる範囲

owner不一致は、現在D1に存在する `かんたん検索` 1件が現在ユーザーに見えないことは説明できる。

しかし監督実測では `projects` table全体が1行しかないため、owner不一致だけでは過去26/27件が現在D1から消えている事実を説明できない。

従って owner fragmentation は **確認済みの問題だが、過去案件の所在不明に対する単独主因ではない**。

## 4. Evidence owner / project 照合と孤児参照

### 4.1 現行Evidence登録は親Projectを要求する

`registerEvidence()` は登録開始前に次を確認する。

```sql
SELECT id
FROM projects
WHERE id=? AND owner IN (?,?)
```

親Projectを確認できなければ404で登録を拒否する。

従って現在観測された孤児Evidenceは、**現行の通常登録経路で、最初から親Projectなしの状態として新規作成された**とは考えにくい。

### 4.2 schemaにFKがない

`0005_evidence_core.sql` / `db/schema.ts` の Evidence 3表は `project_id` を保持するが、`projects(id)` への foreign key / cascade は定義していない。

そのためDBレベルでは親Project消失後もEvidence行を保持できる。

### 4.3 Project DELETE はEvidenceを削除しない

現行 `DELETE /api/projects` は次を処理する。

- `original_files`
- `revisions`
- `projects`
- `proposals`
- snapshot/original用 `deletion_jobs`

一方、次は削除対象に含まれていない。

- `evidences`
- `evidence_versions`
- `evidence_uploads`
- Evidence R2 object

したがって現行コードには、**Project削除後にEvidence metadata / R2 objectを孤児として残せる構造上の欠陥**がある。

これは今回の孤児Evidenceが実際にDELETEで発生した証拠ではない。削除ログ・Auditがないため、原因を「削除」と断定しない。

### 4.4 Evidence readback の現在条件

`readEvidenceVersion()` も最初に `ownedProject()` を確認してから `evidence_versions` とR2を読む。

したがって現在の孤児 `project_id=73f74cc8-...` は、対応Projectがない限り現行アプリAPIではR2 readbackへ到達できない。APIで404になる場合でも、それだけではR2 objectが存在しない証拠にはならない。

R2原本の存在確認は physical `BUCKET` を読み取り専用で直接確認する必要がある。

## 5. D1 / R2 binding とmigrationのコード追跡

### 5.1 sourceが固定するもの

`.openai/hosting.json` は次だけを宣言する。

```json
{
  "d1": "DB",
  "r2": "BUCKET",
  "project_id": "appgprj_6a9d191e8fd48191ac8b14311ccfa935"
}
```

`db/store.ts` / `db/index.ts` / Cloudflare Env型も logical name `DB` と `BUCKET` を参照する。

### 5.2 sourceが固定していないもの

repository内のhosting設定には、次のphysical resource identifierは記録されていない。

- D1 database UUID / physical database identifier
- R2 physical bucket identifier
- Deployment固有Environment identifier

従ってGitHub sourceだけでは、「版21と版22が同じ `DB` / `BUCKET` というlogical nameを使う」ことと「同じphysical D1/R2を指す」ことは同義にならない。

### 5.3 build artifact

`build/sites-vite-plugin.ts` はbuild後に次を `dist/.openai` へコピーする。

- `.openai/hosting.json`
- `drizzle/` migration一式

つまりdeployment artifactはlogical binding宣言とmigration filesを持つが、source上はphysical D1/R2 IDを固定していない。

### 5.4 migrations 0000〜0005

確認したmigrationは全てadditive。

- `0000`: `projects`, `revisions`
- `0001`: `original_files`
- `0002`: `deletion_jobs`
- `0003`: `revisions.snapshot_object_key` 追加
- `0004`: `proposals`
- `0005`: `evidences`, `evidence_versions`, `evidence_uploads`

`0000`〜`0005` に `DROP projects`、既存 `projects` 全削除、owner一括書換えはない。

現在D1にEvidence tablesが存在することは、少なくとも `0005` 相当のschemaが存在することを示す。ただしSites側のmigration journal / applied version番号そのものは未取得。

### 判定

「0005 migrationそのものが26/27件を削除した」という仮説は、現行migration sourceからは支持されない。

一方、**別physical D1へbindingされた状態で0000〜0005が適用された**なら、現在のようにschemaは揃っているが過去案件がない状態は成立する。このためD1 binding / Environment差異を最優先で照合する。

## 6. 原因候補の優先順位

### P1: physical D1 binding差替え / Environment分離

**優先度: 最優先。強く疑うが未確定。**

根拠:

- 現在D1の `projects` 総数が1行しかない。
- 過去26/27件はownerフィルタ以前に現在D1内で確認できない。
- sourceはlogical `DB` しか固定せずphysical D1 IDを持たない。
- migrationsは既存projectsを削除する内容ではない。
- 別D1に同じmigrationを適用すればschemaだけ同じfresh/alternate DBが成立する。

確定に必要:

- Sites v21 / v22 deploymentごとのphysical D1 identifier照合
- v21 D1のread-only inventory

### P2: owner正規化 / 認証主体照合の分断

**優先度: 高。問題の存在自体は確認済み。**

根拠:

- current auth、projects、Evidenceで少なくとも3 owner系統。
- 現行一覧は最大2 owner keyしか参照しない。
- `projects` 1件がcurrent UIに出ない現象を説明できる。

限界:

- 現在D1から過去26/27件の行自体が見つからないことは説明できない。

### P3: 親Project消失後のEvidence残存

**優先度: 中。コード上可能、発生経路は未確定。**

根拠:

- Evidence schemaにProject FKなし。
- Project DELETEがEvidence 3表 / Evidence R2を削除しない。
- current D1に実際に孤児Evidenceが存在。

未確認:

- 実際にProject DELETEが実行された証拠
- orphan projectが以前current D1に存在したか
- 別DBからmetadataだけ混在したか

### P4: destructive migration

**優先度: 低。現行sourceでは支持されない。**

0000〜0005はadditiveであり、projects削除処理はない。

### P5: R2 binding差替え / R2 object欠落

**優先度: 未判定。**

physical `BUCKET` をまだ読取確認できていない。孤児Projectのため現行API経由のreadbackもR2到達前に停止する。

## 7. 非破壊・可逆の復旧診断案

以下は復旧のための**提案**であり、このG0作業では実行しない。

### Phase A: provenanceをread-onlyで固定

Sites version 21 / 22について次を同じ表に記録する。

- version
- deployment ID
- source/commit identifier
- Environment identifier
- physical D1 identifier
- physical R2 identifier
- config version
- migration/schema version

各D1でread-only inventoryを取得する。

- table一覧
- row count
- `projects`: id / owner prefix / name / revision
- `revisions`: project_id / owner prefix / revision count
- `original_files`: project_id / owner prefix / object_key存在数
- `proposals`: project_id / owner prefix / count
- Evidence 3表: project_id / owner prefix / version / object_key / storage_state
- orphan project_id一覧
- owner分布

### Phase B: 過去26/27件の所在を探す

新規案件を作らず、Sites version/deployment historyに紐づく既存D1をread-onlyで照合し、過去案件群を持つphysical D1を特定する。

見つかった場合、即rebind・copy・owner書換えをしない。まずD1 export/backupとR2 inventoryを取得する。

### Phase C: R2整合性

対象D1の `original_files.snapshot_object_key` / `evidence_versions.object_key` をphysical R2でread-only確認する。

Evidenceは次を確認する。

- object存在
- byte size
- D1保存SHA-256との一致
- current_version_idとversion番号

production metadataは変更しない。

### Phase D: owner identity比較

認証済みrequestのheader値を露出・保存せず、同じlowercase/trim/SHA-256規則でowner keyだけを算出して比較する。

候補:

- current email-derived owner
- current authenticated user id
- old D1 owner
- v21/v22でdispatch identity形式が変わったか

同じphysical D1にデータが揃っておりownerだけ不一致なら、ownerの一括上書きより先に **reversible owner-alias / compatibility mapping** を復旧設計候補とする。

### Phase E: 復旧方式の選択

復旧案はデータ所在確認後に人間判断する。

候補例:

1. 正しい既存D1/R2へdeployment bindingを戻す。
2. 旧D1/R2を読み取り専用sourceとして、隔離環境へ完全cloneして検証後に移行する。
3. physical resourceは正しいがownerだけ分断なら、互換aliasで読み取り可能にしてから恒久Actor/Role設計へ移す。

いずれも production writer切替・rebind・owner rewrite・migration実行はG0-01では禁止。

## 8. 開始 SHA 固定の build / test

### 実行方法

G0 作業 branch に検証専用 GitHub Actions workflow `.github/workflows/g0-verify.yml` を追加した。アプリケーションコード、DB、hosting、writer は変更していない。

workflowは `ad3534750e03345b38a01416e012b9f4dde06701` を明示checkoutし、`git rev-parse HEAD` と一致を検証した。

### GitHub Actions 証拠

- Workflow: `G0 verification`
- 基準 Run ID: `34451896145`
- Run number: `5`
- Job ID: `102789287032`
- Job conclusion: `success`
- Runner OS: Ubuntu 24.04.4 LTS / image `ubuntu-24.04`
- Node: `v22.19.0`
- npm: `10.9.3`
- expected commit: `ad3534750e03345b38a01416e012b9f4dde06701`
- actual checkout commit: `ad3534750e03345b38a01416e012b9f4dde06701`

| 区分 | コマンド | 終了コード | 結果 |
|---|---|---:|---|
| dependency install | `npm ci` | 0 | PASS。677 packages |
| build | `npm run build` | 0 | PASS |
| full tests | `node --test tests/*.test.mjs` | 0 | PASS。71/71 |
| typecheck | `npx tsc --noEmit --incremental false` | 0 | PASS |

Test集計:

```text
# tests 71
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Evidence artifact

- Artifact ID: `10141894160`
- Artifact digest: `sha256:a51929800f46e34c32f7a2bb12e048d5128a7c4fa724334026d4bc93c472b9d3`
- Size: 5,584 bytes
- Expiry: `2026-12-09T07:49:19Z`

artifact内に `environment.txt`, install/build/tests/typecheck log と各exitcodeを保存。4 exitcodeは全て0。

監督側はPR head更新後の Actions run #9 (`34452239309`) success も独立確認済み。

## 9. 現時点の確認済み / 未確認

### 確認済み

- GitHub `main` 開始SHA `ad353475...`
- branch / Draft PR #1
- 開始SHAでbuild/test/typecheck PASS
- Sites版22: source identifier `de808756...`
- Sites版22 Deployment `appgdep_6aa20602a9c8819192425635a3c76520`
- GitHub `ad353475...` がversion22 source ZIPのimport commitである対応関係
- 認証済みUI: 案件0件
- 現在D1 binding logical name `DB`
- 現在D1の主要table件数
- projects / Evidence / current auth のowner分断
- Evidence orphan project_idの存在
- 現行sourceのowner query条件
- Evidence登録前Project存在確認
- Evidence schemaにProject FKがないこと
- Project DELETEがEvidenceを削除しないこと
- hosting sourceがphysical D1/R2 IDを固定しないこと
- migration 0000〜0005がadditiveであること

### 未確認

- Sites版21のDeployment/version/source identifier詳細
- version21 / version22のphysical D1 identifier比較
- version21 / version22のphysical R2 identifier比較
- Sites migration journal / applied migration record
- 過去26/27件の所在
- physical R2上の孤児Evidence object存在 / SHA readback
- current authenticated `/api/projects` response bodyの保存証拠
- current authenticated orphan Evidence APIの実レスポンス
- backup / restore権限と実操作経路
- owner分断がdispatch identity変更、email alias変更、別主体ログインのどれによるか
- Project deletionが実際に起きたか

## 10. G0-01 Gate と G0-02

G0-02 Decision候補文書は維持するが、**契約確定には進まない**。

A-01にも進まない。

少なくとも次をG0-01の復旧前提として先に確定する。

1. v21/v22 physical D1/R2 provenance
2. 過去26/27案件の所在
3. current ownerと旧ownerの対応
4. orphan EvidenceのR2原本有無
5. productionを変更せず復旧できる経路

TSUGU Task / Check / Evidence本体への登録は、案件可視性が復旧するまで **未実施** と明記する。登録したふりをしない。

## 11. 4区分状態

### 完了済み

- 前任の静的G0-01調査
- GitHub baseline固定
- build / 71 tests / typecheck基準PASS
- GitHub ↔ Sites版22 source対応の整理
- owner / list query / Evidence ownership / binding / migrationコード追跡
- 公開版22 D1実測との照合
- 原因候補の優先順位化
- 非破壊復旧診断案の作成

### 現在地点

G0-01は **データ所在・identity provenance診断中**。

最有力は「現在版22が、過去案件を持つD1とは別physical D1を見ている / Environmentが分離している」仮説。owner fragmentationも確認済みだが、それだけではcurrent D1から26/27件が存在しないことを説明できない。

### 未完了

- v21 deployment / D1 / R2のread-only取得
- v21-v22 physical resource照合
- 過去26/27件の所在確認
- orphan Evidence R2 readback
- owner分断原因の確定
- 復旧方式の人間判断
- TSUGU本体反映

### 次の作業

1. Sites version21/22のDeployment・Environment・physical D1/R2をread-onlyで照合する。
2. 26/27件を保持する旧D1を特定する。
3. D1/R2 backup・inventoryを取得してから復旧案を選ぶ。
4. owner alias / rebind / data migrationのどれが必要かを、実データを書き換えず決定する。
5. 可視性復旧後にG0-01を再検証し、その後だけG0-02契約確定へ進む。

## 12. 安全確認

今回の診断では次を行っていない。

- 新規案件作成
- migration実行
- owner書換え
- D1削除
- R2削除
- application data変更
- hosting方式変更
- physical binding変更
- writer切替
- redeploy
- G0-02契約確定
- A-01実装開始

既存Evidence、stable ID、FAIL履歴、owner互換性を破壊していない。
