# 継ぐ / TSUGU

TSUGUは、目的・議論・決定・作業・検証を案件単位で継続管理する**単一のアプリケーション**です。GitHub Pagesは配信先であり、別の「Pages版」「静的版」「Sites版」はありません。

## 正本

- アプリケーション: `kj2whvbzjn-hue/tsugu` / `main`
- 公開URL: `https://kj2whvbzjn-hue.github.io/tsugu/`
- 現行UI: `static/`
- デプロイ: `.github/workflows/pages.yml`
- E2E: `.github/workflows/e2e.yml`
- 案件データ: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- 案件ファイル: `data/projects/<projectId>.json`

旧サーバーランタイム、Cloudflare D1/R2、ChatGPT Sites、MCP、Next/vinext/Worker系は現行TSUGUの構成ではなく、mainから撤去する。実行可能なフォールバックや互換経路を残さない。

## 保存と認証

TSUGUはGitHub APIへ直接接続します。案件の正本にlocalStorageを使いません。

- 1保存 = 1 Git commit
- revision + Git blob SHA で競合検出
- 履歴 = Git commit history
- Fine-grained PATは利用中タブのメモリ内だけに保持
- PATをlocalStorage / Cookie / 案件JSONに保存しない
- 保存先はPrivate `tsugu-data`
- 推奨権限は `Contents: Read and write`

## 現在の機能

案件一覧・読込・新規作成・更新・削除、概要・工程・項目編集、承認、SOURCE_UPDATE検査、作業依存検査、TSUGU schemaVersion 1 JSON取込・バックアップ、AI引き継ぎ・返却JSON反映、高度な案件JSON編集を提供します。

旧Development Project JSONの変換取込は行いません。

## 改修情報源

現行の参照順は次です。

1. [`docs/TSUGU_PROJECT_REFERENCE.md`](docs/TSUGU_PROJECT_REFERENCE.md)
2. [`docs/TSUGU_CORE_VNEXT_PLAN.md`](docs/TSUGU_CORE_VNEXT_PLAN.md)
3. [`docs/TSUGU_CORE_VNEXT_WBS.md`](docs/TSUGU_CORE_VNEXT_WBS.md)
4. [`DEPLOYMENT.md`](DEPLOYMENT.md)
5. [`AI_CONNECTION.md`](AI_CONNECTION.md)

過去資料にあるSites/D1/R2等の環境記述は現在値として使いません。作業開始時にmain HEADと実際のDeploymentを確認します。
