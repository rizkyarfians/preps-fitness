# Backend foundation decisions

Accepted product direction: one codebase, one application deployment and database per gym business; multiple branches share that deployment. Expected starting population: 500 registered users per branch, not 500 concurrent users.

Use Node.js 24, TypeScript, Express 5, Better Auth, Drizzle and MySQL InnoDB. Exact dependency versions are in package.json and package-lock.json. Run the same artifact with separate credentials, auth secrets, host-only cookies and GYM_ID for each gym. Database credentials must only access that gym database.

Session cookie caching is disabled. Application authorization reloads gym account status and explicit branch-role grants on each request. Even owners need explicit branch grants in this initial slice. A future owner-wide permission requires an explicit policy and tests. Roles never imply purchased member benefits. Entitlements currently return an empty list and all benefit-protected features remain unimplemented.

Auth tables describe identity; gym_user describes enabled access; member describes the separate member profile. branch_access uses composite foreign keys so a gym cannot grant access to another gym's branch. The deployment gym is trusted configuration, never a client header. Readiness fails if the database contains zero, multiple, or the wrong gym.

Prefer frontend and API behind the same HTTPS origin in production. Cross-site cookies are not supported by this initial configuration. Public account signup is disabled until registration/review rules are implemented. Development seeding is explicitly unavailable in production. Email delivery, reset/verification flows, production account provisioning and privileged-account MFA must be implemented before a real user pilot.

Auth endpoints retain Better Auth's native response/error format; business endpoints use the contract in packages/contracts/openapi.yaml. FE should use Better Auth's client for auth and the business contract for /me and branches. Do not expose session tokens in /me.

Pending D01: hosting vendor, domain, proxy topology, browser support and load-test capacity. Rate limiting currently uses process memory; multiple API replicas require shared rate limiting or an ingress-level policy. Do not blindly trust client-supplied forwarding headers.

Pending Sprint 0 work: transaction/locking spike, audited idempotency receipts/outbox, benefit evaluator, frontend integration, offline spike, CI evidence, staging deployment and G0 review. This PR does not complete G0.

References checked during implementation:
- https://better-auth.com/docs/integrations/express
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/concepts/session-management
