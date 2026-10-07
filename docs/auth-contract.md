# Authentication contract

Use Better Auth with baseURL set to the API origin and basePath `/api/v1/auth`. Express mounts its handler before the JSON body parser. Browser requests include cookies (`credentials: include`); server-side integrations forward only necessary incoming headers.

Login: POST `/api/v1/auth/sign-in/email`, JSON `{ "email": "admin@example.test", "password": "<password>" }`. Successful login sets an HttpOnly session cookie. Use the Better Auth client to process its native response and errors, then GET `/api/v1/me`. An authenticated user with no enabled gym access receives 403 on business APIs.

Logout: POST `/api/v1/auth/sign-out`, JSON `{}` with the session cookie and configured Origin. The next business request with the previous session cookie must return 401.

Do not persist auth tokens in localStorage. Clearing frontend state alone is not logout. Clear user-specific UI/cache on logout or account changes. Handle 401 by asking for login; 403 represents denied access and must not be retried indefinitely.

Public signup is disabled. Login is not registration approval or membership activation. Password recovery/email verification and production provisioning are pending and must not be shown as working UI features.

`GET /api/v1/me` returns `branchAccess` entries with `branchId`, `branchName`, and `role` for authorized branches only. Branch names are resolved within the deployment gym; missing branches are omitted. Frontend focus checks run in the background: retain the current workspace on success or transient network/server failure, and clear it on 401/403.
