# Plan management API

Implemented in the plan-management branch. Apply migration 0004 before this API; it creates authoring state for every existing gym/branch/plan using its highest published version. Existing snapshots and selectable flags remain unchanged. The fresh demo seed also creates matching authoring rows. Production operations can create plans through these endpoints without running a seed.

All endpoints are under `/api/v1`, require an enabled account and an explicit owner/admin grant for the requested branch. No gym-wide owner permission is inferred. This uses the pilot registration permission policy; it does not introduce a separate pricing approval role.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/plans?branchId=...` | List authoring plans, draft and published |
| POST | `/plans` | Create draft; branchId in body |
| GET | `/plans/{planId}?branchId=...` | Current draft, version and available actions |
| PATCH | `/plans/{planId}?branchId=...` | Replace draft using current version |
| POST | `/plans/{planId}/publish?branchId=...` | Publish a complete draft using current version |
| GET | `/plans/{planId}/versions?branchId=...` | History of immutable offers and selectable flags |

Existing `/plan-versions` routes remain the registration picker's source. Drafts never appear there. List endpoints use signed actor/branch/filter-scoped cursors, ID ordering, limit 1–100 (default 25), and omit nextCursor at the end.

## Example

Create with Origin matching WEB_ORIGIN, authenticated cookies and a fresh Idempotency-Key:

```json
{
  "branchId": "your-branch-id",
  "draft": {
    "name": "Monthly Standard",
    "price": { "amount": "350000.00", "currency": "IDR" },
    "duration": { "value": 1, "unit": "month" },
    "benefits": ["Gym access"]
  }
}
```

An empty `draft: {}` is allowed. Supplied fields must be valid even in a draft. Publish requires all four fields; benefits may be empty. Money is a nonnegative DECIMAL(14,2) string; duration is an integer 1–2147483647 and unit day/month; at most 100 distinct benefit strings, each trimmed and 1–100 characters. Names are trimmed and 1–200 characters. Benefits describe the offer and grant no membership entitlements by themselves.

Create returns 201 (`data.plan`, commandId, replayed); replay returns 200. To publish, send `{"version": 1}` using the current `data.plan.version`. Publish returns `data.publishedVersion`, which can immediately be selected through the existing registration API.

Authoring `plan.version` is an optimistic concurrency counter, separate from `publishedVersion.version`. Every edit and publish increments the authoring counter. PATCH sends `{version, draft}` and replaces the entire draft (omitted fields are removed). Editing a published plan changes status to draft while the last published offer remains available. Publishing a published state without another edit returns INVALID_TRANSITION.

Each publish creates a new immutable ID and monotonically increasing published version for that gym/branch/plan. Previous versions remain selectable; this slice deliberately does not infer automatic retirement, expiry or price replacement. The management history includes the selectable flag. Registration detail and order prices remain frozen. A future explicit retirement operation can control availability; pending registrations must retain their snapshots.

## Retry and errors

All writes require Idempotency-Key and Origin. Edit/publish require current version. Retrying the same actor/branch/operation/key and payload returns the same command and original publication ID; `data.plan` is the current authorized state. After later publications, replay of an earlier publish still returns that earlier immutable `publishedVersion`. A changed payload under the same key returns IDEMPOTENCY_CONFLICT. Do not generate a new key on an unknown outcome.

STALE_VERSION includes currentVersion (409); refetch and let the user review changes before a new command. Invalid/incomplete draft values return VALIDATION_FAILED with fieldErrors (422). Invalid transition is 409. Missing permission is 403, absent plan is 404; authentication, Origin, size and service errors use the existing RegistrationError envelope. Publish and audit/outbox/receipt commit atomically; failed publish leaves no new version. Publish is serialized with registration mutations through the existing gym lock, including across admins.

No plan management FE UI, payment recording, activation, deletion, retirement or account provisioning is added here.
