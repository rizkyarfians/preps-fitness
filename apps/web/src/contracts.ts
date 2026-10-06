// Generated from packages/contracts/openapi.yaml. Run npm run contracts.
export type Error = { "error": { "reasonCode": "UNAUTHENTICATED" | "ACCOUNT_ACCESS_DENIED" | "BRANCH_ACCESS_DENIED" | "NOT_FOUND" | "SERVICE_UNAVAILABLE" | "INVALID_JSON" | "PAYLOAD_TOO_LARGE"; "requestId": string } };
export type Me = { "user": { "id": string; "name": string; "email": string }; "gymId": string; "branchAccess": Array<{ "branchId": string; "role": "owner" | "admin" | "pt" | "member" }>; "entitlements": Array<string> };
