import { test, expect, type Page } from "@playwright/test";
import type { Registration, PlanVersion } from "../src/contracts";
const plan: PlanVersion = {
  id: "plan",
  planId: "p",
  version: 1,
  branchId: "central",
  name: "Standard",
  publishedAt: "2026-01-01T00:00:00Z",
  price: { amount: "250000.00", currency: "IDR" },
  duration: { value: 1, unit: "month" },
  benefits: ["Gym access"],
};
async function setup(page: Page, mode = "normal") {
  let record: Registration | undefined,
    creates = 0,
    submitCalls = 0;
  const submitKeys: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      body = req.postDataJSON();
    const ok = (data: unknown) => route.fulfill({ json: { data } });
    const fail = (status: number, reasonCode: string) =>
      route.fulfill({
        status,
        json: { error: { reasonCode, requestId: "fixture", retryable: false } },
      });
    if (path.endsWith("/me"))
      return ok({
        user: { id: "u", name: "Admin", email: "a@example.test" },
        gymId: "g",
        branchAccess: [
          { branchId: "central", branchName: "Central", role: "member" },
          { branchId: "central", branchName: "Central", role: "admin" },
          { branchId: "east", branchName: "East", role: "admin" },
        ],
        entitlements: [],
      });
    if (path.includes("/branches/"))
      return ok({ id: path.split("/").pop(), name: "Central" });
    if (path.endsWith("/registration-context"))
      return ok({
        branchId: "central",
        gymId: "g",
        timezone: "Asia/Jakarta",
        today: "2026-10-08",
        asOf: "2026-10-08T00:00:00Z",
        allowedActions: ["create"],
      });
    if (path.endsWith("/plan-versions")) return ok({ items: [plan] });
    if (path.endsWith("/member-candidates"))
      return ok({
        candidateCheckId: "check",
        expiresAt: "2026-10-09T00:00:00Z",
        restrictedMatch: mode === "restricted",
        candidates:
          mode === "duplicate"
            ? [
                {
                  memberId: "existing",
                  displayName: "Member Lama",
                  matchReasons: ["phone"],
                },
              ]
            : [],
      });
    if (path.includes("/members/"))
      return ok({
        id: "existing",
        profileComplete: true,
        accountLinked: false,
        identity: {
          fullName: "Member Lama",
          phone: "+6281234567890",
          address: "Alamat lama",
          birthDate: "2000-02-29",
        },
      });
    if (path.endsWith("/registrations") && req.method() === "GET")
      return ok({
        items: record
          ? [
              {
                ...record,
                fullName: record.identity.fullName,
                planName: plan.name,
              },
            ]
          : [],
      });
    if (path.endsWith("/registrations") && req.method() === "POST") {
      creates++;
      record = {
        id: "reg-1",
        branchId: "central",
        memberId: body.memberId || "member-new",
        identity: body.identity || {
          fullName: "Member Lama",
          phone: "+6281234567890",
          address: "Alamat lama",
          birthDate: "2000-02-29",
        },
        status: "draft",
        version: 1,
        offer: plan,
        createdBy: "u",
        createdAt: "2026-10-08T00:00:00Z",
        updatedAt: "2026-10-08T00:00:00Z",
        allowedActions: ["edit", "submit"],
        history: [],
        profileComplete: true,
      };
      return ok({ commandId: "create", replayed: false, registration: record });
    }
    if (path.endsWith("/submit")) {
      submitCalls++;
      submitKeys.push(req.headers()["idempotency-key"]);
      if (mode === "lost" && submitCalls === 1) return route.abort("failed");
      if (mode === "denied") return fail(403, "ACTION_NOT_ALLOWED");
      if (record) {
        record.status = "pending_review";
        record.version++;
        record.allowedActions = ["approve", "reject", "clarify"];
      }
      return ok({
        commandId: "submit",
        replayed: submitCalls > 1,
        registration: record,
      });
    }
    if (path.endsWith("/review")) {
      if (mode === "conflict") {
        if (record) {
          record.status = "rejected";
          record.version++;
          record.allowedActions = [];
          record.history = [
            {
              decision: "reject",
              reason: "Admin lain menolak",
              actorId: "other",
              at: "2026-10-08T00:00:00Z",
              version: record.version,
            },
          ];
        }
        return fail(409, "STALE_VERSION");
      }
      if (record) {
        record.status =
          body.decision === "approve"
            ? "approved"
            : body.decision === "reject"
              ? "rejected"
              : "needs_clarification";
        record.version++;
        record.allowedActions =
          body.decision === "clarify" ? ["edit", "submit"] : [];
        record.history.push({
          decision: body.decision,
          reason: body.reason || "",
          actorId: "u",
          at: "2026-10-08T00:00:00Z",
          version: record.version,
        });
        if (body.decision === "approve") record.orderId = "order-1";
      }
      return ok({ commandId: "review", replayed: false, registration: record });
    }
    if (path.endsWith("/reg-1")) {
      if (req.method() === "PATCH" && record) {
        record.identity = body.identity;
        record.version++;
      }
      return ok(
        req.method() === "GET"
          ? record
          : { commandId: "edit", replayed: false, registration: record },
      );
    }
    return fail(404, "NOT_FOUND");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Membership", exact: true }).click();
  return {
    counts: () => ({ creates, submitCalls, submitKeys }),
    record: () => record,
  };
}
async function fill(page: Page) {
  await page
    .getByRole("button", { name: "Registrasi baru", exact: true })
    .click();
  await page.getByLabel("Nama lengkap").fill("Synthetic Member");
  await page.getByLabel("Nomor WhatsApp").fill("081234567890");
  await page.getByLabel("Alamat domisili").fill("Alamat sintetis");
  await page.getByLabel("Tanggal lahir").fill("2000-02-29");
  await page.getByLabel("Paket *").selectOption("plan");
}
test("lost submit retains draft and retries identical command; focus retains data", async ({
  page,
}) => {
  const f = await setup(page, "lost");
  await fill(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Nama lengkap")).toHaveValue("Synthetic Member");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await expect(
    page.getByText("Hasil permintaan belum pasti.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("reg-1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Konfirmasi permintaan yang sama" })
    .click();
  await expect(page.locator(".reg-status")).toHaveText("Menunggu review");
  expect(f.counts().creates).toBe(1);
  expect(f.counts().submitKeys[0]).toBe(f.counts().submitKeys[1]);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
});
test("clarify, edit, resubmit, approve and immutable money string", async ({
  page,
}) => {
  const f = await setup(page);
  page.on("dialog", (d) => d.accept());
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.getByText("Standard · IDR 250000.00")).toBeVisible();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await page.getByLabel("Alasan review").fill("Lengkapi alamat");
  await page
    .getByRole("button", { name: "Minta perbaikan", exact: true })
    .click();
  await expect(page.locator(".reg-status")).toHaveText("Perlu perbaikan");
  await page.getByRole("button", { name: "Perbaiki data" }).click();
  await page.getByLabel("Alamat domisili").fill("Alamat diperbaiki");
  await page.getByRole("button", { name: "Simpan perbaikan" }).click();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await page.getByRole("button", { name: "Setujui", exact: true }).click();
  await expect(page.locator(".reg-status")).toHaveText("Disetujui");
  expect(f.record()?.orderId).toBe("order-1");
  expect(f.record()?.identity.address).toBe("Alamat diperbaiki");
});
test("version conflict refresh shows winning decision without overwrite", async ({
  page,
}) => {
  await setup(page, "conflict");
  page.on("dialog", (d) => d.accept());
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await page.getByRole("button", { name: "Setujui", exact: true }).click();
  await page.getByRole("button", { name: "Muat versi terbaru" }).click();
  await expect(page.locator(".reg-status")).toHaveText("Ditolak");
  await expect(
    page.getByRole("button", { name: "Setujui", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Admin lain menolak")).toBeVisible();
});
test("duplicate reuses selected member and restricted candidate blocks creation", async ({
  page,
}) => {
  const f = await setup(page, "duplicate");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  expect(f.counts().creates).toBe(0);
  await page.getByRole("button", { name: "Gunakan member ini" }).click();
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.locator(".reg-status")).toHaveText("Draft");
  expect(f.record()?.memberId).toBe("existing");
});
test("restricted duplicate cannot be bypassed", async ({ page }) => {
  const f = await setup(page, "restricted");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "cabang yang tidak dapat diakses",
  );
  expect(f.counts().creates).toBe(0);
  await expect(page.getByLabel("Alasan orang berbeda")).toHaveCount(0);
});
test("403 on mutation clears all private fields", async ({ page }) => {
  await setup(page, "denied");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByText("Synthetic Member", { exact: true })).toHaveCount(
    0,
  );
});
test("mobile form fits, preserves edits on cancelled navigation, reject requires reason", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.setViewportSize({ width: 1200, height: 900 });
  await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await fill(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "test-results/registration-mobile.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("Cabang aktif").selectOption("east");
  await expect(page.getByLabel("Nama lengkap")).toHaveValue("Synthetic Member");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await page.getByRole("button", { name: "Tolak", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Alasan wajib");
  await page.getByLabel("Alasan review").fill("Tidak sesuai");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Tolak", exact: true }).click();
  await expect(page.locator(".reg-status")).toHaveText("Ditolak");
  await expect(
    page.getByRole("button", { name: "Kirim untuk review" }),
  ).toHaveCount(0);
});

test("distinct-person reason is required and used for create and resubmit", async ({
  page,
}) => {
  const f = await setup(page, "duplicate");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page
    .getByLabel("Alasan orang berbeda")
    .fill("Kontak keluarga yang sama, identitas berbeda");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.locator(".reg-status")).toHaveText("Draft");
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await expect(page.getByLabel("Alasan orang berbeda")).toBeVisible();
  expect(f.counts().submitCalls).toBe(0);
  await page
    .getByLabel("Alasan orang berbeda")
    .fill("Sudah diperiksa sebagai orang berbeda");
  await page.getByRole("button", { name: "Kirim untuk review" }).click();
  await expect(page.locator(".reg-status")).toHaveText("Menunggu review");
});
