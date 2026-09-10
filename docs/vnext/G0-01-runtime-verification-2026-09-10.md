# TSUGU Core vNext G0-01 実行・実機検証記録

- 検証日: 2026-09-10
- 対象計画: TSUGU Core vNext 修正版計画 v2.3
- Task: G0-01 現状調査
- Repository: `kj2whvbzjn-hue/tsugu`
- 基準 branch: `main`
- G0 開始 SHA: `ad3534750e03345b38a01416e012b9f4dde06701`
- 作業 branch: `vnext-g0-20260910`
- Draft PR: `#1 G0-01: record current-state survey and verification`

この記録は `G0-01-current-state-2026-09-10.md` の静的調査をやり直さず、未確認だった実行系・実機系だけを追加検証した結果である。

## 1. 認証済み Sites / Deployment / D1 / R2

### 結果

**未確認。**

認証済みブラウザ操作に使用可能な Opera Browser Connector を確認したが、接続時点で `Browser not connected. Make sure to enable "Allow AI connection" ...` となり、認証済みブラウザへアクセスできなかった。

そのため次は推測で補完しない。

- 実 Sites Deployment の immutable deployment identifier
- 実 Deployment が指す repository commit
- artifact digest
- Environment identifier
- config version
- 実 D1 に適用済み migration / schema version
- 実 D1 の既存案件件数・owner compatibility の実態
- 実 R2 bucket identifier
- 認証済み実機での Evidence upload / readback / SHA・size 再検証
- sign-in 後の主要 UI / API
- 実環境の rollback / restore 操作権限と手段

`.openai/hosting.json` にある `project_id`、D1 binding `DB`、R2 binding `BUCKET` はソース設定として確認済みだが、これらを実 Deployment / Environment / bucket 実体の確認結果として扱わない。

### 判定

G0-01 を「実機まで完全確認済み」とはしない。上記は未確認事項として G0-02 / R-01 / R-02 の判断入力に残す。

## 2. 開始 SHA 固定の build / test

### 実行方法

G0 作業 branch に検証専用 GitHub Actions workflow `.github/workflows/g0-verify.yml` を追加した。アプリケーションコード、DB、hosting、writer は変更していない。

PR event の既定 checkout が merge ref になり得るため、workflow 内で次を明示した。

```text
G0_BASE_SHA=ad3534750e03345b38a01416e012b9f4dde06701
actions/checkout ref: $G0_BASE_SHA
```

さらに `git rev-parse HEAD` と `G0_BASE_SHA` の一致を step 内で検証した。

### GitHub Actions 証拠

- Workflow: `G0 verification`
- Run ID: `34451896145`
- Run number: `5`
- Job ID: `102789287032`
- Job conclusion: `success`
- Runner OS: Ubuntu 24.04.4 LTS / image `ubuntu-24.04`
- Node: `v22.19.0`
- npm: `10.9.3`
- expected commit: `ad3534750e03345b38a01416e012b9f4dde06701`
- actual checkout commit: `ad3534750e03345b38a01416e012b9f4dde06701`

### 実行コマンドと結果

| 区分 | コマンド | 終了コード | 結果 |
|---|---|---:|---|
| dependency install | `npm ci` | 0 | PASS。677 packages |
| build | `npm run build` | 0 | PASS |
| full tests | `node --test tests/*.test.mjs` | 0 | PASS。71/71 |
| typecheck | `npx tsc --noEmit --incremental false` | 0 | PASS。出力なし |

Build は `scripts/build-verified.sh` から bounded `vinext build` を実行し、client/server references、RSC、client、SSR の5段階が完了した。

Build 時に列挙された主要 route:

- `/`
- `/api/evidence`
- `/api/projects`
- `/api/projects/export`
- `/api/projects/task-context`
- `/api/proposals`
- `/mcp`
- `/storage`

`/storage` は vinext static analysis では分類できず `? Unknown` と表示された。build 自体は成功している。これは認証後実機での route 動作確認を代替しない。

### Test 集計

