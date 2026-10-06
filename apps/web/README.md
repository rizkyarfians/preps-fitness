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

Membership, payments, exercise content, programs and reports have explicitly unavailable screens. There are no fake metrics, live-looking fixtures or working business mutations. Empty entitlements grant no benefits. Navigation is presentation only; the API remains the authorization boundary. All dropdown labels come from `/me.branchAccess[].branchName`, including branches not yet selected. Deploy the updated backend contract before this frontend. Focus revalidation preserves the mounted workspace on success and temporary network/server failure; 401/403 clears private UI. A background error offers an explicit retry.

This is a frontend foundation, not completion of G0. IndexedDB/offline spike, real database-backed browser integration, staging, production deployment and operational UAT remain outstanding.

## Validate

```sh
npm run build
npx playwright install chromium
npm test
```

`npm run contracts` generates schema types from the existing JSON-formatted OpenAPI document; build fails on drift. The browser tests intercept API calls to verify frontend behavior. They do not prove real Better Auth/MySQL integration. Production release still needs login → `/me` → branch access → logout verification against the running API and the roadmap QA gates.

The npm lockfile is separate from the backend to avoid disturbing its pinned dependencies and CI. Frontend CI validates types, contract drift, production build and browser scenarios.
