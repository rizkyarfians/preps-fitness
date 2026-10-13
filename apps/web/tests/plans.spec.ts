import { test, expect, type Page } from "@playwright/test";
import type { ManagedPlan, PlanPublication } from "../src/contracts";
const content = {
  name: "Standard",
  price: { amount: "350000.00", currency: "IDR" },
  duration: { value: 1, unit: "month" as const },
  benefits: ["Akses gym"],
};
async function setup(page: Page, mode = "normal") {
  let record: ManagedPlan | undefined,
    creates = 0,
    edits = 0,
    publications: PlanPublication[] = [];
  const writes: { path: string; key: string | undefined; body: unknown }[] = [];
  let lost = false,
    stale = false;
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { data } });
    const fail = (status: number, reasonCode: string) =>
      route.fulfill({
        status,
        json: {
          error: { reasonCode, requestId: "test-plans", retryable: false },
        },
      });
    if (path.endsWith("/me"))
      return ok({
        user: { id: "u", name: "Admin", email: "a@example.test" },
        gymId: "g",
        branchAccess: [
          { branchId: "central", branchName: "Central", role: "admin" },
          { branchId: "east", branchName: "East", role: "admin" },
        ],
        entitlements: [],
      });
    if (path.includes("/branches/"))
      return ok({ id: path.split("/").pop(), name: "Central" });
    if (req.method() !== "GET") {
      writes.push({
        path,
        key: req.headers()["idempotency-key"],
        body: req.postDataJSON(),
      });
      if (mode === "denied") return fail(403, "BRANCH_ACCESS_DENIED");
    }
    const result = (publishedVersion?: unknown) =>
      ok({
        commandId: "cmd",
        replayed: false,
        plan: record,
        ...(publishedVersion ? { publishedVersion } : {}),
      });
    if (path.endsWith("/plans")) {
      if (req.method() === "GET") {
        if (mode === "pages" && !url.searchParams.has("cursor"))
          return ok({ items: [], nextCursor: "next" });
        return ok({ items: record ? [record] : [] });
      }
      if (!record) {
        creates++;
        record = {
          id: "p1",
          branchId: "central",
          draft: req.postDataJSON().draft,
          version: 1,
          status: "draft",
          createdAt: "2026-10-12T00:00:00Z",
          updatedAt: "2026-10-12T00:00:00Z",
          allowedActions: ["edit", "publish"],
        };
      }
      if (mode === "lost-create" && !lost) {
        lost = true;
        return route.abort();
      }
      return result();
    }
    if (path.endsWith("/versions")) {
      if (
        mode === "pages" &&
        publications.length > 1 &&
        !url.searchParams.has("cursor")
      )
        return ok({ items: publications.slice(0, 1), nextCursor: "more" });
      return ok({
        items:
          mode === "pages" && url.searchParams.has("cursor")
            ? publications.slice(1)
            : publications,
      });
    }
    if (path.endsWith("/publish") && record) {
      if (!lost || mode !== "lost-publish") {
        const offer = {
          ...content,
          ...record.draft,
          id: `v${publications.length + 1}`,
          planId: record.id,
          branchId: "central",
          version: publications.length + 1,
          publishedAt: "2026-10-12T01:00:00Z",
        };
        publications.push({ offer, selectable: true });
        record.status = "published";
        record.version++;
        record.latestVersionId = offer.id;
        record.allowedActions = ["edit"];
      }
      if (mode === "lost-publish" && !lost) {
        lost = true;
        return route.abort();
      }
      return result(publications.at(-1)?.offer);
    }
    if (path.endsWith("/p1") && record) {
      if (req.method() === "PATCH") {
        if (mode === "stale" && !stale) {
          stale = true;
          record.draft = { ...content, name: "Perubahan admin lain" };
          record.version++;
          return fail(409, "STALE_VERSION");
        }
        record.draft = req.postDataJSON().draft;
        record.version++;
        record.status = "draft";
        record.allowedActions = ["edit", "publish"];
        edits++;
        return result();
      }
      return ok(record);
    }
    return fail(404, "NOT_FOUND");
  });
  await page.goto("/");
  if (page.viewportSize()!.width < 760)
    await page.getByRole("button", { name: "Buka navigasi" }).click();
  await page.getByRole("button", { name: "Paket", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "KELOLA PAKET" }),
  ).toBeVisible();
  return {
    stats: () => ({ creates, edits, publications, writes }),
    seed: () => {
      record = {
        id: "p1",
        branchId: "central",
        draft: content,
        status: "draft",
        version: 1,
        allowedActions: ["edit", "publish"],
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
      };
    },
  };
}
async function fill(page: Page) {
  await page.getByRole("button", { name: "Buat paket", exact: true }).click();
  await page.getByLabel("Nama paket", { exact: true }).fill("Standard");
  await page.getByLabel("Harga", { exact: true }).fill("350000");
  await page.getByLabel("Durasi", { exact: true }).fill("1");
  await page
    .getByLabel("Benefit (satu per baris)", { exact: true })
    .fill("Akses gym");
}
async function publish(page: Page) {
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Publikasikan paket", exact: true })
    .click();
}
test("create, edit and publish immutable history with exact decimal strings and pagination", async ({
  page,
}) => {
  const f = await setup(page, "pages");
  f.seed();
  await page.getByRole("button", { name: "Muat paket berikutnya" }).click();
  await page.getByRole("button", { name: /Standard.*350000/ }).click();
  await publish(page);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Harga", { exact: true }).fill("999999999999.99");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await publish(page);
  await page.getByRole("button", { name: "Muat riwayat berikutnya" }).click();
  const history = page.getByRole("region", { name: "Riwayat versi" });
  await expect(history).toContainText("IDR 350000.00");
  await expect(history).toContainText("IDR 999999999999.99");
  expect(f.stats().publications.map((p) => p.offer.price.amount)).toEqual([
    "350000.00",
    "999999999999.99",
  ]);
  await page.screenshot({
    path: "test-results/plans-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("unknown create keeps exact key and body, blocks navigation, avoids duplicate plan", async ({
  page,
}) => {
  const f = await setup(page, "lost-create");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Konfirmasi hasil permintaan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Harga", { exact: true })).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Membership", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "KELOLA PAKET" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Konfirmasi hasil permintaan" })
    .click();
  await expect(
    page.getByText("Draft berhasil disimpan.", { exact: true }),
  ).toBeVisible();
  expect(f.stats().creates).toBe(1);
  expect(f.stats().writes[0]).toEqual(f.stats().writes[1]);
});
test("lost publish retries original command and shows one publication", async ({
  page,
}) => {
  const f = await setup(page, "lost-publish");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await publish(page);
  await page
    .getByRole("button", { name: "Konfirmasi hasil permintaan" })
    .click();
  await expect(
    page.getByText("Versi 1 berhasil dipublikasikan.", { exact: false }),
  ).toBeVisible();
  expect(f.stats().publications).toHaveLength(1);
  expect(f.stats().writes[1]).toEqual(f.stats().writes[2]);
});
test("stale edit cannot overwrite another admin without reviewing current version", async ({
  page,
}) => {
  const f = await setup(page, "stale");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Nama paket").fill("My edit");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Simpan draft", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Muat versi terbaru", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Perubahan admin lain", exact: true }),
  ).toBeVisible();
  expect(f.stats().edits).toBe(0);
});
test("mobile draft validates money and benefits, focus and cancelled branch switch retain edits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const f = await setup(page);
  await fill(page);
  await page.getByLabel("Harga", { exact: true }).fill("1e5");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Gunakan angka");
  expect(f.stats().creates).toBe(0);
  await page.getByLabel("Harga", { exact: true }).fill("350000.50");
  await page.getByLabel("Benefit (satu per baris)").fill("Gym\nGym");
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("benefit unik");
  await page.getByLabel("Benefit (satu per baris)").fill("Gym");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("Cabang aktif").selectOption("east");
  await expect(page.getByLabel("Harga", { exact: true })).toHaveValue(
    "350000.50",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "test-results/plans-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  expect(f.stats().creates).toBe(1);
});
test("incomplete draft saves but cannot publish; permission loss clears private UI", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Buat paket", exact: true }).click();
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publikasikan paket", exact: true }),
  ).toBeDisabled();
  await page.unrouteAll();
  await setup(page, "denied");
  await fill(page);
  await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "KELOLA PAKET" })).toHaveCount(
    0,
  );
});
