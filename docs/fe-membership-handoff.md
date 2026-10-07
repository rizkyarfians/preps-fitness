# Frontend integration review and membership contract proposal

Reviewed 7 October 2026. Integration evidence applies to PR #3 at `205baa2b1d00448188995a9aeb88b34e318f670b`. The membership design below follows the SA handoff where it already fixes the contract; remaining field details require FE, BE and product agreement. It is not an implemented business API.

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

## SA contract alignment

Source: `Gym_Planner_Backend_Frontend_Execution(1).docx`, engineering handoff v2.0 dated 4 October 2026: section 2 (Standard data model), registration state table, Standard endpoint table and `/admin/registrations` screen requirements. Verified 7 October 2026.

The SA handoff takes precedence over this FE proposal. These two requirements are already specified and are not open product decisions:

- All monetary values backed by DECIMAL travel as JSON strings with `currency`. For example, `{ "amount": "250000.00", "currency": "IDR" }`; this example does not mandate a two-digit scale. There is no `amountMinor` integer field or implicit minor-unit conversion. Apply the convention to prices, payment amounts, adjustments, verified totals, remaining balances and monetary preview impacts. Never combine different currencies.
- Registration review supports approve, reject and clarify. The state transitions are `pending_review → needs_clarification → pending_review` and `pending_review → approved/rejected`. Review stores actor, reason and time. Approval creates the order and does not activate access; reject/clarify must not create an order or active membership. Reopening/resubmission after rejection is not defined by this transition table and must not be silently enabled.

Use the SA review route `POST /registrations/{r}/review` with `decision`, `reason`, and `version`; the decision values are `approve`, `reject`, and `clarify`. Server identity supplies the actor and server time supplies the review timestamp. The FE requires a nonblank reason and a confirmation before sending a rejection. BE enforces authorization, transition validity, version checking and idempotency; another admin's completed decision is a conflict to refresh, not permission to overwrite it.

## Pilot decision: admin-entered registration

Confirmed by product on 7 October 2026: admins enter registrations for the initial pilot. The pilot FE scope is an admin registration list, entry form and review detail; public self-registration is outside this delivery.

1. An authorized admin selects a permitted branch, enters the prospective member's identity/contact or selects an existing member, and chooses a published plan version.
2. Admin reviews the summary and submits. The registration enters `pending_review`; admin entry does not imply approval or activation.
3. For `needs_clarification`, admin obtains corrected information, edits the permitted fields and resubmits through the SA submit operation, returning the registration to `pending_review`.
4. An authorized reviewer can approve, reject or request clarification. Approval creates one order without activating membership. Rejection remains read-only with its reason and review history.

For the initial pilot, an admin may review their own submission only when they also hold review permission for that branch. Entry permission alone does not confer review permission. Store submitter and reviewer separately even when they are the same person. Actor identity and audit timestamps come from the server, not editable FE fields.

Registration capture and member login provisioning are separate contracts. A registration/member profile can exist without a login account. After approval, account creation/linking uses a separate invitation and verified-email flow; possession of an authenticated account and ownership of the invitation must be checked before linking. Admin-entered email alone is not proof of account ownership. Invitation delivery and acceptance are still unimplemented. FE must not invent passwords, expose signup, or assume registration approval creates login access. Member-facing screens below describe later authorized account access and are not part of the initial admin-entry slice.


## Registration data baseline — product confirmation, 7 October 2026

The product owner added address and place/date of birth and accepted the following requiredness. This supersedes the earlier exclusion of date of birth from this form.

| API field | FE label | Required | Contract and validation |
| --- | --- | --- | --- |
| `fullName` | Nama lengkap | Yes | Trim surrounding whitespace; reject blank values. Preserve the person's spelling. |
| `phone` | Nomor WhatsApp | Yes | Normalize to international form, e.g. `+6281234567890`. Indonesian local input beginning `08` can be normalized with an explicit Indonesia country selection; do not assume Indonesia for other country selections. Syntax validation does not prove WhatsApp ownership or availability. |
| `address` | Alamat domisili | Yes | Trim; reject blank values. One multiline address field for the pilot. |
| `birthPlace` | Tempat lahir | No | Trim; omit when empty. Stored separately from birth date. |
| `birthDate` | Tanggal lahir | Yes | Calendar date string `YYYY-MM-DD`; reject nonexistent dates and future dates. Store as SQL DATE, not a timestamp; do not shift by browser timezone. |
| `email` | Email | No at registration | Omit when empty; validate if supplied. Required later for the selected email-based login invitation. Registration email is unverified contact data. |
| `branchId` | Cabang | Yes | Server checks the actor's permission for the selected branch. |
| `planVersionId` | Paket | Yes | Select a published version permitted for that branch; server supplies the immutable offer snapshot. |

