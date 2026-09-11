# TSUGU Core vNext B-03 Task / Approval / Waiver / Decision / Issue Contract

## Scope

B-03 is an additive governance layer after B-02. It introduces first-class `Task`, `Approval`, `Waiver`, `Decision` and `Issue` records plus `GovernanceChangeSet` persistence.

B-03 deliberately does **not** publish Task Start/Resume/Complete yet. Those operations remain fail-closed until B-06 connects current Event/Assurance evaluation and performs the required last-moment revalidation.

## Task contract

A Task fixes a stable ID, Project, version, subject reference, purpose, start conditions, completion conditions, and separate start/final approval requirements. Start conditions never include the same Task's own completion output.

The Task plan has a SHA-256 `planHash`. Any plan edit increments the Task version and produces a different hash. Approval matching therefore requires the exact current Task version and hash; an approval for an older plan cannot be reused silently.

Runtime history is append-only in `TaskEvent`. B-03 records Hold, Interrupt, resolved Hold reasons, Resume requests and Cancel. Multiple Hold reasons remain independent: resolving one reason keeps the Task on `HOLD` while other reasons remain. `CANCELLED` and `DONE` are terminal for ordinary operations.

Actual `TASK_START`, `TASK_RESUME` and `TASK_COMPLETE` operations fail with `TASK_EVALUATION_NOT_AVAILABLE_UNTIL_B06` until B-06 supplies the current Event/Assurance gate.

## Approval contract

Approval is fixed to:

- approval type
- target type / stable ID / version / SHA-256 content hash
- Policy version
- authenticated approver subject
- actor kind and role
- approval time and optional expiry
- reason

Authority fields from operation payloads are rejected. The actor is supplied separately by the authenticated execution boundary. `humanRequired: true` is fail-closed for `AI`, `BOT` and `SYSTEM` actor kinds.

Approval revocation is an appended `ApprovalRevocation`; the original approval record and its content hash remain unchanged. Expiry is evaluated at use time, so no write is required for an approval to become ineffective.

## Waiver contract

A Rule-weakening Waiver fixes the proposed Rule version/hash, superseded Rule version/hash, exact scope, Policy version, expiry and reason. Its request projection is SHA-256 fixed.

Creating a Waiver requires an effective **human** `WAIVER` Approval whose target is the exact Waiver ID/version/request hash and Policy version. The Waiver remains independently revocable and expires by time. `assertRuleWeakeningWaiver` rechecks approval, scope, Rule versions/hashes, Policy, revocation and expiry at use time.

This establishes the B-03 Waiver authority contract without weakening B-02 by `supersedes` alone.

## Decision and Issue contract

Decision records are immutable content-hash-fixed versions with rationale and exact references. Superseding a Decision creates another version/reference rather than rewriting history.

Issue keeps source Check IDs and optional Task relation. Resolution updates the current Issue state while appending an `IssueEvent`; source failure references are not deleted.

## Persistence boundary

Persistent B-03 writes require `GovernanceChangeSet` with:

- Project
- base registry revision
- Git blob SHA
- idempotency key
- payload hash
- authenticated actor fixed separately from the payload

Validation replays the candidate with that actor and records both candidate hash and actor hash. Apply repeats validation, appends Audit and Outbox records in the same aggregate serialization, then performs GitHub Contents API blob-SHA CAS. 409/422 becomes `STALE_CHANGESET`. Successful readback is pinned to the exact write commit SHA and checked against the returned blob SHA.
