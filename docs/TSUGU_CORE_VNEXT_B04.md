# TSUGU Core vNext B-04 — Check / Evidence / EvidenceVersion

**Baseline:** `e270084e68e74df9d61be2407ab5c33100ce7f8b` (B-03 result remains `92dc673ba28b8dea3bbb08bbc7a43d646a0b8583`)  
**Depends on:** B-03 PASS  
**Storage model:** immutable GitHub Contents path, SHA-256 + size + Git blob SHA readback

## 1. Scope

B-04 introduces first-class `Check`, `Evidence` and `EvidenceVersion` contracts without reusing legacy `items` or introducing D1/R2/server runtime dependencies.

Evidence bytes are stored separately from the Project aggregate. An `EvidenceVersion` reserves the exact subject, RequirementSnapshot, target, immutable object path, expected SHA-256 and expected size before the bytes are treated as usable evidence.

## 2. Evidence lifecycle

`EvidenceVersion.status` is one of:

- `RESERVED`: metadata and immutable path are fixed, object is not yet trusted.
- `STORED`: Git write is recorded but readback verification is not yet complete.
- `VERIFIED`: Git readback matched SHA-256, size and Git blob SHA.
- `FINALIZED`: verified evidence is eligible for Check references.
- `FAILED`: a failed storage/verification attempt is retained as history.

A PASS Check may reference only `FINALIZED` EvidenceVersion records whose subject, RequirementSnapshot and COMMIT/DEPLOYMENT target exactly match the Check.

## 3. Immutable Git storage

`core-evidence-storage.js` uses GitHub Contents API with immutable versioned paths:

`evidence/<project>/<evidence>/versions/<version>/<sha256>.bin`

The storage receipt fixes repository, branch, path, content SHA-256, size, Git blob SHA, write commit SHA, readback commit SHA and timestamps. Existing content is accepted only when the bytes exactly match the reserved SHA-256 and size. A conflicting existing object is rejected instead of overwritten.

The storage layer supports reconciliation for upload-success/metadata-failure recovery. Missing or mismatched content never becomes PASS implicitly.

## 4. Check history and FAIL resolution

Checks are immutable historical observations. FAIL is not deleted or rewritten to PASS. A later PASS may explicitly list `resolvesCheckIds`, but only within the same subject, RequirementSnapshot and target scope.

The current Evidence version advances monotonically. A delayed retry/finalization of an older version cannot move `currentVersion` backward.

## 5. Persistence boundary

Persistent B-04 metadata changes use `CheckEvidenceChangeSet`:

- base Project revision and Git blob SHA are fixed;
- operations cannot supply actor/role authority fields;
- validation binds the authenticated actor independently;
- Apply uses GitHub Contents API CAS;
- Audit and Outbox records are appended with the aggregate change;
- stale blob/revision and actor mismatch fail closed.

Direct persistent writes outside this ChangeSet boundary remain disabled.

## 6. B-04 acceptance

B-04 is accepted when:

- isolated contract tests pass;
- published B-04 modules equal repository sources;
- immutable Git storage performs actual write and readback with SHA-256/size/blob verification;
- CheckEvidenceChangeSet performs repository-integrated CAS Apply/readback;
- unfinalized/mismatched Evidence cannot support PASS;
- FAIL and retry history remain preserved;
- no D1/R2/Worker/server fallback is introduced.

## 7. Handoff to B-05/B-06

B-05 may reference immutable Check/Evidence targets while implementing PlannedChange / ActualChange. B-06 must consume only PASS Checks whose RequirementSnapshot, target and evaluation generation match its Assurance contract. B-04 does not itself authorize Task Start/Resume/Complete.
