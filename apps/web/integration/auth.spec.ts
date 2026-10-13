import { test, expect, type Page } from "@playwright/test";
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";

const api = "http://localhost:3000/api/v1";
let db: Connection;
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill(process.env.SEED_PASSWORD!);
  const submit = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.url() === `${api}/auth/sign-in/email` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Masuk ke akun" }).click();
    return response;
  };
  let response = await submit();
  if (response.status() === 429) {
    // Keep the real auth limiter enabled. Honor its bounded retry window.
    await expect(page.getByRole("alert")).toContainText(
      "Terlalu banyak percobaan",
    );
    const seconds = Number(response.headers()["x-retry-after"]);
    expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 10).toBe(true);
    console.log("Login rate limit observed; honoring X-Retry-After");
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
    response = await submit();
  }
  expect(
    response.status(),
    "Real login must succeed before testing the session",
  ).toBe(200);
  await expect(page.getByText("AKUN TERHUBUNG", { exact: true })).toBeVisible();
}
async function focusAndWait(page: Page, status: number) {
  const response = page.waitForResponse(
    (r) => r.url() === `${api}/me` && r.status() === status,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await response;
}
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.E2E_DISPOSABLE_DATABASE !== "yes" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/preps_e2e"
  ) {
    throw new Error("Use only the local disposable preps_e2e database");
  }
  db = await createConnection(process.env.DATABASE_URL!);
  await db.execute("INSERT INTO branch (id, gym_id, name) VALUES (?, ?, ?)", [
    "e2e-no-grant",
    process.env.GYM_ID,
    "Restricted",
  ]);
});
test.afterAll(async () => {
  if (db) await db.end();
});

test("real cookie login, named branches, branch denial and logout revoke", async ({
  page,
  context,
  playwright,
}) => {
  await login(page);
  const meResponse = await context.request.get(`${api}/me`);
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()).data;
  expect(me.entitlements).toEqual([]);
  expect(
    me.branchAccess.map((b: { branchName: string }) => b.branchName).sort(),
  ).toEqual(["Central", "North"]);
  await expect(page.getByLabel("Cabang aktif").locator("option")).toHaveText(
    me.branchAccess.map((b: { branchName: string }) => b.branchName),
  );
  for (const branch of me.branchAccess) {
    await page.getByLabel("Cabang aktif").selectOption(branch.branchId);
    await expect(page.locator(".hero .eyebrow")).toHaveText(branch.branchName);
  }
  const denied = await context.request.get(`${api}/branches/e2e-no-grant`);
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.reasonCode).toBe("BRANCH_ACCESS_DENIED");
  // Exercise real registration HTTP handlers with the browser's authenticated cookies.
  const branchId = me.branchAccess[0].branchId;
  const plans = await context.request.get(
    `${api}/plan-versions?branchId=${branchId}`,
  );
  expect(plans.status()).toBe(200);
  const planVersionId = (await plans.json()).data.items[0].id;
  const command = async (path: string, data: object, key: string) => {
    const response = await context.request.post(`${api}${path}`, {
      headers: { Origin: "http://localhost:5173", "Idempotency-Key": key },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data.registration;
  };
  let registration = await command(
    "/registrations",
    {
      branchId,
      planVersionId,
      identity: {
        fullName: "Browser Synthetic",
        phone: "+62811123456789",
        address: "Test only",
        birthDate: "2000-01-01",
      },
    },
    "browser-create",
  );
  registration = await command(
    `/registrations/${registration.id}/submit`,
    { version: registration.version },
    "browser-submit",
  );
  expect(registration.status).toBe("pending_review");
  registration = await command(
    `/registrations/${registration.id}/review`,
    { version: registration.version, decision: "approve" },
    "browser-approve",
  );
  expect(registration.status).toBe("approved");
  expect(registration.orderId).toBeTruthy();
  expect(
    (await (await context.request.get(`${api}/me`)).json()).data.entitlements,
  ).toEqual([]);
  const cookies = await context.cookies();
  expect(
    cookies.some((c) => c.name.includes("session_token") && c.httpOnly),
  ).toBe(true);
  const oldSession = await playwright.request.newContext({
    storageState: await context.storageState(),
  });
  try {
    await page.getByRole("button", { name: "Keluar", exact: true }).click();
    await expect(
      page.getByText("Berhasil keluar.", { exact: true }),
    ).toBeVisible();
    expect((await oldSession.get(`${api}/me`)).status()).toBe(401);
  } finally {
    await oldSession.dispose();
  }
});

