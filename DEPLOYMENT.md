# TSUGU deployment

GitHub Pages は TSUGU の配信先です。Pages向けの別アプリケーションは存在せず、`main` がアプリケーションの正本です。

## 構成

- コード: Public `kj2whvbzjn-hue/tsugu` / `main`
- 公開: GitHub Pages `https://kj2whvbzjn-hue.github.io/tsugu/`
- 案件保存: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- 案件: `data/projects/<projectId>.json`
- デプロイWorkflow: `.github/workflows/pages.yml`
- E2E Workflow: `.github/workflows/e2e.yml`

`static/` の変更を `main` に反映すると GitHub Actions が公開成果物を構築して GitHub Pages へデプロイします。

## データと認証

TSUGU はGitHub APIへ直接接続します。Fine-grained PATはブラウザのメモリ内だけで保持し、永続化しません。

推奨設定:

- Resource owner: `kj2whvbzjn-hue`
- Repository access: `tsugu-data` のみ
- Repository permissions: `Contents: Read and write`

接続時に案件保存先がPrivateリポジトリであることを確認します。

## 保存・競合

1回の案件保存を1 Git commitとして扱います。保存直前に対象JSONを再取得し、Git blob SHAと案件revisionを照合します。どちらかが変わっている場合は上書きを停止します。

## E2E

E2Eは公開URLをChromiumで操作し、接続、新規案件作成、保存、GitHub上のJSON再取得を確認します。テストは専用の `tsugu` リポジトリ `tsugu-data` ブランチを一時保存先に使用し、完了時に作成したテストJSONを削除します。これは本番案件保存先 `kj2whvbzjn-hue/tsugu-data` とは別です。
