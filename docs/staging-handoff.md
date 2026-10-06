# Integration and staging handoff

## Automated evidence

The Real browser integration workflow builds the API and frontend, migrates a new MySQL 8.4 database, seeds synthetic accounts and runs Chromium against both processes. No API responses are intercepted. Coverage: login cookie, all authorized branch names, branch switching, unauthorized branch denial, old-cookie rejection after logout, page preservation during focus checks, account disabling and server session revocation. The existing frontend workflow additionally covers temporary network failure and logout races using controlled responses.

Run locally on Node 24 after installing both lockfiles and Chromium. Use a NEW local disposable database named `preps_e2e`, set `NODE_ENV=test`, `E2E_DISPOSABLE_DATABASE=yes`, and the same environment variables as the workflow. Build both projects, apply migrations, run `npm run db:seed`, then from `apps/web` run `npx playwright test --config playwright.integration.config.ts`. Tests alter account access and sessions; never use a shared development, staging or production database. Recreate the disposable database for another run. Traces are disabled to avoid retaining authentication material.

## Staging configuration

Hosting and domain are still to be selected. Use one database, database user, random auth secret and GYM_ID per gym business. Prefer one HTTPS origin: serve the web build and proxy `/api` unchanged to Express. Forward health requests to the API for infrastructure checks. Keep MySQL private. Set backend NODE_ENV=production, DATABASE_URL, GYM_ID, BETTER_AUTH_SECRET, BETTER_AUTH_URL and WEB_ORIGIN; the two URLs must match the intended HTTPS origin. Build frontend with VITE_API_ORIGIN set to that origin (or omitted for same-origin).

## Release order

1. Back up the target database and record the current API/web versions. Apply reviewed migrations as a separate release step.
2. Deploy the API containing `/me.branchAccess[].branchName`. Verify `/health/live`, `/health/ready`, and authenticated `/me` using a synthetic staging account; confirm names for every permitted branch and no foreign branch data.
3. Deploy the matching frontend build. Verify login, named branch selection, focus refresh, forbidden access, logout and revoked sessions through HTTPS. Confirm Secure/HttpOnly cookies and no cross-site topology mismatch.
4. Roll back frontend first if its smoke checks fail. Keep the additive branchName backend contract available to any cached newer frontend. Do not automatically reverse migrations.

Production startup does not seed or migrate. The development seed refuses production mode. Initial staging account provisioning must be arranged before the HTTPS smoke test; no public signup or production provisioning tool is supplied here. Email recovery, membership rules, load testing, offline spike and G0 acceptance remain open. CI over local HTTP does not prove HTTPS/proxy/cookie behavior or production capacity. This handoff does not perform a deployment.
