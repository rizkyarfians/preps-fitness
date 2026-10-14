import { test, expect } from '@playwright/test';

const api = 'http://localhost:3000/api/v1';
test('BE recovers a lost mutation response after browser reload from metadata only', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Kata sandi', { exact: true }).fill(process.env.SEED_PASSWORD!);
  const login = async () => {
    const response = page.waitForResponse(r => r.url() === `${api}/auth/sign-in/email` && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Masuk ke akun' }).click();
    return response;
  };
  let response = await login();
  if (response.status() === 429) {
    const seconds = Number(response.headers()['x-retry-after']);
    expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 10).toBe(true);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
    response = await login();
  }
  expect(response.status()).toBe(200);
  await expect(page.getByText('AKUN TERHUBUNG', { exact: true })).toBeVisible();
  const me = (await (await context.request.get(`${api}/me`)).json()).data;
  const metadata = { branchId: me.branchAccess[0].branchId, operation: 'plan.create', idempotencyKey: crypto.randomUUID() };
  // Test harness for the FE recovery contract, not an implemented recovery UI.
  // Persist only scope/key before sending; never store the mutation body or member PII.
  await page.evaluate(meta => sessionStorage.setItem('uat-command', JSON.stringify(meta)), metadata);
  let resourceId = '';
  let commandId = '';
  await page.route(`${api}/plans`, async route => {
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(201);
    const data = (await upstream.json()).data;
    resourceId = data.plan.id;
    commandId = data.commandId;
    // Database has committed, but the browser never receives the result.
    await route.abort('failed');
  }, { times: 1 });
  const failed = await page.evaluate(async ({ api, metadata }) => {
    try {
      await fetch(`${api}/plans`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': metadata.idempotencyKey },
        body: JSON.stringify({ branchId: metadata.branchId, draft: { name: 'Reload recovery synthetic' } }),
      });
      return false;
    } catch { return true; }
  }, { api, metadata });
  expect(failed).toBe(true);
  expect(resourceId).toBeTruthy();
  await page.reload();
  const recovered = await page.evaluate(async api => {
    const response = await fetch(`${api}/commands/resolve`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: sessionStorage.getItem('uat-command'),
    });
    return { status: response.status, body: await response.json() };
  }, api);
  expect(recovered.status).toBe(200);
  expect(recovered.body.data).toEqual({ status: 'completed', commandId, operation: 'plan.create', result: { resourceType: 'plan', resourceId } });
  const detail = await context.request.get(`${api}/plans/${resourceId}?branchId=${metadata.branchId}`);
  expect(detail.status()).toBe(200);
  expect((await detail.json()).data.draft.name).toBe('Reload recovery synthetic');
  await page.evaluate(() => sessionStorage.removeItem('uat-command'));
});