test("focus revalidation preserves the selected page with a real session", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Membership", exact: true }).click();
  const heading = page.getByRole("heading", { name: "REGISTRASI MEMBER" });
  await expect(heading).toBeVisible();
  // A DOM marker proves that the private workspace was not unmounted.
  await heading.evaluate((el) => el.setAttribute("data-e2e-mounted", "yes"));
  await focusAndWait(page, 200);
  await expect(heading).toHaveAttribute("data-e2e-mounted", "yes");
});

test("disabled gym account loses private UI and receives 403", async ({
  page,
  context,
}) => {
  await login(page);
  const id = (await (await context.request.get(`${api}/me`)).json()).data.user
    .id;
  try {
    await db.execute(
      "UPDATE gym_user SET enabled = false WHERE gym_id = ? AND user_id = ?",
      [process.env.GYM_ID, id],
    );
    await focusAndWait(page, 403);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("Akses tidak tersedia");
    expect((await context.request.get(`${api}/me`)).status()).toBe(403);
  } finally {
    await db.execute(
      "UPDATE gym_user SET enabled = true WHERE gym_id = ? AND user_id = ?",
      [process.env.GYM_ID, id],
    );
  }
});

test("server-revoked session clears private UI on focus", async ({
  page,
  context,
}) => {
  await login(page);
  const id = (await (await context.request.get(`${api}/me`)).json()).data.user
    .id;
  await db.execute("DELETE FROM auth_session WHERE user_id = ?", [id]);
  await focusAndWait(page, 401);
  await expect(
    page.getByRole("button", { name: "Masuk ke akun" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`UAT package publish member submit clarify correct approve and reject (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    context,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const layout = mobile ? "Mobile" : "Desktop";
    const branchId = await page.getByLabel("Cabang aktif").inputValue();
    page.on("dialog", (d) => d.accept());
    async function orderRows(registrationId: string) {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM registration_order WHERE registration_id = ?",
        [registrationId],
      );
      return rows;
    }
    if (mobile)
      await page.getByRole("button", { name: "Buka navigasi" }).click();
    await page.getByRole("button", { name: "Paket", exact: true }).click();
    await page.getByRole("button", { name: "Buat paket", exact: true }).click();
    await page.getByLabel("Nama paket", { exact: true }).fill(`UAT ${layout}`);
    await page.getByLabel("Harga", { exact: true }).fill("325000.50");
    await page.getByLabel("Durasi", { exact: true }).fill("1");
    await page.getByLabel("Benefit (satu per baris)").fill("Akses gym UAT");
    const draftResponse = page.waitForResponse(
      (r) => r.url() === `${api}/plans` && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Simpan draft", exact: true })
      .click();
    const draft = await draftResponse;
    expect(draft.status()).toBe(201);
    const plan = (await draft.json()).data.plan;
    expect(plan.status).toBe("draft");
    const publicationResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/plans/${plan.id}/publish`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publikasikan paket", exact: true })
      .click();
    const publication = await publicationResponse;
    expect(publication.status()).toBe(200);
    const offer = (await publication.json()).data.publishedVersion;
    expect(offer.planId).toBe(plan.id);
    expect(offer.branchId).toBe(branchId);
    expect(offer.price.amount).toBe("325000.50");
    await expect(
      page.getByRole("region", { name: "Riwayat versi" }),
    ).toContainText("IDR 325000.50");
    if (mobile)
      await page.getByRole("button", { name: "Buka navigasi" }).click();
    await page.getByRole("button", { name: "Membership", exact: true }).click();
    async function create(name: string, phone: string) {
      await page
        .getByRole("button", { name: "Registrasi baru", exact: true })
        .click();
      await page.getByLabel("Nama lengkap").fill(name);
      await page.getByLabel("Nomor WhatsApp").fill(phone);
      await page
        .getByLabel("Alamat domisili")
        .fill("Alamat sintetis untuk demo");
      await page.getByLabel("Tanggal lahir").fill("2000-02-29");
      await page.getByLabel("Paket *").selectOption(offer.id);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(mobile ? 390 : 1280);
      await page
        .getByRole("button", { name: "Simpan draft", exact: true })
        .click();
      await expect(page.locator(".reg-status")).toHaveText("Draft");
      const id = await page.locator(".reg-panel code").first().innerText();
      expect(await orderRows(id)).toHaveLength(0);
      const created = await context.request.get(`${api}/registrations/${id}`);
      expect(created.ok()).toBe(true);
      const saved = (await created.json()).data;
      expect(saved.status).toBe("draft");
      expect(saved.offer.id).toBe(offer.id);
      await page.getByRole("button", { name: "Kirim untuk review" }).click();
      await expect(page.locator(".reg-status")).toHaveText("Menunggu review");
      expect(await orderRows(id)).toHaveLength(0);
      return id;
    }
    const id = await create(
      `UI Synthetic ${mobile ? "Mobile" : "Desktop"}`,
      mobile ? "+6281212345601" : "+6281212345602",
    );
    await page.getByLabel("Alasan review").fill("Mohon lengkapi alamat");
    await page
      .getByRole("button", { name: "Minta perbaikan", exact: true })
      .click();
    await expect(page.locator(".reg-status")).toHaveText("Perlu perbaikan");
    expect(await orderRows(id)).toHaveLength(0);
    await page.getByRole("button", { name: "Perbaiki data" }).click();
    await page.getByLabel("Alamat domisili").fill("Alamat sintetis diperbaiki");
    await focusAndWait(page, 200);
    await expect(page.getByLabel("Alamat domisili")).toHaveValue(
      "Alamat sintetis diperbaiki",
    );
    await page.getByRole("button", { name: "Simpan perbaikan" }).click();
    await expect(
      page.getByRole("button", { name: "Kirim untuk review" }),
    ).toBeVisible();
    const corrected = (
      await (await context.request.get(`${api}/registrations/${id}`)).json()
    ).data;
    expect(corrected.id).toBe(id);
    expect(corrected.identity.address).toBe("Alamat sintetis diperbaiki");
    expect(await orderRows(id)).toHaveLength(0);
    await page.getByRole("button", { name: "Kirim untuk review" }).click();
    await expect(page.locator(".reg-status")).toHaveText("Menunggu review");
    expect(await orderRows(id)).toHaveLength(0);
    const approvalResponse = page.waitForResponse(
      (r) =>
        r.url() === `${api}/registrations/${id}/review` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Setujui", exact: true }).click();
    const approvedResponse = await approvalResponse;
    expect(approvedResponse.status()).toBe(200);
    const approved = (await approvedResponse.json()).data.registration;
    expect(approved.id).toBe(id);
    expect(approved.offer.id).toBe(offer.id);
    expect(approved.offer.price.amount).toBe("325000.50");
    expect(
      approved.history.map((event: { decision: string }) => event.decision),
    ).toEqual(["clarify", "approve"]);
    await expect(page.locator(".reg-status")).toHaveText("Disetujui");
    await expect(
      page.getByText("Membership belum aktif.", { exact: false }),
    ).toBeVisible();
    const orders = await orderRows(id);
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(approved.orderId);
    // Simulate a client retry after approval committed: the same command must
    // return the original order, never create another one.
    const originalRequest = approvedResponse.request();
    const replay = await context.request.post(originalRequest.url(), {
      headers: {
        Origin: "http://localhost:5173",
        "Idempotency-Key": originalRequest.headers()["idempotency-key"],
      },
      data: originalRequest.postDataJSON(),
    });
    expect(replay.status()).toBe(200);
    const replayed = (await replay.json()).data;
    expect(replayed.replayed).toBe(true);
    expect(replayed.registration.orderId).toBe(approved.orderId);
    expect(await orderRows(id)).toHaveLength(1);
    expect(
      (await (await context.request.get(`${api}/me`)).json()).data.entitlements,
    ).toEqual([]);
    await page.getByRole("button", { name: "← Daftar registrasi" }).click();
    const rejected = await create(
      `UI Reject ${mobile ? "Mobile" : "Desktop"}`,
      mobile ? "+6281212345603" : "+6281212345604",
    );
    await page
      .getByLabel("Alasan review")
      .fill("Pengajuan dibatalkan calon member");
    await page.getByRole("button", { name: "Tolak", exact: true }).click();
    await expect(page.locator(".reg-status")).toHaveText("Ditolak");
    await expect(
      page.getByRole("button", { name: "Kirim untuk review" }),
    ).toHaveCount(0);
    const rejectedResponse = await context.request.get(
      `${api}/registrations/${rejected}`,
    );
    expect(rejectedResponse.ok()).toBe(true);
    const rejectedRecord = (await rejectedResponse.json()).data;
    expect(rejectedRecord.status).toBe("rejected");
    expect(rejectedRecord.offer.id).toBe(offer.id);
    expect(rejectedRecord.orderId).toBeUndefined();
    expect(await orderRows(rejected)).toHaveLength(0);
    console.log(
      "UAT_EVIDENCE",
      JSON.stringify({
        viewport: layout.toLowerCase(),
        planId: plan.id,
        planVersionId: offer.id,
        approvedRegistrationId: id,
        orderId: approved.orderId,
        approvedOrderCount: orders.length,
        approvalReplayOrderCount: (await orderRows(id)).length,
        rejectedRegistrationId: rejected,
        rejectedOrderCount: (await orderRows(rejected)).length,
        amount: approved.offer.price.amount,
        membershipActivated: false,
      }),
    );
  });
}
