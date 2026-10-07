# Frontend integration review and membership contract proposal

Reviewed 7 October 2026. Integration evidence applies to PR #3 at `205baa2b1d00448188995a9aeb88b34e318f670b`. The membership design below is a proposal for FE, BE and product agreement, not an implemented or approved API contract.

## Integration review outcome

No blocking finding within the three requested acceptance criteria.

| Criterion | Code and evidence | Result |
| --- | --- | --- |
| All dropdown options display branch names | `/me.branchAccess[].branchName` in `apps/web/src/main.tsx`; API resolves names only for deployment-scoped grants. Missing branches are omitted. Mock and real-browser tests inspect every option before switching. | Pass |
| Focus refresh retains the current page | `refresh(true)` leaves the workspace mounted; its key depends on gym and user identity. Regression tests keep a DOM marker and selected Membership page through the request. Temporary failures retain the page and offer retry. | Pass |
| 401/403 remove private content | Refresh clears user and branch state for these statuses. Real tests revoke database sessions and disable gym access, then assert private navigation disappears. | Pass |

Completed workflows for the reviewed commit:

- [Frontend](https://github.com/rizkyarfians/preps-fitness/actions/runs/37485585725): dependency install, production build, generated-contract drift check, TypeScript and 12 browser regression scenarios passed.
- [Real browser integration](https://github.com/rizkyarfians/preps-fitness/actions/runs/37485585762): four scenarios with the actual API, MySQL 8.4 and Chromium passed, without response interception.
- [Backend foundation](https://github.com/rizkyarfians/preps-fitness/actions/runs/37485585603): passed.

This review inspected code and existing CI evidence; it did not rerun those workflows or deploy. The real-browser suite uses localhost HTTP and the desktop browser configuration, with a dispatched focus event. It is not evidence of actual tab switching on mobile or HTTPS reverse-proxy behavior. Existing mobile regression coverage uses mocked API responses.

## Staging handoff still pending

Follow `docs/staging-handoff.md`. Required inputs: hosting topology, approved web/API HTTPS origins, backend staging containing branchName, and synthetic staging accounts with permitted and forbidden branch access. Product/operations must arrange account provisioning; public signup is disabled.

`apps/web/src/api.ts` already reads `VITE_API_ORIGIN` and otherwise uses `window.location.origin`; the production source has no fixed localhost API fallback. Vite substitutes this variable at build time. A staging build must not reuse the artifact from real-browser CI, which deliberately builds with localhost.

After the domain is selected, build from a clean checkout with an explicit approved HTTPS `VITE_API_ORIGIN`, or deliberately omit it only for a verified same-origin `/api` proxy. Ensure no copied development `.env` supplies localhost. Confirm the selected value is an origin without an `/api` suffix. Record commit, artifact and non-secret origin configuration; inspect emitted JS/HTML and browser requests for localhost/127.0.0.1/[::1] destinations. Merely changing a hosting runtime variable does not alter an already built bundle.

Backend-first deployment remains required. The following is an unexecuted smoke plan, not a completed gate:

| Step | Desktop and mobile evidence required |
| --- | --- |
| Open HTTPS app | Correct domain/TLS, assets load, no mixed content or localhost requests; record browser/version and device |
| Login | Synthetic account reaches workspace; real session cookie uses Secure and HttpOnly; no credential logging |
| Choose branch | Every option has a name; switching shows matching branch data; forbidden branch request returns 403 |
| Switch tab or app and return | Membership page and branch remain selected after successful revalidation; repeat under a temporary network interruption |
| Revoke access/session | Using approved staging admin controls, prove 403/401 removes private content; do not run the destructive CI database suite on staging |
| Logout | Server confirms logout, subsequent `/me` returns 401, private content cannot return through refresh/back navigation |

Record pass/fail, timestamp, web/API versions and redacted evidence. Run on desktop Chrome and the agreed mobile browser/device; browser support is still a D01 decision. Any blocking failure prevents staging acceptance. No claim of G0 completion, load capacity, offline support or production readiness is made here.

## Proposed membership screens

Initial delivery focuses on registration and review, then order/payment and activation preview as their APIs become available. Member identity, registration review, payment and membership lifecycle are distinct resources and statuses. Approval creates one order; it does not activate membership.

| Screen | Proposed fields and displayed data | User actions | Page and domain states |
| --- | --- | --- | --- |
| Admin member/registration list | Search by name or member number; authorized branch; separate review and membership status filters; pagination. Rows show display name, member number if assigned, package snapshot, review/payment/membership status separately. | Search, filter, open detail; start registration if authorized | Initial loading, empty gym, no search matches, ready, background refresh, load error/retry, forbidden |
| Registration form | `fullName`, `email`, `phone`, `branchId`, `planVersionId`; display package name, duration, price, currency and benefit summary from the server's offer. Required contact fields and limits need product agreement. Existing-member flow references `memberId` instead of creating another identity. | Choose a published package, review summary, submit; edit and resubmit after clarification | Editing, invalid fields, submitting, submitted, clarification required, conflict, unknown submit outcome |
| Admin registration review | Registration ID/version, submitted identity/contact, branch, immutable offer snapshot, submitted time, clarification history. `clarificationMessage` required when asking for correction. | Request clarification; approve after confirmation; open resulting order | Pending review, clarification requested, resubmitted, approved with order reference; another admin changed it; access lost. Rejection/cancellation excluded until product agrees the transition. |
| Order and manual payment | Server order number, offer snapshot, amount due, currency, verification history. Payment input: `amountMinor`, `currency` fixed by order, `paidAt`, optional reference, private `proofMediaId` from upload/complete. Method and required metadata await product policy. | Upload/replace unsubmitted proof, submit payment; authorized admin verifies or requests correction with reason | Uploading, upload failed, submitted/unverified, verified, correction required, insufficient verified payment, amount/currency mismatch, timeout with unknown result |
| Activation preview and confirmation | `orderId`, expected version; show authoritative eligibility, effective start/end, timezone, benefits and warnings. Requested date input only if product permits it. | Request preview, inspect impact, confirm once; refresh expired preview | Ineligible with reason, preview loading/ready/stale, committing, successful upcoming/active status supplied by server, conflict/reconciliation |
| Member membership detail | Package snapshot, authoritative status, start/end, branch scope, available benefits, order/payment summary and permitted timeline events | View status/history, supply clarification or payment where authorized, request renewal when available | No membership, upcoming, active, frozen, expired, cancelled; unavailable feature with reason |
| Membership change preview | `membershipId`, expected version, action; optional target plan/version, requested dates and reason only as permitted by that action's agreed policy. Show server-calculated dates, amount impact and benefit impact. | Preview then confirm renewal/freeze/resume/cancel/upgrade where explicitly allowed | Action unavailable with reason, editing, preview ready/stale, submitting, success, conflict; policies unresolved means disabled |

Do not include medical assessment, complaints, body photos, national ID or date of birth in this first operational registration form without a separate approved requirement. Do not offer direct edits to activation/expiry or a manual "mark active" control.

## Role and interaction rules

- Member sees only their records and permitted self-service actions. Admin sees operational registration/payment/membership data for authorized branches. Owner permissions are explicit, not inferred from the label. PT has no membership mutation privileges unless separately granted.
- Request proposed `allowedActions` and disabled reason codes per resource from the backend. These drive presentation; every mutation must still be authorized server-side. Do not derive privileges from only the first role in `branchAccess`, because an account may have multiple grants for the same branch.
- Keep editable values in component memory during background revalidation. Prompt before navigation or branch switching with unsaved edits. Clear sensitive values on confirmed account/session loss; no personal-data localStorage cache. Cross-login draft recovery requires a separate agreed policy.
- Cancel/ignore old list/detail requests on branch or account changes. Scope caches by gym, user, branch and resource. Preserve list filters and page state across successful focus checks.
- Disable duplicate submission while pending. A timeout is an unknown outcome, not proof of failure; reconcile with the server before offering a new business command.
- Use field-level messages plus a form summary; focus the first invalid field. Keep a visible success confirmation and link to the resulting resource. Mobile uses labelled inputs, touch targets of at least 44px and no horizontal form scrolling.

## API data and operation proposal

Endpoint names and payload shapes below are negotiation inputs; none are claimed to exist. Finalize them in OpenAPI with BE before building business forms.

| Operation family | FE request needs | BE response needs |
| --- | --- | --- |
| Published offers and lists | Authorized branch, cursor/page, search/filter; no gym authority taken from client input | Stable IDs, display names, immutable plan version, offer price/currency/duration/benefits, pagination metadata |
| Create/update/submit registration | Identity/contact or existing member reference, branch, selected plan version; expected version for edits | Registration ID, server snapshot, review status, version, field errors, allowed actions; approved result references the single order |
| Clarify/approve | Registration ID, expected version, clarification text where relevant, idempotency key | Authoritative new state and order reference; conflict response if already changed |
| Private proof upload and payment submission | File metadata for upload intent; complete confirmation; payment data and finalized media reference | File constraints, authorized short-lived access, upload completion, payment ID/version and verification state |
| Verify payment | Payment ID, expected version, decision and correction reason as agreed | Verified totals, remaining balance, currency, payment state and activation eligibility |
| Preview/commit activation or membership change | Resource ID/version, action inputs; commit references preview token/version and idempotency key | Server-calculated impact, preview expiry, policy reason codes; commit revalidates and returns final state, timestamps, resource version and command/receipt reference |
| Membership detail/history | Member or membership ID and permitted filters | Independent registration/payment/membership statuses, immutable offer, benefits, permitted events, allowed actions, version and `asOf` |

Shared conventions to agree:

- Money is integer minor units plus ISO currency, never binary floating-point totals; server supplies precision/formatting rules where necessary. Date-only input is `YYYY-MM-DD`; timestamps include an explicit offset or UTC and the gym timezone is supplied for display. FE does not calculate contractual expiry dates.
- Reuse the established response envelope and `error.reasonCode`/`requestId`. Propose field errors for validation, 409 for stale versions or incompatible idempotency replay, and action-specific eligibility reasons; BE must define exact enums and HTTP statuses.
- Generate one idempotency key per confirmed logical action. Retry the same unchanged action with the same key; edited input is a new action after outcome reconciliation. Agree receipt/status lookup semantics before showing automatic retries. The backend command runner currently provides infrastructure, not a generic public command endpoint.
- Include realistic success, loading, empty, validation, conflict, 401/403, rate-limit and timeout fixtures in the agreed contract. Amount mismatch, stale preview, duplicate click and two-admin scenarios need FE/BE integration coverage.

## Product decisions required before implementation

| Decision owner | Decisions to close | FE consequence while unresolved |
| --- | --- | --- |
| Product and gym — registration | Required contact fields, duplicate identity handling, self-registration access/provisioning, clarification/rejection/cancellation transitions | Do not silently require phone/email combinations or expose public signup |
| Product and gym — activation/payment | Accepted payment methods, proof requirements, adjustment/overpayment rules, start-date authority, timezone/cutoff, partial payment eligibility | Display server reasons; do not invent eligibility or default activation dates |
| Product and gym — renewal | Duration, overlap, early renewal, carry-forward and payment effect | No FE date arithmetic or automatic renewal rule |
| Product and gym — freeze/resume | Eligibility, limits, duration, fee, expiry extension and effective-time rules | Keep actions disabled until policy and preview contract exist |
| Product and gym — cancel/upgrade | Refund/proration, effect on existing period/benefits and effective date | No arbitrary amount or entitlement changes |
| Product/data owner — D03 | Consent wording/purposes, proof/contact retention, deletion/export and access | No assumed consent or unapproved personal-data collection |

Next contract review should lock the registration/review slice first, including fixtures and acceptance for submit → clarification → resubmit → approve → one unactivated order. Payment and activation follow after the relevant D02 decisions. This document does not decide activation, renewal or freeze policy for the product team.
