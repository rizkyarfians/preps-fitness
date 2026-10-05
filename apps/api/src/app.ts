import { randomUUID } from 'node:crypto';
import express, { type Request, type RequestHandler, type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Principal } from './access.js';
import { allowedBranch } from './access.js';
export interface AppDeps {
 gymId: string; webOrigin: string; authHandler: RequestHandler;
 resolvePrincipal(req: Request): Promise<Principal | null>;
 getBranch(id: string): Promise<{ id: string; name: string } | null>;
 ready(): Promise<void>;
}
export function createApp(d: AppDeps) {
 const app = express();
 app.disable('x-powered-by');
 app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); next(); });
 app.use(helmet());
 app.use(cors({ origin: d.webOrigin, credentials: true }));
 app.get('/health/live', (_req, res) => { res.json({ status: 'ok' }); });
 app.get('/health/ready', async (_req, res) => { await d.ready(); res.json({ status: 'ok' }); });
 app.all('/api/v1/auth/*splat', d.authHandler);
 app.use(express.json({ limit: '64kb' }));
 const fail = (res: express.Response, status: number, reasonCode: string) => res.status(status).json({ error: { reasonCode, requestId: res.locals.requestId } });
 app.use('/api/v1', async (req, res, next) => {
  const p = await d.resolvePrincipal(req);
  if (!p) { fail(res, 401, 'UNAUTHENTICATED'); return; }
  if (!p.enabled || p.gymId !== d.gymId) { fail(res, 403, 'ACCOUNT_ACCESS_DENIED'); return; }
  res.locals.principal = p; next();
 });
 app.get('/api/v1/me', (_req, res) => {
  const p = res.locals.principal as Principal;
  res.json({ data: { user: p.user, gymId: d.gymId, branchAccess: p.grants.filter(g => g.gymId === d.gymId).map(({ branchId, role }) => ({ branchId, role })), entitlements: [] } });
 });
 app.get('/api/v1/branches/:branchId', async (req, res) => {
  if (!allowedBranch(res.locals.principal as Principal, d.gymId, req.params.branchId)) { fail(res, 403, 'BRANCH_ACCESS_DENIED'); return; }
  const b = await d.getBranch(req.params.branchId);
  if (!b) { fail(res, 404, 'NOT_FOUND'); return; }
  res.json({ data: b });
 });
 app.use((_req, res) => { fail(res, 404, 'NOT_FOUND'); });
 const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') { fail(res, 400, 'INVALID_JSON'); return; }
  if (err?.type === 'entity.too.large') { fail(res, 413, 'PAYLOAD_TOO_LARGE'); return; }
  // Do not log request bodies, cookies, credentials or personal data.
  console.error(JSON.stringify({ event: 'request_failed', requestId: res.locals.requestId }));
  fail(res, 503, 'SERVICE_UNAVAILABLE');
 };
 app.use(onError);
 return app;
}
