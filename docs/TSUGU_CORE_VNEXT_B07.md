# TSUGU Core vNext B-07 — MVP通し検証と運用説明

B-07はStage Bの新規ドメインを増やす作業ではない。B-01〜B-06で実装したBox、Rule/TestDefinition、Governance、Check/Evidence、Planned/Actual、Assurance/Event/Task実行を、計画v2.3第9章の10シナリオとして再実行し、運用者がTSUGU上で根拠を辿る順序を固定する。

## 受入の正本

10シナリオの機械可読定義は `static/stage-b-mvp-scenarios.json` を正本とする。`tests/stage-b-mvp-acceptance.cjs` は各シナリオに紐づく既存契約テストを実行し、対象SHA、workflow run、各contractのexit codeを `StageBMvpAcceptanceEvidence` JSONへ保存する。同じcontractを複数シナリオが共有する場合でも、シナリオごとの合否はmanifestの対応関係から明示的に評価する。

## 計画9章との対応

1. Bootstrap/reseed — Core Guard / Reference。
2. Project/Repository/Node/Path/Published Box/Effective Rules — Reference / Architecture / Box / Rule-Test。
3. Task A→Event→Task B — Governance / Assurance-Event。
4. 権限・Project越境・actor偽装・Approval — Guard / Governance。
5. fixed base/head Git、Evidence、PASS、Event — Planned/Actual / Check-Evidence / Assurance-Event。post-merge E2Eで公開物も再確認する。
6. FAIL→Issue→修正Task→新Check→解決関係 — Check-Evidence / Governance / Assurance-Event。
7. commit/Rule/Box/TestDefinition/Deployment/Waiver失効と遅延PASS — Assurance-Event / Rule-Test / Box。
8. 手動Hold＋依存Hold、Interrupt/Resume/Cancel/reload — Governance / Assurance-Event。
9. 同時Apply、retry、Evidence回復、同期中断・逆順 — ChangeSet / Check-Evidence / Sync系。post-merge E2EでGitHub Contents CAS競合を実際に発生させる。
10. 最終Approval→DONE→後続失効 — Governance / Check-Evidence / Assurance-Event。

## 実機E2E

`.github/workflows/stage-b-mvp-e2e.yml` はPRでは契約10シナリオとローカルUI smokeを行う。mainへの統合後は `Deploy TSUGU` 成功を契機に、同じ10シナリオを再実行し、公開済みscenario manifest/indexの一致、公開UIの運用ガイド、GitHub Contents APIで同一blob SHAへ二つの更新を競合させるCAS検証を行う。

CAS検証では一方だけが成功し、もう一方が409/422で拒否されること、その後current blob SHAでretryすれば成功することを確認する。一時branchはfinallyで削除する。これにより同時更新で部分確定や静かな上書きが起きないことを実GitHubで確認する。

## 運用者の確認順

TSUGUの主要画面には `Stage B 運用ガイド` を置き、運用者は次の順に根拠を辿る。

- **目的**: Taskのsubject、purpose、固定version/hash。
- **変更**: PlannedChange → ActualChange → reconciliation。base/headと安定Path IDを確認する。
- **証拠**: Check → FINALIZED EvidenceVersion → Assurance/Event。同じRequirementSnapshot・target・generationであることを確認する。
- **未解決**: Issue、FAIL、UNKNOWN、unmapped change、active Hold reason。古いPASSを現在保証として扱わない。
- **次作業**: Task state、TaskDependency、必要Approval、repair Task、next taskを確認する。

運用ガイドはキーボードで開閉可能なnative `details/summary` とし、reload後も同じ確認経路へ戻れる。ガイド自体は業務状態を書き換えず、正本のversion/hash/generationを弱めない。

## 完了条件

B-07をPASSにするのは、PR前の10シナリオ契約検証だけでは足りない。main成果commitに対するPages Deployが成功し、そのDeployment後に `TSUGU Stage B MVP E2E` が成功し、10シナリオ証拠・公開物一致・UI smoke・実GitHub CAS競合の全結果をchange recordへ固定した時点とする。
