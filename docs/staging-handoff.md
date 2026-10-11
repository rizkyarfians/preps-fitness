# Integration and staging handoff

## Automated evidence

The Real browser integration workflow builds the API and frontend, migrates a new MySQL 8.4 database, seeds synthetic accounts and runs Chromium against both processes. No API responses are intercepted. Coverage: login cookie, all authorized branch names, branch switching, unauthorized branch denial, old-cookie rejection after logout, page preservation during focus checks, account disabling and server session revocation. The existing frontend workflow additionally covers temporary network failure and logout races using controlled responses.

Run locally on Node 24 after installing both lockfiles and Chromium. Use a NEW local disposable database named `preps_e2e`, set `NODE_ENV=test`, `E2E_DISPOSABLE_DATABASE=yes`, and the same environment variables as the workflow. Build both projects, apply migrations, run `npm run db:seed`, then from `apps/web` run `npx playwright test --config playwright.integration.config.ts`. Tests alter account access and sessions; never use a shared development, staging or production database. Recreate the disposable database for another run. Traces are disabled to avoid retaining authentication material.

## Staging configuration

Hosting and domain are still to be selected. Use one database, database user, random auth secret and GYM_ID per gym business. Prefer one HTTPS origin: serve the web build and proxy `/api` unchanged to Express. Forward health requests to the API for infrastructure checks. Keep MySQL private. Set backend NODE_ENV=production, DATABASE_URL, GYM_ID, GYM_TIMEZONE (explicit IANA zone), BETTER_AUTH_SECRET, BETTER_AUTH_URL and WEB_ORIGIN; the two URLs must match the intended HTTPS origin. Build frontend with VITE_API_ORIGIN set to that origin (or omitted for same-origin).

## Release order

1. Back up the target database and record the current API/web versions. Apply reviewed migrations as a separate release step.
2. Deploy the API containing `/me.branchAccess[].branchName`. Verify `/health/live`, `/health/ready`, and authenticated `/me` using a synthetic staging account; confirm names for every permitted branch and no foreign branch data.
3. Deploy the matching frontend build. Verify login, named branch selection, focus refresh, forbidden access, logout and revoked sessions through HTTPS. Confirm Secure/HttpOnly cookies and no cross-site topology mismatch.
4. Roll back frontend first if its smoke checks fail. Keep the additive branchName backend contract available to any cached newer frontend. Do not automatically reverse migrations.

Production startup does not seed or migrate. The development seed refuses production mode. Initial staging account provisioning must be arranged before the HTTPS smoke test; no public signup or production provisioning tool is supplied here. Email recovery, membership rules, load testing, offline spike and G0 acceptance remain open. CI over local HTTP does not prove HTTPS/proxy/cookie behavior or production capacity. This handoff does not perform a deployment.


## Registration and package UAT

After the registration FE in PR #9 and plan API are integrated, apply migrations through 0004 before starting the matching API. Provision synthetic admin accounts for two branches, a member-only account, and an owner account; record who may publish prices using the explicit branch policy. Domain/HTTPS, database location and account provisioning remain deployment prerequisites; this document does not claim they are configured.

- Create and edit a package through the API (no seed), publish, then select its published version in the FE registration form.
- Create draft → submit → clarify → correct → resubmit → approve; confirm one order and no active membership. Run reject separately and confirm no order.
- Publish a changed price while an older registration is pending; verify the pending registration and resulting order keep the old price.
- Test branch denials, expired login, two reviewers and stale versions, on desktop and a physical mobile device through HTTPS.
- Simulate losing a response after a command has committed. In the same page session, retry the original command/key and verify no duplicate effect.
- Force a full page reload after an unknown response despite the unload warning. PR #9 stores retry context in memory only; reload loses the key/payload. Do not blindly repeat create, review or future payment commands. Inspect authorized registration detail/list and backend audit/receipt evidence to reconcile the outcome first. List absence alone is not proof that a command failed; an operator must investigate ambiguous creates. Record unresolved outcomes as UAT failures. A durable, authorized command-recovery design is required before payments depend on browser retries. Do not persist raw applicant PII in browser storage as a shortcut.

## Decisions before manual payment and activation implementation

Lock the rules with product/operations before adding writes: permitted payment methods and proof/reference fields; exact/partial/overpayment handling; currency; who may record/verify and whether self-verification is permitted; corrections/refunds; the event authorizing activation; whether the start date is chosen or derived, backdating rules, gym timezone and inclusive/exclusive end boundaries; calendar-month behavior; and payment/activation reversal. Keep approval, payment and activation as distinct recorded facts linked to the existing order. Define unknown-outcome recovery and audit requirements before UAT. No payment or activation behavior is assumed by this package PR.
