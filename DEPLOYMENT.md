# TSUGU deployment

`main` が唯一のTSUGU正本で、GitHub Pagesはその配信先です。

## 構成

- コード: Public `kj2whvbzjn-hue/tsugu` / `main`
- 公開: `https://kj2whvbzjn-hue.github.io/tsugu/`
- 案件保存: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- 案件: `data/projects/<projectId>.json`
- Deploy: `.github/workflows/pages.yml`
- E2E: `.github/workflows/e2e.yml`

Cloudflare D1/R2、ChatGPT Sites、Worker、Next/vinextは現行デプロイ経路ではありません。

## データと認証

ブラウザからGitHub APIへ直接接続します。Fine-grained PATはタブのメモリ内だけで保持します。保存先はPrivate `tsugu-data` とし、推奨権限は `Contents: Read and write` です。

保存直前に対象JSONを再取得し、blob SHAと案件revisionを照合します。不一致の場合は上書きを停止します。

## Deploy検証

`Deploy TSUGU` は `static/` から公開artifactを構築し、JavaScript構文検査後にGitHub Pagesへ配置します。成功runの対象commitを確認してDeployment証拠とします。

## E2E

`TSUGU E2E` は公開URLをChromiumで操作し、GitHub接続、新規案件作成、保存、JSON再取得を確認します。テスト用データは本番Private `tsugu-data` を使わず、テストrun専用の一時Git branchを作成して終了時に削除します。

旧コードや旧ホスティングを復旧用fallbackとして維持しません。障害時はGit履歴とActions結果から原因を確認し、現行mainへ修正commitを追加します。
