# 継ぐ / TSUGU

TSUGU は、目的・議論・決定・作業・検証を案件単位で継続管理する **単一のアプリケーション** です。
GitHub Pages は TSUGU の公開・配信方式であり、「Pages版」「静的版」という別製品・別系統はありません。

## 正本

- アプリケーション正本: `kj2whvbzjn-hue/tsugu` の `main`
- 公開URL: `https://kj2whvbzjn-hue.github.io/tsugu/`
- 現在の実行UI: `static/`
- デプロイ: `.github/workflows/pages.yml`
- E2E: `.github/workflows/e2e.yml`
- 案件データ: Private リポジトリ `kj2whvbzjn-hue/tsugu-data` の `main`
- 案件ファイル: `data/projects/<projectId>.json`

今後の機能改修は `main` の TSUGU を対象に行い、公開UIにも同じ変更を反映します。GitHub Pages 専用の機能ブランチや別実装を正本として運用しません。

## 保存モデル

ブラウザの localStorage を案件の正本には使用しません。案件は GitHub Contents API を通して `tsugu-data` に JSON として保存します。

- 1回の保存 = 1 Git commit
- 案件 `revision` と Git blob SHA の両方で競合を検出
- 履歴は Git commit history から参照
- PAT は画面を開いている間のメモリ内だけに保持
- PAT を localStorage / Cookie / 案件JSONへ保存しない
- 推奨PAT権限: `tsugu-data` のみ、`Contents: Read and write`

## 現在の機能

- 案件一覧・読込・新規作成・更新・削除
- 概要・工程・構成・作業・議論・決定・検証の編集
- revision / blob SHA による競合防止
- Git履歴と過去JSONの参照
- 実装承認・完了承認
- SOURCE_UPDATE の変更計画／完了検査
- 作業依存の実行前検査
- TSUGU schemaVersion 1 JSON の新規取込・バックアップ
- AI引き継ぎテキスト生成とAI返却JSONの手動反映
- 高度な案件JSON編集

旧 Development Project JSON の変換取込は行いません。

## AI連携

現在のTSUGUは、AI引き継ぎテキストと返却JSONによる明示的な往復を使用します。AI返却は編集内容へ反映しただけではGitHubへ保存されず、利用者が保存操作を行った時点で案件の新しい revision として確定します。

削除、工程移行、実装承認、完了承認はAI返却から直接実行させません。

## 旧サーバー実装について

`app/`、`db/`、`drizzle/` などには、GitHub保存方式へ移行する前のサーバー実装コードが残っています。これは別の「TSUGU版」ではなく、移行元・参照用コードです。現行の公開ランタイムは `static/` です。

今後、旧実装にしか存在しない機能を戻す場合は、現行TSUGUへ統合してから利用します。旧D1/R2 APIを独立した製品系統として再開しません。

## 検証

公開TSUGUのE2Eでは Playwright/Chromium を使用し、接続、新規案件作成、GitHub保存、JSON再読込、テストデータ削除まで確認します。

デプロイと運用の詳細は [`DEPLOYMENT.md`](DEPLOYMENT.md) を参照してください。
