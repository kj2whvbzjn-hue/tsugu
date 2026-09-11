# TSUGU Core vNext A-02 Repository / Deployment 契約

**Task:** A-02  
**開始基準:** `15929d1816519f07c080ff5e89a2d08877ecffae`  
**対象:** GitHub Pages + GitHub Actions + GitHub API

## 1. RepositoryCommitRef

`RepositoryCommitRef` は GitHub repository ID と40桁full commit SHAの組で識別する。

- ID: `repository-commit:github:<repositoryId>:<commitSha>`
- repository名やSHAだけを単独の一意キーにしない
- 同じSHA文字列でも別Repositoryなら別参照とする
- short SHAは受理しない

## 2. RepositoryBaseline

`RepositoryBaseline` は `RepositoryCommitRef` と、そのcommitが指すfull tree SHAを固定する最小snapshotとする。

- commitとtreeをGitHub Git APIから取得する
- 現在のbranch HEADやpath状態を後から参照してBaselineを書き換えない
- A-03以降のPathEntry等はこの固定commit/treeを基準に接続する

## 3. Environment

現行公開環境はGitHub Pages `github-pages` とし、HTTPS公開URLとcode repositoryを固定する。

EnvironmentはDeploymentと分離し、同一環境への再配置を同一Deployment扱いしない。

## 4. Deployment

`Deployment` は成功した `Deploy TSUGU` workflow runごとの変更不能な実測記録とする。

固定する事実:

- source `RepositoryCommitRef`
- `RepositoryBaseline` のtree SHA
- GitHub Actions workflow run ID / attempt / workflow ID / path
- `github-pages` artifact ID / SHA-256 digest / size
- `.github/workflows/pages.yml` のGit blob SHAを設定版として固定
- Core Reference schemaVersion
- Project schemaVersion
- Environment / 公開URL
- 実測時刻

Deployment IDは `deployment:github-actions:<repositoryId>:<runId>:<attempt>` とする。同じcommitを再配置してもrun IDが異なるため別Deploymentになる。

## 5. Fail closed

次は記録を作らず拒否する。

- short / 不正Git SHA
- runとGit commitのSHA不一致
- runとartifactのrun ID不一致
- runとartifactのcommit SHA不一致
- successでないrun
- 対象workflow path不一致
- `github-pages` 以外または期限切れartifact
- SHA-256 digest欠落・形式不正
- workflow config blob SHA欠落・形式不正
- HTTP公開URL

## 6. 実測

公開された `static/core-reference.js` の `captureCurrentDeployment()` はGitHub APIを再取得し、対象Deploy runから上記recordを構成する。

専用Actions `TSUGU Core Reference E2E` は、Deploy完了後に次を検証する。

1. 公開Pages上の `core-reference.js` が対象commitのcheckout内容と一致
2. source commit SHAがtrigger元Deploy runと一致
3. tree SHAを取得できる
4. `github-pages` artifactのSHA-256 digestを取得できる
5. workflow設定版のblob SHAを取得できる
6. immutable Deployment JSONをActions artifactとして保存

PATやGitHub tokenをrecordへ保存しない。

## 7. 後続

A-03でProject / ArchitectureNode / PathEntry / Bindingを導入する際、このRepositoryCommitRef / Baselineを安定したsource参照として利用する。A-04でChangeSet確定境界へ接続するまでは、構造変更の公開書込みをこのモジュール単独で実装しない。
