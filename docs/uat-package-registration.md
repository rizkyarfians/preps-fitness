# Package → registration UAT

PM acceptance scenario: create package → publish → enter member → submit → clarify → correct → resubmit → approve; exactly one order. A separate rejected registration must create zero orders.

The automated scenario in `apps/web/integration/auth.spec.ts` runs the full sequence through the UI on desktop (1280px) and mobile (390px), with the real API and disposable MySQL database. It selects the exact version of the package created in that same scenario; no seeded package or mocked registration response is used.

| Step | Expected result / assertion |
| --- | --- |
| Create package | Saved authoring state is `draft` |
| Publish | New offer belongs to the created plan and selected branch; DECIMAL amount `325000.50` |
| Input member and save | Registration is `draft`, uses the new offer; zero orders |
| Submit | `pending_review`; zero orders |
| Clarify | `needs_clarification`; zero orders |
| Correct address | Same registration ID, corrected address persisted; zero orders |
| Focus window and resubmit | Edits preserved; returns to `pending_review`; zero orders |
| Approve | `approved`; clarify/approve audit history; exactly one database order matching the returned order ID |
| Replay approval | Same key and payload return `replayed: true`, same order ID; still exactly one database order |
| Reject another member | Uses the same published offer; `rejected`, no order ID and zero database orders |

The test logs a `UAT_EVIDENCE` JSON record for each viewport, containing synthetic plan/registration/order IDs and measured order counts. See the Real browser integration workflow run linked from the PR for execution evidence. Approval must not activate membership; current-user entitlements stay empty.

Run using the existing `apps/web/playwright.integration.config.ts` and the environment in `.github/workflows/browser-integration.yml`. It requires `NODE_ENV=test`, `E2E_DISPOSABLE_DATABASE=yes` and the local `preps_e2e` database; do not point it at a live database. The workflow applies migrations and seeds disposable test accounts before running.

These are automated acceptance checks over HTTP in CI. PM/operator manual sign-off and physical-device HTTPS staging smoke tests remain separate; this document does not claim those have occurred.
