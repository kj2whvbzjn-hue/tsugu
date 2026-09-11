# TSUGU Core vNext C-01 — Impact Graphとrelation別伝播

C-01はStage Bの保守的失効を削除しない。B-01〜B-06で確立したstable PathEntry、ArchitectureBindingV2、TestRequirement、RequirementSnapshot、ActualChangeを使い、判定できる変更だけをrelation別に狭める。判定不能は従来どおり同一Projectの関連Repository・Architecture範囲のFull testへ戻す。

## 入力と正本

`static/core-impact-graph.js` は永続状態を新設せず、次の正本から決定論的な `ImpactGraph` を派生する。

- `StageBRuleTestRegistry`: Box registry、Architecture、active TestRequirement、TestDefinition、Effective Rule由来を含む。
- B-05 `ActualChange`: repositoryId、changeType、stable pathEntryId、mappingStatusを使用する。
- 明示 `changeFacts`: RuleDefinition、RuleBinding、ArchitectureBinding、TestDefinition、未分類変更を表す。

Impact Graphは入力を書き換えず、`impactHash` で同じ入力から同じ結果になることを固定する。Health・cache・差分再計算はC-02の責務であり、C-01には含めない。

## relation別伝播

ArchitectureBindingの有効期間は評価対象Architecture revisionで判定する。Node BindingはそのNode配下のArchitecture Nodeに属するBoxInstanceへ、BoxInstance BindingはそのBox subtreeへ伝播する。その範囲のactive TestRequirementだけを候補にする。

- `IMPLEMENTS`: 対象Requirementを実装変更として再検証する。
- `CONFIGURES`: 対象Requirementを構成変更として再検証する。
- `MIGRATES`: 対象Requirementを移行変更として再検証する。
- `TESTS`: 対象範囲の検査要求とそのTestDefinition版だけを再検査対象にする。別Node/Boxや別TestDefinitionの無関係Requirementを一律に実装失効させない。

結果はrelationごとに `requirementIds`、`testDefinitions`、source、required actionを分けて保持する。Path→Binding→設計対象→TestRequirementのedgeも出力し、なぜ影響したかを辿れるようにする。

## Rule・Binding・TestDefinition変更

RuleDefinition変更は `TestRequirement.effectiveRules.sources` のRuleDefinition ID/versionと照合する。RuleBinding変更は既存のeffective-rule provenance、または明示された前後Binding targetから対象Requirementを求める。ArchitectureBinding付け替えは前後targetの双方を評価する。TestDefinition変更はそのID/versionを固定参照するRequirementだけを `TESTS` として再検査する。

変更対象を特定できないRuleBinding/ArchitectureBindingは「影響なし」にしない。Full testへ送る。

## Full test fallback

次はtargeted判定を諦め、同一Projectの関連Repository・Architecture範囲を `fullTestScopes` に明示する。

- `UNMAPPED` Path
- rename元を確認できない `CONFIRMATION_REQUIRED`
- `UNKNOWN` / 未分類変更
- stable PathEntryはあるがactive ArchitectureBindingがない変更
- RuleBinding / ArchitectureBinding変更のtargetを確定できない場合

Full test scopeは別Projectへ拡大しない。Repositoryに有効Bindingがある場合はそのtarget範囲を列挙し、Binding自体が不足する場合もProject内のArchitecture範囲を明示して安全側へ倒す。

## 削除・rename

削除でもB-05がstable PathEntry IDを確定できていれば、そのIDに紐づくrelationを使用する。GitHubがexplicit rename元を返しB-05が `MAPPED_RENAME` とした場合も旧stable IDを維持してtargeted判定できる。rename元不明ではpath名からIDを推測せずFull testへ戻す。

## 検証

`tests/core-impact-graph.test.cjs` は4 relationの独立伝播、TESTSの非過剰失効、明示rename、削除、Binding不足、Rule/Binding/TestDefinition変更、Full test fallback、決定性、Project越境拒否を固定する。

`.github/workflows/impact-graph-e2e.yml` はPRでこの契約を実行する。main統合後はPages公開物が成果commitと一致することを確認し、実GitHub上に一時branchとbase/head commitを作成してB-05 `captureComparison` を実行し、そのActualChangeをC-01へ渡してstable PathEntry→TESTS relation→Requirementの実フローを確認する。
