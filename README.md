# 継ぐ / TSUGU

## 作業パック・構造化した作業条件（第1段階）

作業項目に任意の`task`を追加。作業種別、実行順序、依存、完了条件、承認要求、資料参照を保持する。既存案件は自動更新しない。旧Development JSONの新規取込では作業条件を保持し、欠落・未知値は要確認とする。既存案件は「AI引き継ぎ」で対象作業を選び「元資料から作業条件の補完案を作る」から、編集済み本文を保持した差分を確認・保存できる。旧承認は現在版へ昇格しない。

「概要」でSource/Game Dataのrepository・branch・完全Commit SHAを記録できる。作業パックは保存済み案件と選択資料の全文をまとめ、不足する条件を列挙する。`executionAuthorized`と`externalBaselineVerified`はfalseであり、自動実行許可やGit最新照合の証明ではない。

資料参照はsection/idを指定する。別案件ならTSUGU UUIDと保存版も必須。同じ所有者の指定版だけを読み、取得中の版変更でも停止する。`records`のIDなし数値表は`@row:0`から行を選択でき、`$`は選択した資料群全体。原文SHA-256を返す。R2原文は取込時点の資料であり、取込後の編集を反映した現行仕様とは区別する。

- UI/API: `GET /api/projects/task-context`。全取得にprojectId/baseRevisionを要求。
- MCP追加: `get_task_pack`、`get_source_material`。後者は30件の一覧または16,000文字単位の全文取得。nextOffsetを使って続きへ進む。
- 手動返却とMCP返却は既存の提案確認経路を利用。既存taskを省略した更新は拒否する。提案appliedは工程データ保存済みであり、ゲーム実装済みではない。
- 公開SiteのMCP接続設定と本番往復は別工程。本変更は公開設定・実データ・DB schemaを変更しない。
- schemaVersion 1への任意フィールド追加。既存案件の読込とバックアップを維持する。旧クライアントで新形式を再保存しないこと。

検証は`npm test`（build＋全テスト）と`npx tsc --noEmit --incremental false`。Cloudflare runtime型はロックされたWranglerから生成し、Env bindingsは`types/cloudflare-env.d.ts`に定義する。更新コマンドはbuild後の`npx wrangler types types/cloudflare-runtime.d.ts --config dist/server/wrangler.json --include-env false --include-runtime true`。HTML検査はworkerdで実アプリのmetadata・サインイン導線・API未認証拒否を検証する。旧starterのプレビューmetaは現行アプリの仕様ではない。

旧工程のGit正本からTSUGU正本への切替、現行仕様の編集モデル化、検査実行証跡の自動収集、Git反映確認、MCP本番接続、実機操作は未実施。仕様・作業の旧記録を機能実装の証明として扱わない。

## RF-3 バックアップ・ファイル取得・入力保護

保存済み案件のJSON・引き継ぎMarkdown・元JSONは所有者検証付き `/api/projects/export` からattachmentレスポンスで取得する。版指定不一致は409。他人の案件は404。元JSON取得失敗時も本体バックアップは作成し、backupInfoに欠落を明記する。元JSON付きと案件本体のみを別操作にした。ファイル取得のクリックだけで保存成功とは表示しない。

未保存入力はサーバー保存せず、共有API・Clipboard・全文textareaによって退避する。元JSONなしの復元はsourceInfo.originalMissingと警告を保持し、取込資料を表示しない。項目編集画面の未反映入力はdraftState.itemとして保持し、復元時に再び編集画面へ戻す。

ロゴ・ログアウト・案件一覧・再読込・編集ダイアログ終了に未保存確認を適用。保存・破棄・キャンセルと退避操作を提供する。beforeunloadは補助。iOS実機でのファイル保存・OS強制終了時の保護は未検証で、強制終了による入力保持は保証しない。関連検証: `node --test tests/backup.test.mjs tests/status-model.test.mjs tests/handoff.test.mjs tests/revision-approval.test.mjs`。Cloudflare型環境の既存エラーはRF-4に残る。

## RF-2 大容量引き継ぎ（先行対応）

AI引き継ぎは既定で簡潔版。各種別8件まで、全体22,000文字以内で、未解決・要確認・FAIL・提案を優先する。省略件数と抜粋であることを明示し、原文が不足する項目の更新前に全文を要求する。完全版は利用者が選択したときだけ生成する。生成はAI引き継ぎタブ内に限定し、入力と無関係な再描画では再計算しない。上限は `app/handoff.ts` に集約。検証: `node --test tests/status-model.test.mjs tests/handoff.test.mjs`。

