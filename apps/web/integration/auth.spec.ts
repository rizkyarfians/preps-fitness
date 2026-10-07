import { test, expect, type Page } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';

const api = 'http://localhost:3000/api/v1';
let db: Connection;
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Kata sandi', { exact: true }).fill(process.env.SEED_PASSWORD!);
  const submit = async () => {
    const response = page.waitForResponse(r => r.url() === `${api}/auth/sign-in/email` && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Masuk ke akun' }).click();
    return response;
  };
  let response = await submit();
  if (response.status() === 429) {
    // Keep the real auth limiter enabled. Honor its bounded retry window.
    await expect(page.getByRole('alert')).toContainText('Terlalu banyak percobaan');
    const seconds = Number(response.headers()['x-retry-after']);
    expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 10).toBe(true);
    console.log('Login rate limit observed; honoring X-Retry-After');
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
    response = await submit();
  }
  expect(response.status(), 'Real login must succeed before testing the session').toBe(200);
  await expect(page.getByText('AKUN TERHUBUNG', { exact: true })).toBeVisible();
}
async function focusAndWait(page: Page, status: number) {
  const response = page.waitForResponse(r => r.url() === `${api}/me` && r.status() === status);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await response;
}
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV !== 'test' || process.env.E2E_DISPOSABLE_DATABASE !== 'yes' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/preps_e2e') {
    throw new Error('Use only the local disposable preps_e2e database');
  }
  db = await createConnection(process.env.DATABASE_URL!);
  await db.execute('INSERT INTO branch (id, gym_id, name) VALUES (?, ?, ?)', ['e2e-no-grant', process.env.GYM_ID, 'Restricted']);
});
test.afterAll(async () => { if (db) await db.end(); });

test('real cookie login, named branches, branch denial and logout revoke', async ({ page, context, playwright }) => {
  await login(page);
  const meResponse = await context.request.get(`${api}/me`);
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()).data;
  expect(me.entitlements).toEqual([]);
  expect(me.branchAccess.map((b: { branchName: string }) => b.branchName).sort()).toEqual(['Central', 'North']);
  await expect(page.getByLabel('Cabang aktif').locator('option')).toHaveText(me.branchAccess.map((b: { branchName: string }) => b.branchName));
  for (const branch of me.branchAccess) {
    await page.getByLabel('Cabang aktif').selectOption(branch.branchId);
    await expect(page.locator('.hero .eyebrow')).toHaveText(branch.branchName);
  }
  const denied = await context.request.get(`${api}/branches/e2e-no-grant`);
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.reasonCode).toBe('BRANCH_ACCESS_DENIED');
  const cookies = await context.cookies();
  expect(cookies.some(c => c.name.includes('session_token') && c.httpOnly)).toBe(true);
  const oldSession = await playwright.request.newContext({ storageState: await context.storageState() });
  try {
    await page.getByRole('button', { name: 'Keluar', exact: true }).click();
    await expect(page.getByText('Berhasil keluar.', { exact: true })).toBeVisible();
    expect((await oldSession.get(`${api}/me`)).status()).toBe(401);
  } finally { await oldSession.dispose(); }
});

test('focus revalidation preserves the selected page with a real session', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Membership', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'MEMBERSHIP SEGERA HADIR' });
  await expect(heading).toBeVisible();
  // A DOM marker proves that the private workspace was not unmounted.
  await heading.evaluate(el => el.setAttribute('data-e2e-mounted', 'yes'));
  await focusAndWait(page, 200);
  await expect(heading).toHaveAttribute('data-e2e-mounted', 'yes');
});

test('disabled gym account loses private UI and receives 403', async ({ page, context }) => {
  await login(page);
  const id = (await (await context.request.get(`${api}/me`)).json()).data.user.id;
  try {
    await db.execute('UPDATE gym_user SET enabled = false WHERE gym_id = ? AND user_id = ?', [process.env.GYM_ID, id]);
    await focusAndWait(page, 403);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Akses tidak tersedia');
    expect((await context.request.get(`${api}/me`)).status()).toBe(403);
  } finally {
    await db.execute('UPDATE gym_user SET enabled = true WHERE gym_id = ? AND user_id = ?', [process.env.GYM_ID, id]);
  }
});

test('server-revoked session clears private UI on focus', async ({ page, context }) => {
  await login(page);
  const id = (await (await context.request.get(`${api}/me`)).json()).data.user.id;
  await db.execute('DELETE FROM auth_session WHERE user_id = ?', [id]);
  await focusAndWait(page, 401);
  await expect(page.getByRole('button', { name: 'Masuk ke akun' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});
