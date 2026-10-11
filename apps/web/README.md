# PREPS frontend foundation

React and TypeScript frontend for the existing dedicated-per-gym API. Black/charcoal surfaces, muted gold accents, self-hosted Barlow Condensed headings and Inter body text. No remote font requests.

## Run

Use Node 24. From this directory:

```sh
npm ci
cp .env.example .env
npm run dev
```

Start the API and MySQL using the root README. Seed an account using the backend process; no signup or password recovery is exposed. The backend `WEB_ORIGIN` must match `http://localhost:5173`. `VITE_API_ORIGIN` defaults to the web origin if omitted; `.env.example` points development requests at port 3000. Cookies are managed by Better Auth, with credentials included. Production requires HTTPS and compatible frontend/API cookie topology; prefer a same-origin reverse proxy for `/api`.

## Scope

Implemented: login, server logout, `/me`, branch switching, branch-scoped role navigation, loading/error/denied states, responsive login and workspace shell. No tokens or personal data are persisted in browser storage. Focus revalidates the session; branch requests are cancelled on branch changes. Logout clears the private view immediately but only claims success after the server responds.

Admin registration is implemented under Membership. Payments, activation, member self-service, exercise content, programs and reports remain unavailable. There are no fake production metrics or live-looking fixtures. Empty entitlements grant no benefits. Navigation is presentation only; the API remains the authorization boundary. All dropdown labels come from `/me.branchAccess[].branchName`, including branches not yet selected. Deploy the updated backend contract before this frontend. Focus revalidation preserves the mounted workspace on success and temporary network/server failure; 401/403 clears private UI. A background error offers an explicit retry.

This is a frontend foundation, not completion of G0. IndexedDB/offline spike, staging, production deployment and operational UAT remain outstanding. Database-backed browser scenarios are provided separately.

## Validate

```sh
npm run build
npx playwright install chromium
npm test
```

`npm run contracts` generates schema types from the existing JSON-formatted OpenAPI document; build fails on drift. The browser tests intercept API calls to verify frontend behavior. The separate integration suite exercises real Better Auth/MySQL. Production release still needs login → `/me` → branch access → logout verification against the running API and the roadmap QA gates.

The npm lockfile is separate from the backend to avoid disturbing its pinned dependencies and CI. Frontend CI validates types, contract drift, production build and browser scenarios.

## Admin registration demo

The Membership workspace now contains the registration list, input form and review detail for branch owner/admin grants. It uses the real API routes from `docs/registration-api-contract.md`; the member role still has no operational registration screen.

Before running the demo, apply backend migrations through 0003, configure `GYM_TIMEZONE`, and provision selectable plan versions. For an empty disposable development database, the backend seed provides demo plans. Start the API at port 3000 and this frontend at port 5173 with `VITE_API_ORIGIN=http://localhost:3000` and matching backend `WEB_ORIGIN`.

1. Open Membership → Registrasi baru. Enter synthetic contact/address/birth-date data and choose a package.
2. Save the draft. The detail displays its ID and `Draft` status. Sending for review is a separate action; it reuses this ID.
3. Request a correction with a reason. Use Perbaiki data, save the correction, then send for review again.
4. Approve. The detail displays the resulting order ID and explicitly states membership is not active.
5. Repeat with another synthetic identity and reject with a reason. The rejected record is read-only and has no order.

Duplicate checks allow selecting a visible existing member or recording why a candidate is a different person. Restricted matches cannot be bypassed. Before submission, a fresh candidate check is obtained. Corrections update the registration snapshot, not the shared member profile.

A failed/unknown mutation keeps its exact payload and idempotency key in component memory. Use Konfirmasi permintaan yang sama to reconcile. Navigation is blocked until the command outcome is known; the browser warns before reload/close. Nothing containing personal data is persisted in browser storage. Reloading/closing loses the in-memory retry context, so inspect the server registration list before starting another registration. Version conflicts require loading the latest detail before another decision.

`tests/registrations.spec.ts` exercises failure and duplicate states with intercepted responses. `integration/auth.spec.ts` includes desktop and mobile-viewport browser flows against actual API/MySQL, with database assertions for one approved order and no rejected order. Run the real suite only through the disposable-database configuration in `.github/workflows/browser-integration.yml`. These tests are HTTP development checks, not deployed HTTPS or physical-device acceptance.