## RF-2 履歴・承認

新しい履歴本文はR2、D1は空の互換bodyとsnapshot_object_key・見出しのみ。直近50版を保持（`app/history-policy.ts`）。保存と同一トランザクションで期限切れ履歴を参照から外し、耐久削除キューでファイルを削除する。既存のD1履歴本文は破棄せず、ページ送りと所有者検証付きsnapshot取得APIで参照できる。履歴JSONに取込元JSONは含まれないため、案件全体のバックアップとは区別する。R2の書込に失敗した場合は案件更新を行わない。応答喪失時に参照済みファイルを誤削除しないため、トランザクション結果が不明な場合の孤立ファイル回収は未実装。

承認はサーバーがapprovedRevision / approvedAt / approvedByを生成。保存のたびに明示的な承認要求がなければ失効し、過去の承認記録は残る。クライアントのbooleanや承認メタデータは承認根拠として信用しない。旧booleanは版が不明なため承認へ自動昇格しない。未承認のまま同一工程で保存可能だが、実装以降への前進と完了への移行はサーバーで検証する。案件作成・取込では元の工程を保持するが、承認は引き継がない。

検証: `node --test tests/status-model.test.mjs tests/handoff.test.mjs tests/revision-approval.test.mjs`。履歴保持・所有者分離・取得・削除、R2障害・遅延競合、版承認を実APIとSQLiteで確認。全体の型環境整理は後続段階。

## RF-1 状態の意味保全

`app/model.ts` の `statusByKind` を画面とAPIの共通定義にしています。決定は提案中・確定・却下・廃止・要確認を持ち、新規決定は提案中から始まります。旧形式の状態はkind別に変換し、未知値は警告付きの要確認として保持します。

「取込資料 → 元JSONと状態を比較」で現在の状態との差分を確認できます。差分は誤変換の確定診断ではありません。取込後の意図的な変更も含むため、確認後に項目を編集・保存してください。既存案件の自動書換えは行いません。

回帰テスト: `npm run test:rf1`。認識済み状態、未知状態、kind/statusの全組合せ、API拒否、バックアップの状態保持、比較の非破壊性、AI返却の検証を含みます。

添付アプリのコード・案件データを流用せず、目的・議論・決定・作業・検証を案件単位で継続管理する思想から新規実装。

## 保存と継続
- D1が正本。ブラウザ内永続ストレージは使わない。明示保存・未保存表示・離脱警告。
- ChatGPTの認証済みユーザーIDで案件と履歴を分離。
- 更新はbaseRevisionとの一致が条件。案件更新と履歴記録をD1 batchで一括実行。
- 共有: 保存済み案件からMarkdownの引き継ぎを生成し、コピーまたはダウンロード。
- AI返却: projectId / baseRevision / summary / changes / upserts。差分を確認して反映する。承認と工程変更は対象外。
- JSONバックアップの取込は新しいIDの案件を作成。過去案件を上書きしない。
- 会話からの自動読み書き、MCP接続は未実装。自動接続済みと表示しない。

## データ
project schemaVersion 1。構成、作業、議論、決定、検証はitems内でkindを持ち、parentIdで関連付ける。ソース基準はコード自体でなく所在と版の記録。実装移行に実装承認、完了移行に完了承認と検証解決を必須とする。

## 次の開発へ
手動引き継ぎを基盤とし、将来MCPを接続する場合は同じ所有権検証・版番号比較・変更履歴を使うAPIに接続する。共有や外部公開を追加するときは認証方式を改めて確認する。

## 互換取込・認証の修正

Sitesが保証する認証済みメールヘッダーからハッシュ化した所有者キーを生成。旧ユーザーIDヘッダーが併存する場合は旧所有者の案件も参照可能。未認証時はプラットフォームのサインインパスへトップレベルで進むリンクを表示し、401で再読込だけになる状態を防ぐ。

Development Project JSONの構成・作業箱・タスク・議論・決定・検証を編集用の項目へ変換。仕様、System情報、履歴などを含めて元JSONはR2へそのまま保存し、D1には所有者付き参照を保存する。「取込資料」で全フィールドを読み取り専用で確認できる。バックアップには元ファイルも含めて再取込可能。添付案件の実データはソースに含めない。

検証: 添付2.3MB JSONで573項目・作業の関連・長文本文・承認と5件のFAILの保持、原本の完全一致、バックアップ再取込を確認。SQLiteとR2代替ストアで実APIハンドラのメールのみの認証、未認証拒否、保存・再読込・所有者分離・版競合を確認。iOS実機のサインイン画面操作は未検証。