```text
# tests 71
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

既存回帰として、Evidence retry、R2成功+D1確定失敗回復、旧版retryのcurrent version後退防止、stable PathEntry ID、履歴保持、owner/revision bound、未完了依存 fail closed 等が PASS している。

## 3. Evidence artifact

GitHub Actions から検証ログを artifact として保存した。

- Artifact ID: `10141894160`
- Artifact name: `g0-verification-65a20457726b1728aeb28b3ace3e86b054c3682d`
- Size: 5,584 bytes
- Artifact digest: `sha256:a51929800f46e34c32f7a2bb12e048d5128a7c4fa724334026d4bc93c472b9d3`
- Expiry: `2026-12-09T07:49:19Z`

Artifact name 内の SHA は pull_request event の `github.sha` であり、テスト対象 SHA ではない。テスト対象は artifact 内 `environment.txt` と job log で `ad3534750e03345b38a01416e012b9f4dde06701` に一致することを確認した。

Artifact 内容:

- `environment.txt`
- `npm-ci.log`
- `npm-ci.exitcode`
- `build.log`
- `build.exitcode`
- `tests.log`
- `tests.exitcode`
- `typecheck.log`
- `typecheck.exitcode`

4つの exitcode はすべて `0`。

## 4. G0-01 で確認できたこと / できなかったこと

### 確認済み

- GitHub `main` 開始 SHA を固定
- 開始 SHA そのものを CI で checkout
- dependency install PASS
- build PASS
- existing full tests 71/71 PASS
- typecheck PASS
- 実行ログ artifact を SHA-256 digest 付きで保存
- 静的調査で確認済みの Core / legacy / Evidence / Repository / Approval / API / migration 構成と、開始 SHA の実行可能性に矛盾がないことを確認

### 未確認

- 認証済み Sites の実 Deployment commit / artifact / Environment
- 実 D1 schema / applied migrations / data量
- 実 R2 bucket / Evidence readback
- sign-in 後 UI / API
- 実 rollback / restore 権限と手段
- GitHub と実 Sites Deployment の対応

## 5. G0-02 へ進める条件

G0-02 の契約整理は開始できる。理由は、開始 SHA とソース境界が固定され、静的調査に加えて build / test の基準結果も取得できたため。

ただし次を「実機で確定済み」とする Decision は、認証済み実機の観測まで保留する。

- Environment identifier の実値
- Deployment identifier / artifact digest / config version / DB schema version の取得経路
- 初期管理者 bootstrap に利用できる認証主体情報の実値
- D1 / R2 backup・restore の実操作経路

## 6. 人間判断事項

G0-02 では少なくとも次を人間判断と技術確認に分離する。

1. 初期管理者をどの認証済み主体へ付与するか。自己昇格APIは作らない。
2. Sites が immutable Deployment 情報を十分に公開しない場合、TSUGU側で deployment record を確定する運用を採用するか。
3. vNext の ID 形式を新規 Entity では server-generated UUID に統一するか。既存 legacy ID を primary key として再利用しない方針との整合を確認する。
4. cutover 前に要求する backup / restore の責任者、保持期間、停止許容値は R-02 で確定する。G0-02 では復旧経路が存在することを実証条件として残す。

## 7. 4区分状態

### 完了済み

- 既存静的調査
- 開始 SHA 固定
- G0 build/test CI 作成
- 開始 SHA の `npm ci` / build / 71 tests / typecheck PASS
- 実行ログ artifact 保存
- G0-02 契約候補の整理開始条件を満たした

### 現在地点

G0-01 の GitHub / CI 検証は完了。認証済み Sites / Deployment / D1 / R2 の実測だけが未確認として残る。

### 未完了

- 認証済み実機確認
- 実 Deployment と GitHub SHA の照合
- 実 D1 / R2 / Evidence readback
- TSUGU 本体への Task / Check / Evidence 反映

### 次の作業

- G0-02 の Decision 候補を技術契約として整理する。
- 認証済みブラウザ接続が利用可能になった時点で、G0-01 の未確認実機項目だけを追補する。
- G0-02 合格までは A-01 の writer / schema 実装へ進まない。

## 8. 安全確認

今回、アプリケーションコード削除、旧データ削除、hosting方式変更、writer切替は行っていない。既存 Evidence、stable ID、FAIL履歴、owner互換性を変更していない。
