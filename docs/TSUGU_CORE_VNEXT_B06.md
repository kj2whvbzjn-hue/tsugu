# TSUGU Core vNext B-06 — Assurance / Event / Task Dependency

B-06 は B-05 後の実行保証層を追加する。既存 B-03 Governance の Task/Approval/Hold/Issue 履歴を正本のまま利用し、Assurance と Event の評価世代を Task 実行状態へ接続する。

## 1. Assurance の評価単位

AssuranceEvaluation は Project、subject+version+hash、RequirementSnapshot、target(COMMIT/DEPLOYMENT)、evaluation generation を固定する。PASS Check を採用する場合も、Check と FINALIZED EvidenceVersion の subject / RequirementSnapshot / target が完全一致していなければ VALID にしない。

現在 generation に VALID が無く旧 generation の VALID だけがある状態は STALE とする。同期状態が RECALCULATING / UNKNOWN の間は current assurance を UNKNOWN とし、Task の開始・Resume・完了には使用しない。

## 2. 保守的失効

変更を検知したら beginEvaluationGeneration で generation を単調増加させ、syncState を RECALCULATING にする。旧 generation の Event ESTABLISHED は履歴として残し、新 generation に REVOKED occurrence を記録する。遅延した旧 generation の PASS は履歴保存できるが、current Event を再成立させない。

## 3. Event と TaskDependency

EventDefinition は version、subject、RequirementSnapshot、target を固定する。Event は current generation の完全一致 VALID Assurance によってのみ ESTABLISHED になる。

TaskDependency は Task -> EventDefinition(version) を明示し、複数依存は AND とする。EventDefinition.producerTaskId による Task -> Event 辺と TaskDependency の Event -> Task 辺を合成して循環検査し、直接・間接の Task/Event cycle を拒否する。

## 4. Task 実行ゲート

B-03 が B-06 まで無効化していた start/resume/complete は core-task-execution.js で公開する。

- DRAFT submit: 開始条件成立なら READY、未成立なら BLOCKED
- READY の依存失効: BLOCKED
- BLOCKED の依存回復: READY（手動 Hold/Cancel は別）
- READY start: 正本を再検証して IN_PROGRESS。失敗時は拒否
- IN_PROGRESS の依存失効/再計算待ち: HOLD。理由は複数保持
- HOLD: B-06 起因理由が解消しても自動 Resume しない。全 Hold 理由解消後の明示 Resume で再検証
- IN_PROGRESS complete: completionConditions、requiredCompletionApprovals、current evaluation を再検証して DONE
- DONE 後の保証失効: DONE 履歴を変更せず Issue と repair Task を作る

## 5. 永続化と競合

AssuranceExecutionChangeSet は aggregate revision、Git blob SHA、Governance revision、Assurance/Event revision、evaluation generation を base として固定する。Validation と Apply の双方で再実行し、Git Contents API の sha CAS と readback を行う。

Assurance/Event 更新と Task 状態遷移は同一 AssuranceExecutionAggregate の候補状態として確定する。世代・revision・blob のいずれかがずれた ChangeSet は STALE_CHANGESET として拒否する。

## 6. B-06 受入境界

受入には少なくとも次を含む。

- exact-scope PASS + FINALIZED Evidence のみ current VALID
- 変更後の旧世代 PASS が current Event を復活させない
- Task/Event 複合循環を拒否
- READY -> BLOCKED、IN_PROGRESS -> HOLD、複数 Hold 理由保持
- explicit Resume と start/complete 直前再検証
- final Approval 不足時の完了拒否
- DONE 履歴維持と repair Issue/Task
- aggregate revision/blob/generation CAS
- GitHub Pages 公開物と repository-integrated E2E の一致
