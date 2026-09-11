# TSUGU Core vNext C-03 — 同期回復の強化と負荷検証

C-03はA-05 GitHub同期を置き換えず、可変GitHub情報の回復層を追加する。B/Cの業務判断・保証契約は変更しない。

## 同期回復

通知（delivery）は「受信した事実」として保存し、branch/PRの現在値とは分離する。通知payloadの到着順だけで現在branch headを更新しない。現在headはGitHub APIから再取得した値だけで `MutableBranchObservation.canonicalHeadSha` として確定する。

同一delivery IDは同一payloadなら重複排除し、同一IDで内容が異なる場合は拒否する。commit業務IDはA-05のrepository+full SHA一意性をそのまま利用する。

既知headから現在headが進んだ場合、GitHub compareで間のcommit列を再取得し、未取込commitをA-05 `receiveCommit` へ順に渡す。compare/API失敗は削除・完了・影響なしと推測せず `UNKNOWN` とincidentを残してretry対象にする。compare失敗後も `recoveryBaseSha` を保持し、同じ現在headへの再試行で欠損区間を回復できる。

non-fast-forward/force-push等で既知headから安全に列挙できない場合、GitHubから読んだ現在head自体は外部事実として記録するが、branch consistencyは `UNKNOWN` のままとし、Full reconciliationを要求する。

A-05のSyncJob leaseは既存契約を再利用する。期限切れLEASED jobは別workerが再claimでき、attempt/maxAttemptsを維持する。

## 業務判断の境界

同期自動補正の対象はGitHub外部事実、IntegrationRecord、SyncJob、Recovery stateに限定する。Approval、Decision、Waiver、Task等を同期処理が変更してはならない。C-03は業務状態fingerprintを検証するguardを提供し、回復処理前後の不変性をテストする。

## 負荷検証

`scripts/c03-load-probe.cjs` はA-05のIntegrationRecord取込とC-02 Architecture Health再計算を実コードで測定し、sync処理時間と再計算遅延、Node/runner情報をJSON evidenceへ保存する。

ただし計画v2.3の合格条件は「G0と運用実績から**合意したデータ規模**」での測定である。現在のGitHub接続からprivate `kj2whvbzjn-hue/tsugu-data` は404で、実運用件数・合意済み許容値を確認できない。そのため同梱 `TSUGU_CORE_VNEXT_C03_LOAD_PROFILE.json` は明示的に `approved:false` のengineering probeであり、C-03の性能受入PASSには使用しない。

承認済みprofileは最低限、integrationRecords、missedCommits、recalculationItems、maxSyncMs、maxRecalculationMs、approvalRefを固定する。許容値を超えた場合、`assessLoadProbe` は原因が未記録なら受入不可とし、原因を記録した測定だけを「超過記録済み」と扱う。

## 合格条件のうち自動検証できる範囲

- 逆順通知が現在headを巻き戻さない。
- GitHub compareで取込欠損を埋める。
- 一時API失敗後にrecovery baseを保持して再試行できる。
- API失敗はUNKNOWN、non-fast-forwardはUNKNOWN + incidentとなる。
- lease切れを既存Sync契約で再claimできる。
- 自動補正でApproval/Decision/Waiver/Taskを変更しない。
- engineering load probeでsync時間とC-02再計算時間をevidence化する。
- 未承認profileを性能PASSとして扱わない。

性能profileが人間承認されるまでC-03全体のstatusはPASSにしない。D-01はC-03完了依存のため、その承認前には着手しない。