BE must define numeric field-length bounds in the request schema and expose them to FE before the form ships. The future-date check uses the server's current calendar date in the configured gym timezone; FE mirrors it for feedback. Gym timezone configuration must be included in the runtime contract. No minimum-age eligibility rule is introduced by collecting birth date.

For an existing member, reference `memberId` and display the authorized profile. Registration creation must not silently overwrite the shared member profile with edited contact or birth fields; any profile correction needs its own authorized update and conflict handling.

### Duplicate handling and identity

- Check for candidate duplicates across branches of the same gym business. A matching normalized phone/email or name plus birth date prompts review; none of these automatically merges people or links login accounts.
- Admin chooses the existing identity or resolves why the candidate is a different person. Record that resolution; do not use a unique phone constraint that prevents legitimate shared family contacts.
- Prevent another registration for the same resolved member and branch while one is `pending_review` or `needs_clarification`. BE must enforce this under concurrent requests; button disabling alone is insufficient.
- Candidate lookup must honor permissions. If a match belongs to a branch the admin cannot inspect, expose only a conflict requiring an authorized reviewer, not the other branch's personal data.
- Account linking requires verified ownership, and one login must not become attached to different member identities in the same gym accidentally. The existing member schema requires a user ID; a reviewed migration is needed to support profiles without login accounts. Do not create placeholder credentials to satisfy that constraint.

### Review and personal-data boundaries

Reject and clarify require a nonblank reason on both FE and BE. Corrected clarification submissions return to `pending_review`; rejected registrations have no automatic reopen action. Approval creates exactly one order and grants no active membership or benefits.

Address and birth details appear only in authorized entry/review/profile views, not ordinary list rows, generic logs, audit payloads or notification text. Audit records reference the resource and actor rather than copying the profile. Existing no-personal-data localStorage and 401/403 cleanup rules apply. D03 retention and consent wording remain separate release decisions.

## Proposed membership screens

Initial delivery focuses on registration and review, then order/payment and activation preview as their APIs become available. Member identity, registration review, payment and membership lifecycle are distinct resources and statuses. Approval creates one order; it does not activate membership.

| Screen | Proposed fields and displayed data | User actions | Page and domain states |
| --- | --- | --- | --- |
| Admin member/registration list | Search by name or member number; authorized branch; separate review and membership status filters; pagination. Rows show display name, member number if assigned, package snapshot, review/payment/membership status separately. | Search, filter, open detail; start registration if authorized | Initial loading, empty gym, no search matches, ready, background refresh, load error/retry, forbidden |
| Admin registration form | `fullName`, `phone`, `address`, `birthPlace`, `birthDate`, `email`, `branchId`, `planVersionId`; display package name, duration, price, currency and benefit summary from the server's offer. Requiredness follows the registration baseline above; numeric length bounds must be specified in the request schema. Existing-member flow references `memberId` instead of creating another identity. | Choose a published package, review summary, submit; edit and resubmit after clarification | Editing, invalid fields, submitting, submitted, clarification required, conflict, unknown submit outcome |
| Admin registration review | Registration ID/version, submitted identity/contact, branch, immutable offer snapshot, submitted time, clarification history. `decision`, `reason`, `version` follow the SA review contract; show reviewer and review time from server history. | Request clarification; approve or reject with reason and confirmation; open resulting order only after approval | `pending_review`, `needs_clarification`, resubmitted back to `pending_review`, `approved` with order reference, `rejected` with reason/reviewer/time; submitting, stale-version conflict, access lost. Rejected detail is read-only; no automatic reopen or activation action. |
| Order and manual payment | Server order number, offer snapshot, amount due, currency, verification history. Payment input: `amount` as a decimal string, `currency` fixed by order, `paidAt`, optional reference, private `proofMediaId` from upload/complete. Method and required metadata await product policy. | Upload/replace unsubmitted proof, submit payment; authorized admin verifies or requests correction with reason | Uploading, upload failed, submitted/unverified, verified, correction required, insufficient verified payment, amount/currency mismatch, timeout with unknown result |
| Activation preview and confirmation | `orderId`, expected version; show authoritative eligibility, effective start/end, timezone, benefits and warnings. Requested date input only if product permits it. | Request preview, inspect impact, confirm once; refresh expired preview | Ineligible with reason, preview loading/ready/stale, committing, successful upcoming/active status supplied by server, conflict/reconciliation |
| Member membership detail | Package snapshot, authoritative status, start/end, branch scope, available benefits, order/payment summary and permitted timeline events | View status/history, supply clarification or payment where authorized, request renewal when available | Registration rejected with reason (separate from membership status); no membership, upcoming, active, frozen, expired, cancelled; unavailable feature with reason |
| Membership change preview | `membershipId`, expected version, action; optional target plan/version, requested dates and reason only as permitted by that action's agreed policy. Show server-calculated dates, amount impact and benefit impact. | Preview then confirm renewal/freeze/resume/cancel/upgrade where explicitly allowed | Action unavailable with reason, editing, preview ready/stale, submitting, success, conflict; policies unresolved means disabled |

