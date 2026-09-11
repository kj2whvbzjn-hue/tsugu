# TSUGU プロジェクト運用・参照基準書

**状態:** 現行正本  
**更新日:** 2026-09-11  
**対象:** 統一TSUGU / Core vNext 改修

この文書は、旧 `TSUGU_プロジェクト運用・参照基準書 v1.0` および `TSUGU_運用参照基準書 v1.4` のうち、現在の参照先・実行環境・ツール・公開方式に関する記述を置き換える。旧文書の ChatGPT Sites / Cloudflare D1 / R2 / サーバーAPI / MCP を現行TSUGUの実体として参照してはならない。

## 1. 正本

TSUGUは一つだけ存在する。

- アプリケーション正本: `https://github.com/kj2whvbzjn-hue/tsugu` の `main`
- 公開実体: `https://kj2whvbzjn-hue.github.io/tsugu/`
- 現行UIソース: `static/`
- デプロイ定義: `.github/workflows/pages.yml`
- E2E定義: `.github/workflows/e2e.yml`
- 案件データ正本: Private `kj2whvbzjn-hue/tsugu-data` の `main`
- 案件レコード: `data/projects/<projectId>.json`

GitHub Pagesは別版ではなく、`main` にあるTSUGUの配信先である。「Pages版」「静的版」「Sites版」を製品系統として扱わない。

## 2. 現在存在しない実行経路

次は現行ランタイムではない。参照先、実装先、フォールバックとして残さない。

- ChatGPT Sites の旧URL
- `.openai/hosting.json`
- Cloudflare D1 / R2
- `app/api/*` の旧サーバーAPI
- `worker/` の旧Worker
- 旧MCPサーバー / 提案Inbox
- Next / vinext / Wrangler / Drizzle の旧実行系
- legacy `items` 実装への互換フォールバック

必要な機能は現行TSUGUへ実装する。Git履歴は監査・過去参照に使用できるが、旧コードを実行可能な代替経路として残さない。

## 3. 現在の保存・認証

案件保存はブラウザから GitHub API へ直接行う。

- Fine-grained PAT は利用中タブのメモリ内だけに保持する
- localStorage / Cookie / 案件JSONにPATを保存しない
- 保存先は Private `tsugu-data` のみ
- 推奨権限は `Contents: Read and write`
- 1回の案件保存を1 Git commitとして扱う
- 更新前に案件revisionとGit blob SHAを再確認し、不一致なら書込みを拒否する

現在の認証主体は GitHub `/user` で確認したログイン主体である。AIの自己申告や入力JSONのactor名を本人確認として扱わない。

## 4. 開発で使うツール

### GitHub接続ツール

ソース確認、main HEAD確認、branch/commit/diff、ファイル更新、Actions結果確認に使う。成果物はGitHubへ残す。

### ローカル実行環境

構文検査、変換、テスト、静的解析、成果物生成に使う。ローカル成果物やZIPだけで完了扱いにしない。

### Web / Browser

GitHub・GitHub Pages・外部公式仕様の現行状態確認、公開UIの実測に使う。資料に記載された古いURLや過去のDeploymentを現在値として流用しない。

### GitHub Actions

- `Deploy TSUGU`: `main` の現行UIをGitHub Pagesへ配信する
- `TSUGU E2E`: 公開TSUGUをChromiumで操作し、接続・作成・保存・GitHub再読込まで確認する

Actionsの成功は実行証拠であり、対象commitとrunを結び付けて確認する。

## 5. 情報源の優先順位

1. 現在のGitHub `main` と、そのcommit/diff
2. 実測したGitHub Pages / GitHub Actions / Private data repositoryの状態
3. TSUGUに保存された案件・判断・検査・承認
4. `docs/TSUGU_CORE_VNEXT_PLAN.md`
5. `docs/TSUGU_CORE_VNEXT_WBS.md`
6. 過去資料（目的・背景の参考のみ）

矛盾した場合、過去資料の環境記述を現行状態へ優先させない。計画の意図と現行実体を分け、必要なら計画を更新してから実装する。

## 6. AI作業の基本手順

1. `main` HEADを実測する
2. 対象Taskと完了条件を確認する
3. 現行ソースと公開実体を確認する
4. 変更する
5. 必要な構文検査・テスト・E2Eを行う
6. GitHubへcommitする
7. commit / diff / test / Deployment / 未解決事項をTSUGUへ戻す

会話内の説明だけ、未反映ZIP、未検証の自己申告を成果物にしない。

## 7. 旧コード撤去方針

2026-09-11の人間指示により、旧サーバーコードは現行リポジトリから撤去し、互換・フォールバック経路を残さない。これは「案件データの無条件削除」を意味しない。Private `tsugu-data` の案件データは現行正本として保持する。

旧コードにしか存在しない機能が必要になった場合は、Git履歴から要件を確認し、現行TSUGUの設計として再実装する。旧ランタイムを復活させて迂回しない。
