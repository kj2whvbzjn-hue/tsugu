# TSUGU Workflow deployment

現行のGitHub Pages方式を維持する。Sites、D1/R2、Workerなどの新しいhostingは追加しない。

- Source: `kj2whvbzjn-hue/tsugu` / `main`
- Site: `https://kj2whvbzjn-hue.github.io/tsugu/`
- Data: Private `kj2whvbzjn-hue/tsugu-data` / `main`
- Data path: `data/workflow-projects/<workspace.id>.json`
- Artifact builder: `.github/scripts/build-pages-site.sh`
- Acceptance: `.github/workflows/workflow-acceptance.yml`
- Deploy: `.github/workflows/pages.yml`

Pages artifactはindex.html、favicon.svg、workflow.css、workflow-domain.mjs、workflow-git.mjs、workflow-app.mjsの6ファイルだけで構成する。gzip/Base64の旧app、旧Core、旧UI scriptsを含めない。

`main`更新または手動Deployは、Workflow Acceptance（domain・保存競合・参照検査、成果物構築、UI通し検証）に合格してから配置する。旧画面向けE2Eは新画面の合格条件に流用しない。

新コードは旧 `data/projects/` を操作しない。新データへの自動移行・旧データ削除はない。旧データを必要とする場合は出典を確認して新案件へ明示登録し、承認は新対象で取得する。

公開後に確認するもの：対象commit、Actions deployment成功、ブラウザで新工程画面表示、Privateデータ接続、保存・再読込。ローカル／CIのGitHub fixtureテスト合格を、本番Privateリポジトリへの書込実測と報告しない。
