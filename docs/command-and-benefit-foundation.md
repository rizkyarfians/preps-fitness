# Benefit and transaction foundation

This Sprint 0 slice adds a pure benefit evaluator and a MySQL command runner. It does not implement membership activation, payment verification, quota sales, or an event dispatcher.

## Benefit facts and integration boundary

`evaluateBenefit` accepts trusted repository facts. It checks enabled gym access, an explicit branch grant, a known benefit code, matching gym/user facts, an enabled gym capability, and an active, non-revoked member grant covering that branch and timestamp. The time interval is start-inclusive and end-exclusive. Date conversion/timezone and commercial rules remain the membership module's responsibility. Roles, including owner, never imply a purchased member benefit.

Supported initial codes are `tutorial.view` and `personal.training`. Unknown codes and missing facts deny access. Frozen, expired, cancelled and upcoming grants deny NEW protected operations. This does not decide how an already-running personal session behaves on freeze/expiry; D02 must settle that policy first. Consent and PT assignment checks are additional requirements for personal operations, not replaced by this benefit check.

No production source of membership facts exists yet. `/me.entitlements` therefore remains empty. Do not load client-provided facts or expose a grant-edit API. Connect the evaluator only after immutable offers, verified payment and atomic activation produce authoritative grants. Recheck facts inside the protected command transaction; a previous `/me` response or preview is not authorization.

## Atomic command runner

Construct `createCommandRunner(db, deploymentGym)` with trusted deployment configuration. Take actorId from the authenticated session, validate operation-specific input before passing its normalized JSON payload, and require an idempotency key from the caller. A scope comprises gym, actor, branch, operation and key. The persisted scope and payload are SHA-256 hashes; raw request bodies and keys are not stored.

The runner locks the gym account and explicit branch grants, rejects disabled or unrelated access, and invokes the REQUIRED action-specific `authorize(tx)` callback even on replay. The callback must verify current permissions/benefits using the supplied transaction and throw when access is denied. The runner then inserts/locks a receipt. A completed receipt with the same payload returns its stored JSON result; changed payload returns `IDEMPOTENCY_CONFLICT`.

`execute(tx, payload)` receives a normalized copy of the hashed JSON input. Perform all domain writes on that transaction. Return a small JSON result, resource ID and unique event types. The wrapper writes one audit record, zero or more outbox records, and the completed receipt before committing. Any error rolls all of this back. Events contain references only, not health/assessment payloads.

Lock order is account, branch grants, receipt, then domain rows. Where action authorization itself must lock domain records, choose one consistent order across all commands and review it for deadlocks. Receipt idempotency only deduplicates the SAME scoped key. Different keys/admins still require domain uniqueness constraints and/or row locks. The disposable last-slot test demonstrates this distinction with two admins, distinct keys and one locked domain row.

MySQL deadlock/lock-timeout errors propagate after rollback; there is no invisible server retry. Future HTTP handlers should map these recognized transient conditions to a retryable response and clients retry with the SAME key. Do not retry arbitrary errors or change payloads under an existing key. There is no generic public command endpoint in this slice.

## Audit and outbox limits

Audit records contain actor, operation, resource and command reference. They are inserted once per successful command; failed attempts are not success audits. There are no application update/delete routes for audits. Production DB roles/retention controls still need deployment configuration; this is not tamper-proof storage.

Outbox enqueue is atomic, but delivery is NOT implemented. A later dispatcher needs worker claims/leases, retries, observability and consumer deduplication using the stable event ID. External sends must never run inside `execute`; an SQL rollback cannot undo an email or provider call. At-least-once delivery requires idempotent consumers; this helper does not promise exactly-once external delivery.

No cleanup job is enabled. Receipt retention must be at least 30 days and cover all legitimate offline replay before D03 authorizes deletion. Keep receipt results minimal because they are retained and replayed. Error mapping and final response schemas will be specified for each domain route.

## Evidence

Unit tests cover benefit dates/status/scope and canonical payload hashing. MySQL integration scenarios cover concurrent identical retries, conflicting payloads, reauthorization on replay, failed domain writes, failed outbox writes, fresh retry after rollback, two-admin last-slot contention, and wrong gym/branch denial. The slot table exists only in the disposable integration database; it is not a production PT quota schema.

## Frontend handoff

Continue integrating login/logout and `/me` using the existing contract. Do not show paid features as available while entitlements are empty. Use one idempotency key per user intent once mutation routes are added; retain it through transport retry, and create a new key for a genuinely changed request. Mutation routes and their status/error contracts are still pending; do not guess endpoint URLs.
