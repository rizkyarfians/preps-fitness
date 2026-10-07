# Preps Fitness

Backend and frontend foundation for Gym Planner. One deployment and MySQL database per gym business, with multiple branches. The API uses Node.js, TypeScript, Express, Better Auth and Drizzle; the frontend in `apps/web` uses React, TypeScript and Vite.

## Local setup

Requires Node.js 24 and Docker Compose (or a separate MySQL 8.4 server).

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and replace `BETTER_AUTH_SECRET` with a random secret of at least 32 characters (`openssl rand -hex 32`).
3. Run `docker compose up -d --wait`.
4. Run `npm run db:migrate`.
5. Set `SEED_PASSWORD` to a development password of at least 12 characters, then run `npm run db:seed`. The seed is for an empty database and creates `admin@example.test` plus two branches. Never use real personal data. A partially failed seed may require a fresh disposable database.
6. Run `npm run dev`.

Do not commit `.env` or passwords. Local Compose credentials are disposable development values, never production credentials. Use PowerShell `$env:SEED_PASSWORD` or your shell's environment-variable mechanism; the password is not printed by the seed.

## API

- `GET /health/live`: process liveness.
- `GET /health/ready`: database connectivity and exactly one matching configured gym.
- `POST /api/v1/auth/sign-in/email`: Better Auth email/password login.
- `POST /api/v1/auth/sign-out`: revoke current session.
- `GET /api/v1/me`: identity and explicit branch-role grants; no paid benefits are granted yet.
- `GET /api/v1/branches/{branchId}`: authorized branch summary.

Frontend requests must include credentials. Auth mutations use the configured Origin. Keep frontend/API on the same origin behind a reverse proxy for production. Public signup is disabled; registration is a later slice. See `packages/contracts/openapi.yaml` for business endpoints and `docs/auth-contract.md` for auth integration.

## Validation

Run `npm run typecheck`, `npm run build` and `npm test`.

Integration tests require `NODE_ENV=test`, the same required environment variables as `.env.example`, and a NEW disposable MySQL database with committed migrations applied. Run `npm run test:integration`. Tests deliberately insert a foreign gym to verify rejection and readiness failure, so never point this suite at your development seed, staging or production database. Recreate the disposable database before another run.

GitHub Actions provides MySQL 8.4 and runs dependency install, typecheck, build, unit/API tests, migration drift checks, migrations twice, and integration tests. Production startup never automatically migrates a database.

## Additional Sprint 0 foundation

A fail-closed benefit evaluator and transactional command runner are included. The runner commits domain writes, receipt, audit and outbox together. MySQL tests exercise concurrent retries, rollback and two-admin locking. See `docs/command-and-benefit-foundation.md`. The evaluator is not yet connected to production membership facts; outbox delivery is not yet implemented.

## Frontend foundation

The responsive frontend includes login/logout, authorized branch selection using branch names, and role-aware workspace navigation. Background session refresh preserves the current page; session revalidation returning 401/403 clears private content. Business module screens are not yet implemented.

Frontend CI covers the production build, API contract generation check and browser regressions. A separate real-browser integration workflow exercises the frontend with the API and disposable MySQL. The frontend workflow uses path filters, so documentation-only changes do not trigger it. These checks do not replace deployed desktop/mobile HTTPS smoke tests.

See [FE integration and membership handoff](docs/fe-membership-handoff.md) for the admin-entered registration scope, field requirements and review transitions. Monetary values use DECIMAL strings with currency; approval creates one order without activating membership. This handoff is a contract proposal and product baseline, not an implemented registration API or form.

## Scope and remaining work

This is a Sprint 0 foundation, not a production-ready product. Registration forms/APIs, membership, payment, production benefit wiring, outbox dispatch, email recovery and production user provisioning are pending. Registration implementation requires the reviewed member identity migration, versioned package contract and registration/review OpenAPI definitions. Profiles without login accounts must be supported without placeholder credentials.

Hosting, staging verification, load testing and G0 acceptance remain open. No staging or production deployment is configured. Follow [the staging handoff](docs/staging-handoff.md) for build-time `VITE_API_ORIGIN` configuration and desktop/mobile HTTPS smoke acceptance.

Read `docs/adr-001-backend-foundation.md` for decisions and limitations.
