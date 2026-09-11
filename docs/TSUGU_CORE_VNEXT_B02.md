# TSUGU Core vNext B-02 Rule / Test / Requirement Contract

## Scope

B-02 is an additive Stage B layer on top of the B-01 `StageBBoxRegistry`. It does not rewrite the existing Stage A/B-01 storage flow or `app.js` save path.

It introduces:

- `RuleDefinition` and `RuleBinding`
- comparable Rule intersection and conservative `CONFLICT`
- immutable Published `TestDefinition`
- `RequirementSource` and derived `TestRequirement`
- separate `ManualRequirementEdit`
- `RequirementSnapshot` with distinct `DRAFT` and `FINAL` states
- `RuleTestChangeSet` with GitHub Contents API CAS apply

## Rule contract

The MVP evaluates only comparable constraint families:

- `REQUIRED`
- `PROHIBITED`
- `ALLOWED_SET`
- `MIN`
- `MAX`

`OPAQUE` text can be stored for traceability, but the engine never infers semantic strength from it. Any effective set that contains opaque or otherwise incomparable constraints becomes `CONFLICT`.

Parent and child constraints are combined by intersection. Allowed sets intersect, minimums take the highest lower bound, maximums take the lowest upper bound, and contradictory presence/range constraints become `CONFLICT`.

Every effective result retains the exact source Rule version, binding ID, content hash, source BoxInstance and inheritance path.

A Published Rule is content-hash fixed. A new Rule version may declare `supersedes`, but publish is rejected if the new version cannot be proven at least as strict as every superseded version. B-02 has no waiver escape hatch: `WAIVER_NOT_AVAILABLE_UNTIL_B03` is fail-closed.

## Test and Requirement contract

Published `TestDefinition` content is SHA-256 fixed. A `RequirementSource` fixes:

- source BoxDefinition ID and version
- TestDefinition ID and version
- applicability scope (`SELF` or `DESCENDANTS`)

Requirement derivation uses a deterministic generation key based on source, target and definition versions. Re-running derivation with unchanged inputs does not create duplicates or increment the TestRequirement version.

Generated fields and human edits are deliberately separated. `ManualRequirementEdit` may carry note/priority/labels but cannot override generated Rule, source, target, test or evaluation fields. When generated content changes, the stable requirement ID is retained and the generated TestRequirement version advances; the manual edit remains attached to the stable ID.

Requirements that are no longer generated are retained as `RETIRED` rather than silently deleted.

## RequirementSnapshot gate

A Draft snapshot freezes the current requirement references and can be saved even when an effective Rule result is `CONFLICT`. This supports work-in-progress inspection without treating a draft as an approved result.

Finalization is a separate gate and requires:

- at least one requirement
- every referenced TestRequirement is still ACTIVE at the same version/hash
- every effective Rule result is `VALID`

A FINAL snapshot fixes, by SHA-256 content hash:

- TestRequirement ID and version
- source BoxDefinition ID/version
- TestDefinition ID/version and content hash
- Effective Rules and source Rule versions
- inheritance paths
- evaluation conditions

A conflict therefore remains storable as a Draft but cannot pass the FINAL gate.

## Persistence boundary

Persistent B-02 writes require `RuleTestChangeSet`. The ChangeSet fixes project, base revision, Git blob SHA, idempotency key, payload hash and deterministic operation timestamps.

Apply revalidates the candidate immediately before write, then performs a single GitHub Contents API CAS update for one aggregate. Audit and Outbox records are serialized in the same aggregate commit. HTTP 409/422 is normalized to `STALE_CHANGESET`; no partial application is accepted.

Successful readback is pinned to the exact write commit SHA before validating the returned blob, avoiding branch-reference propagation lag.