Date of birth and place of birth are approved above. Do not add medical assessment, complaints, body photos or national ID to this operational form without a separate approved requirement. Do not offer direct edits to activation/expiry or a manual "mark active" control.

## Role and interaction rules

- Initial pilot registration capture and clarification corrections are performed by authorized admins. Later member access shows only their records and permitted self-service actions. Admin sees operational registration/payment/membership data for authorized branches. Owner permissions are explicit, not inferred from the label. PT has no membership mutation privileges unless separately granted.
- Request proposed `allowedActions` and disabled reason codes per resource from the backend. These drive presentation; every mutation must still be authorized server-side. Do not derive privileges from only the first role in `branchAccess`, because an account may have multiple grants for the same branch.
- Keep editable values in component memory during background revalidation. Prompt before navigation or branch switching with unsaved edits. Clear sensitive values on confirmed account/session loss; no personal-data localStorage cache. Cross-login draft recovery requires a separate agreed policy.
- Cancel/ignore old list/detail requests on branch or account changes. Scope caches by gym, user, branch and resource. Preserve list filters and page state across successful focus checks.
- Disable duplicate submission while pending. A timeout is an unknown outcome, not proof of failure; reconcile with the server before offering a new business command.
- Use field-level messages plus a form summary; focus the first invalid field. Keep a visible success confirmation and link to the resulting resource. Mobile uses labelled inputs, touch targets of at least 44px and no horizontal form scrolling.

## API data and operation proposal

Use the endpoint names and fixed payload conventions already supplied by SA. The table below proposes FE data needs for those operations; unspecified fields and error enums still need agreement. Business endpoints are not claimed to be implemented. Finalize them in OpenAPI with BE before building business forms.

| Operation family | FE request needs | BE response needs |
| --- | --- | --- |
| Published offers and lists | Authorized branch, cursor/page, search/filter; no gym authority taken from client input | Stable IDs, display names, immutable plan version, offer price/currency/duration/benefits, pagination metadata |
| Create/update/submit registration | Identity/contact or existing member reference, branch, selected plan version; expected version for edits | Registration ID, server snapshot, review status, version, field errors, allowed actions; approved result references the single order |
| Registration review `POST /registrations/{r}/review` | Registration ID, `decision` approve/reject/clarify, `reason`, `version`, idempotency key | `approved` plus order reference, `rejected`, or `needs_clarification`; review actor/reason/time and current version. Reject/clarify return no new order or membership; stale/conflicting review returns conflict. |
| Private proof upload and payment submission | File metadata for upload intent; complete confirmation; payment data and finalized media reference | File constraints, authorized short-lived access, upload completion, payment ID/version and verification state |
| Verify payment | Payment ID, expected version, decision and correction reason as agreed | Verified totals, remaining balance, currency, payment state and activation eligibility |
| Preview/commit activation or membership change | Resource ID/version, action inputs; commit references preview token/version and idempotency key | Server-calculated impact, preview expiry, policy reason codes; commit revalidates and returns final state, timestamps, resource version and command/receipt reference |
| Membership detail/history | Member or membership ID and permitted filters | Independent registration/payment/membership statuses, immutable offer, benefits, permitted events, allowed actions, version and `asOf` |

Shared conventions to agree:

