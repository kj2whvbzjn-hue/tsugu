# 継ぐ：AI提案接続の実装状況

## 作業パックの追加

`get_task_pack(projectId, baseRevision, taskId)`は作業条件と選択した資料全文を返す。`get_source_material(projectId, baseRevision, section, id?, offset?)`は取込時点の資料を一覧・分割取得する。`records`にはIDなしの行もあり、返された`@row:N`をそのまま使う。`$`は資料群全体。nextOffsetがある場合は続きがある。

別案件の資料を参照するtask.referencesにはprojectId/baseRevisionを両方指定する。所有者、案件版、取得前後の版一致を検証する。原資料SHA-256はパックに含まれる。取込原文を現在の編集仕様と混同しない。

upsertsで既存項目を更新する場合、taskが存在すれば全フィールドを保持する。changesには従来項目に加えてsourceRefsが使用できる。作業パックのexecutionAuthorized/externalBaselineVerifiedはfalse。不足条件がなくてもGitの現在版・必要規約・仕様網羅性を確認して人間の実行判断を受ける。本変更でMCPの本番接続が自動的に有効にはならない。

## 実装済み（未公開）

- `app/mcp/route.ts`: 認証済みリクエスト向けのステートレスなStreamable HTTP窓口。
- `list_projects`, `get_project`, `get_items`, `submit_proposal`, `get_proposal_status`。
- `app/proposals.ts`: AI返却の案件・基準版・項目重複・型・関連先を共通検査。
- `app/api/proposals/route.ts`: 変更案の永続保存、一覧、詳細。1案128KB以内。
- `app/api/projects/route.ts`: 保存済み提案IDからサーバーが変更内容を再構築。案件更新、履歴、提案の反映状態を同じD1バッチで確定。再送は再反映しない。
- `app/proposal-inbox.tsx`: AI引き継ぎ画面で最新30件を確認。表示中は15秒ごと、および画面復帰時に再取得。未保存入力がある間は反映しない。
- 手動JSON返却も同じサーバー検査・提案保存経路を使用。
- 新規マイグレーション `0004_blue_yellowjacket.sql`。既存の案件や履歴の形式は維持。

## 利用前に必要な接続確認

本番のv9について、Sitesの接続確認は「公開版にMCP宣言がない」と応答した。
接続済みではなく、本変更だけで現在のChatGPT会話にツールが追加されるわけではない。

1. SitesでサポートされるMCP capability宣言の正確な設定形式を確認する。
   未確認のmanifestフィールドを推測で追加していない。
2. Sites dispatchでMCP OAuthが検証され、既存サイトと同一の本人ID／所有者に結び付くことを確認する。
   アプリは既存のプラットフォーム認証ヘッダーだけを信頼する。
   インターネットに直接公開する際、任意ヘッダーを信用する構成に変更してはいけない。
   アプリ独自のOAuth、認証トークン発行、認証回避設定は追加していない。
3. 本人が承認した公開範囲を維持して変更版を公開する（公開は別途指示後）。
4. Sitesから返された正確なMCP URLとOAuth resourceを利用してChatGPT側を接続する。
5. テスト案件に対して「取得→提案送信→iPhoneで反映→反映版取得」を実環境で確認する。

AIの公開ツールに、削除・工程移行・実装承認・完了承認・提案反映は含めない。
提案反映は既存画面と同様、認証済み本人の操作で行う。
検証項目のPASSは記録値であり、ソーステストを実行した証明ではない。
ソース修正・ビルド・本番公開の実行機能はこのMCPには含めない。

## 検証

`node --test tests/proposals.test.mjs tests/revision-approval.test.mjs` で、
正常往復、再送、別所有者、未認証、不正送信元、禁止フィールド、状態不正、
古い版、保存直前の競合、保存障害、削除後の提案消去、MCP操作一覧を検証。

全テストでは、既存の `rendered-html.test.mjs` がCloudflare用Workerを通常Nodeで
importするため、`cloudflare:`未対応エラーになる。テストを削除・skipしていない。
既存のCloudflare型宣言不足とworkspaceのfilter/sort重複により、全体の型検査も未完了。
本番環境の認証、実データ、iPhone画面での実操作テストは未実施。

## 情報源

- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- https://developers.openai.com/api/docs/guides/tools-connectors-mcp
