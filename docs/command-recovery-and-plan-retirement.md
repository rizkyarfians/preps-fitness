# BE handoff: version deactivation and command recovery

## Deactivate one published offer

`POST /api/v1/plan-versions/:id/deactivate?branchId=...`

Send `{}` with the matching `Origin` and a unique `Idempotency-Key`. An enabled owner/admin with an explicit branch grant may deactivate a version. The response is `{data:{commandId,replayed,planVersionId,selectable:false}}`.

This is a one-way transition. No delete or reactivation endpoint is provided. Publish a new version to offer the package again. Deactivation does not edit authoring drafts, authoring version numbers, latestVersionId, immutable offer snapshots, existing registrations or orders. Plan status `published` means publication history exists; it does not promise that the latest offer remains selectable.

- Available-offer lists exclude the version; available-offer detail returns `409 PLAN_UNAVAILABLE`.
- Version history still returns the original offer with `selectable:false`.
- New registrations, edits selecting the inactive version, draft submissions and clarification resubmissions return `409 PLAN_UNAVAILABLE`. Choose an available version and review its price before submitting.
- A registration already in `pending_review` can still be approved against its saved offer. Approval creates one order and does not activate membership.
- Same key retries return the original command ID without more audit/outbox events. Another key targeting an already inactive version returns `409 PLAN_ALREADY_INACTIVE`. Reusing a key for a different version returns `409 IDEMPOTENCY_CONFLICT`.
- Deactivation, create and submit share the existing gym transaction lock. If submit commits first, its snapshot is honored; if deactivation commits first, submit fails. No automatic repricing.

## Recover a completed command after reload

Before sending a mutation, FE must durably save this minimal metadata, partitioned by deployment/API origin and signed-in actor:

```json
{"branchId":"branch-id","operation":"registration.create","idempotencyKey":"client-generated-uuid"}
```

Use `sessionStorage` for reload recovery in the same tab. Do not save member details, mutation bodies, credentials or session tokens. If metadata persistence fails, do not dispatch a mutation that claims reload recovery. Clear or isolate metadata on account changes; keep it until the outcome has been reconciled. Cross-tab/browser-close recovery would require a separate persistence decision.

After reload or reauthentication as the same actor, call:

`POST /api/v1/commands/resolve` with the saved JSON, credentials and matching Origin. This is a read operation; no new Idempotency-Key header is needed. Do not put the original key in a URL.

Completed response example:

```json
{"data":{"status":"completed","commandId":"server-id","operation":"registration.create","result":{"resourceType":"registration","resourceId":"registration-id"}}}
```

Fetch the current registration detail using resourceId; do not recreate it. For plan commands resourceType is `plan` and resourceId is the plan ID. Publish/deactivate also include `planVersionId`; use version history to inspect an inactive version. Recovery identifies the original successful command, while resource detail reflects its current state, possibly changed by later commands. No original personal-data payload is returned.

Supported operations: `plan.create`, `plan.edit`, `plan.publish`, `plan-version.deactivate`, `registration.create`, `registration.edit`, `registration.submit`, `registration.review` (approve/reject/clarify share this operation).

Unknown response:

```json
{"data":{"status":"unknown"}}
```

Unknown means no completed receipt was observed for the exact actor/branch/operation/key. It can mean not sent, still delayed, rolled back, a wrong scope or a lost key. It is NOT a final failure/cancellation and must not enable a new-key automatic retry. A delayed original request can still commit after lookup. Keep the unresolved marker and allow another lookup. If the exact original body is still in memory, retry with the original key/body; after reload do not reconstruct or silently change the body. An unresolved case needs reconciliation before issuing a replacement command. This API does not cancel or replay writes.

Lookups use the same transaction lock ordering as writes and recheck the current enabled account and branch owner/admin grant. Another actor cannot retrieve the receipt; permissions revoked return 403. Invalid scope/key returns 422. No-store applies to all responses. Receipts currently have no TTL or cleanup; any future retention policy must define a compatible recovery window.

## Delivery boundary and verification

BE endpoints, OpenAPI and generated FE types are included. FE still needs to wire its metadata persistence, reload banner/resolver and deactivation control. Existing in-memory unknown-outcome handling is unchanged until that FE work lands.

API/MySQL scenarios cover authorization, actor isolation, restart recovery, failed/late commands, deactivation replay/conflicts, immutable history and order snapshots. The browser test intentionally discards a committed create response, reloads, then resolves using metadata only. Its storage/fetch code is a test harness, not product UI.

No database migration is needed: this uses existing `plan_version.selectable` and durable `command_receipt` rows.