- Money is a JSON decimal string plus ISO currency, following SA DECIMAL storage. Keep input and API money values as strings; do not pass them through `Number`, `parseFloat`, or floating-point arithmetic. Localized display/input formatting must preserve exact value. BE validates and normalizes decimal precision, scale, sign and range; FE mirrors the agreed schema. Use the server for authoritative totals and previews. Date-only input is `YYYY-MM-DD`; timestamps include an explicit offset or UTC and the gym timezone is supplied for display. FE does not calculate contractual expiry dates.
- Reuse the established response envelope and `error.reasonCode`/`requestId`. Propose field errors for validation, 409 for stale versions or incompatible idempotency replay, and action-specific eligibility reasons; BE must define exact enums and HTTP statuses.
- Generate one idempotency key per confirmed logical action. Retry the same unchanged action with the same key; edited input is a new action after outcome reconciliation. Agree receipt/status lookup semantics before showing automatic retries. The backend command runner currently provides infrastructure, not a generic public command endpoint.
- Include realistic success, loading, empty, validation, conflict, 401/403, rate-limit and timeout fixtures in the agreed contract. Amount mismatch, stale preview, duplicate click and two-admin scenarios need FE/BE integration coverage.

## Product decisions required before implementation

| Decision owner | Decisions to close | FE consequence while unresolved |
| --- | --- | --- |
| Product and gym — registration | Optional reason taxonomy and cancellation/reopening after rejection if requested. Field requiredness, duplicate-review policy, separate login provisioning and self-review with review permission are fixed above. Invitation implementation, numeric validation limits and gym timezone exposure are BE contract work | Follow the confirmed field table; no public signup or automatic account linking |
| Product and gym — activation/payment | Accepted payment methods, proof requirements, adjustment/overpayment rules, start-date authority, timezone/cutoff, partial payment eligibility | Display server reasons; do not invent eligibility or default activation dates |
| Product and gym — renewal | Duration, overlap, early renewal, carry-forward and payment effect | No FE date arithmetic or automatic renewal rule |
| Product and gym — freeze/resume | Eligibility, limits, duration, fee, expiry extension and effective-time rules | Keep actions disabled until policy and preview contract exist |
| Product and gym — cancel/upgrade | Refund/proration, effect on existing period/benefits and effective date | No arbitrary amount or entitlement changes |
| Product/data owner — D03 | Consent wording/purposes, proof/contact retention, deletion/export and access | No assumed consent or unapproved personal-data collection |

Next contract review should lock the registration/review slice first, including fixtures and acceptance for submit → clarification → resubmit → approve → one unactivated order, plus the separate pending_review → rejected path with a visible reason and no order or active membership. Payment and activation follow after the relevant D02 decisions. This document does not decide activation, renewal or freeze policy for the product team.


## Acceptance additions before implementation

1. OpenAPI represents every monetary field as `type: string` with currency, not an integer minor-unit field. BE/FE agree the decimal grammar, precision/scale, limits and field-specific sign rules without changing the string representation fixed by SA.
2. Fixtures cover a decimal amount such as `"250000.00"`, a fractional amount, a boundary value within the agreed DECIMAL precision, malformed/localized API input, and currency mismatch. A numeric JSON amount is rejected under the agreed validation contract; exact string values must survive input, request and response without float conversion.
3. Admin review has visible approve/reject/clarify actions according to server permissions. Reject requires reason/confirmation, shows pending state, prevents duplicate submission, and displays the server's `rejected` result with reason and review history. No payment/activation CTA is offered for that rejected registration.
4. Admin detail shows rejection and its reason without an invented resubmit/reopen action; later authorized member detail preserves that behavior. For this pilot, admin handles clarification corrections and uses the existing submit route to return to `pending_review`.
5. Test concurrent approve versus reject, stale version, same-command retry, unknown timeout outcome, and 401/403. One accepted review wins; FE reconciles against current server state and never labels a rejected registration as active.

6. Pilot fixtures cover admin entry in an authorized branch, denial for an unauthorized branch, correction/resubmission after clarification, and submit returning `pending_review` without automatic approval. Review visibility follows the agreed submitter/reviewer policy. Creating a registration must not silently create login credentials in the FE.

These are contract acceptance requirements for subsequent implementation, not claims that tests or business endpoints already exist. Activation, renewal and freeze rules remain product decisions; neither inconsistency authorizes FE to redefine them.

7. Registration fixtures must cover required address/date of birth, omitted optional birthplace/email, a real leap day, invalid calendar dates, future birth dates, date-only round trips, normalized contact candidates without auto-merge, an existing member with a pending same-branch registration, and denied candidate-detail access across unauthorized branches.
8. Verify that self-review succeeds only with review permission; approval produces one order and no active membership, benefits or automatically linked login. These are future implementation acceptance cases, not executed tests.
