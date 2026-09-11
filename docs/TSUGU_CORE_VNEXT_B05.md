# TSUGU Core vNext B-05 実装契約

**固定日:** 2026-09-11  
**対象:** PlannedChange / ActualChange / Git差分照合  
**依存:** B-04 PASS

## 1. PlannedChange

- PlannedChange は表示path文字列ではなく、Project内の安定 `PathEntry.id` を対象として固定する。
- Repository、base commit、対象PathEntryと予定change typeを固定する。
- PathEntryのrename/move後もPlannedChangeの対象IDを書き換えない。
- 対象PathEntryがProject/Repository範囲外なら作成を拒否する。

## 2. ActualChange

- ActualChange は `repositoryId + repositoryFullName + baseCommitSha + headCommitSha` を固定する。
- headがmerge commitなら `comparisonParentSha` を必須とし、headの実親以外は拒否する。
- GitHub compare結果のfile path/status/blob SHAをimmutable factとしてhash固定する。
- PathEntry対応はArchitectureの安定IDへ行う。通常変更は完全一致pathのみ対応する。
- `RENAMED` はGitHubが `previous_filename` を明示した場合だけ旧pathのPathEntry IDへ対応する。
- rename元が不明な場合、追加/削除pathの類似性などから推測せず `CONFIRMATION_REQUIRED` とする。
- 未対応pathは `UNMAPPED` とし、影響なしとして扱わない。

## 3. Git差分照合

- ActualChange登録時のGit captureはhash検証する。
- persistent Apply直前にbase/headをGitHubから再取得し、captureと一致しなければ登録を拒否する。
- 後続reconciliationでもGitHubを再取得し、`MATCH / MISMATCH / UNKNOWN` を明示する。
- GitHub API失敗を削除・一致・完了と推測しない。
- Gitのraw diff hashとPathEntry対応結果は分離し、後のArchitecture表示path変更でGit fact自体を書き換えない。

## 4. Planned / Actual reconciliation

- PlannedChangeとActualChangeは同一Repository/base commitだけを対応させる。
- planned targetの未実施、planned外の変更、UNMAPPED/CONFIRMATION_REQUIRED pathを列挙する。
- 全対象一致かつGit再照合MATCHのときだけ `MATCH` とする。
- 一部対応は `PARTIAL`、Git差分不一致は `MISMATCH`、取得不能は `UNKNOWN` とする。
- reconciliation履歴は追記し、過去の不一致を削除して現在一致へ置換しない。

## 5. 永続化

- B-05の永続変更は `PlannedActualChangeSet` 経由だけを正規経路とする。
- ChangeSetはproject revision + Git blob SHA CAS、actor-bound ValidationRecord、idempotency keyを固定する。
- operation payloadからactor/role等の権限情報を指定できない。
- ActualChangeを含むApplyではGitHub再照合を保存直前に行う。

## 6. B-06接続

B-05は差分と照合状態を記録するまでとする。Task Start/Resume/Completeの有効化、Assurance失効、UNKNOWN中の操作拒否はB-06で接続する。B-05単独でGit差分一致をTask完了承認へ昇格させない。
