# Registration contract v0.2

OpenAPI in `packages/contracts/openapi.yaml` is the source for payload shapes, lengths and generated FE types. All new registration operations have `x-implementation-status: planned`. Existing auth, /me and branch detail remain live; this PR does not add registration HTTP handlers. FE can implement against mocks of the new contract; real submission must stay disabled until handlers are released.

## Profile migration

Migration 0002 makes member.user_id nullable, adds identity/contact columns and a direct gym foreign key. The existing unique (gym_id,user_id) constraint still prevents two profiles for the same linked account; MySQL permits multiple unlinked profiles. The composite gym/user FK still prevents linking to another gym's account. Phone/email are intentionally not unique identity keys. Existing rows retain their IDs and login links; new columns are nullable because historic address/birth data cannot be invented. Read operations must flag incomplete legacy profiles; submission returns PROFILE_INCOMPLETE until an authorized profile update supplies required data. This PR does not provide profile-edit or invitation endpoints. Account linking must use verified invitation ownership, never admin-entered email alone.

Deploy migration before any code writing profile columns. Back up first. Rollback cannot restore NOT NULL after unlinked profiles exist without an explicit data reconciliation; do not drop profiles to make rollback pass.

## Validation and clock

Full name 1–200, address 1–1000, birthplace 1–120, email <=254, reasons 1–1000 characters. Trim text before validation; whitespace-only required text is invalid. Optional empty birthplace/email are omitted on requests, never empty strings. Phone is canonical international + followed by 8–15 digits; convert Indonesian 08 input only with explicit country selection. Use a phone parser at the UI boundary; server rejects noncanonical payloads. No verification of WhatsApp ownership is implied.

Birth date is a real calendar date including leap-year validation; it must not exceed server context.today. The planned context endpoint returns the configured IANA gym timezone, server today and asOf. The registration runtime must require explicit valid GYM_TIMEZONE (e.g. Asia/Jakarta), not infer it from a browser or hard-code the user's chat timezone. No date-to-UTC conversion for SQL DATE and no age threshold in this slice. FE refetches context after a day rollover and server validates every write.

Prices are nonnegative DECIMAL(14,2) strings, maximum 999999999999.99, canonical two fractional digits and explicit currency. Offers are server-owned. A duration describes the selected plan, not authority for FE to calculate activation/expiry. No payment, proration or currency-conversion policy is introduced here.

## Authorization and state

For the pilot, an enabled user with an explicit owner OR admin grant for the branch has operational entry and review permission. Aggregate every grant in that branch; pt/member grants confer no registration mutation privileges. Self-review is allowed with review permission and submitter/reviewer are audited separately. No owner-wide access inferred across other branches. The planned context returns create permission; each resource returns allowedActions after server authorization. Client allowedActions is presentation, never authorization.

| Current status | Permitted operations with branch permission | Next status |
| --- | --- | --- |
| New | create | draft |
| draft | edit, submit | draft / pending_review |
| pending_review | approve, reject, clarify | approved / rejected / needs_clarification |
| needs_clarification | edit, submit | needs_clarification / pending_review |
| approved, rejected | read only | unchanged |

Admin form may create then immediately submit, but must retain the returned draft ID and reconcile failed/unknown submit outcomes. Approval atomically creates exactly one order; orderId appears only on approved registration. It never grants membership or login access. Reject/clarify need nonblank reasons and create no order. Retain immutable submitted snapshots and review history. Profile edits are a separate resource: corrections to an existing member's registration snapshot never silently overwrite the shared profile. Incomplete existing profiles must be corrected through the future profile API before submission.

Published plan versions never change in place. Lists expose only published versions selectable in the requested branch. Draft selections revalidate on submit; if no longer offered return PLAN_UNAVAILABLE. Pending review uses the frozen submitted offer, including price, so later publication changes cannot reprice a pending registration. A new published version is a new ID.

## Duplicates and retry

POST member-candidates is a read-only check with identity in the body, not the URL. Its opaque check ID is scoped to actor, gym, branch and normalized identity and expires after 10 minutes. At create/submit, server rechecks current candidates and returns DUPLICATE_CHECK_STALE if a distinct-person resolution's candidate set or identity has changed. Restricted matches never expose identity details and cannot be bypassed by a distinct-person reason; an authorized reviewer must resolve them. No automatic merge or login link based on contacts/name/date.

Only one pending_review/needs_clarification registration per resolved member and branch may exist, enforced in a transaction across different admins/idempotency keys. Multiple drafts can exist; submit enforces this invariant. If a conflicting existing registration is outside visibility, return a generic conflict without its identity fields.

All mutations require Idempotency-Key and edits/reviews/submit require current version. Same actor/branch/operation/key and payload replay returns the original command result after current authorization; a different payload returns IDEMPOTENCY_CONFLICT. A pending command returns COMMAND_IN_PROGRESS; reconcile by retrying the SAME request/key with backoff. Do not generate a new key on unknown outcome. Concurrent review uses a version check and domain row lock; exactly one decision/order wins. Preserve the original key through 503/network errors and refetch detail after 409. No generic receipt endpoint is promised.

## Errors and FE behavior

All new errors use RegistrationError, with reasonCode, requestId, retryable and optional fieldErrors/currentVersion. Never include submitted PII or raw database errors.

| HTTP | Reason codes | FE behavior |
| --- | --- | --- |
| 400 | VALIDATION_FAILED | Correct malformed body/key; no retry unchanged |
| 401 | UNAUTHENTICATED | Clear private state, login |
| 403 | ACCOUNT_ACCESS_DENIED, BRANCH_ACCESS_DENIED, ACTION_NOT_ALLOWED | Clear/restrict private UI; no automatic retry |
| 404 | NOT_FOUND | Resource absent or not visible; no enumeration |
| 409 | STALE_VERSION, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT, COMMAND_IN_PROGRESS, DUPLICATE_REVIEW_REQUIRED, DUPLICATE_CHECK_STALE, EXISTING_REGISTRATION, PLAN_UNAVAILABLE | Reconcile/refetch; COMMAND_IN_PROGRESS alone is retryable with same key |
| 422 | VALIDATION_FAILED, PROFILE_INCOMPLETE | Show field errors or profile correction requirement |
| 429 | RATE_LIMITED | Honor Retry-After |
| 503 | SERVICE_UNAVAILABLE | Retryable with same key; unknown outcome is not failure proof |

List pagination uses opaque cursor, limit 1–100 (default 25) and nextCursor omitted at end. Scope cursors to gym/actor/branch/filter and deterministic createdAt/id ordering. Registration lists contain no address, birth date, phone or email. Authorized detail alone exposes the full snapshot. Audit/outbox contain resource references, not raw profile bodies. Pending D03 retention/consent decisions still apply to release.
