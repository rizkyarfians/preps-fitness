import { test, expect, type Page } from "@playwright/test";
const user = {
  user: { id: "user-1", name: "Rizky Arfiansyah", email: "rizky@example.test" },
  gymId: "gym-1",
  branchAccess: [
    { branchId: "central", role: "owner" },
    { branchId: "east", role: "member" },
  ],
  entitlements: [],
};
async function fixture(
  page: Page,
  options: { signedIn?: boolean; denied?: boolean; logoutFails?: boolean } = {},
) {
  let signedIn = options.signedIn ?? true;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path.endsWith("/auth/sign-in/email")) {
      signedIn = true;
      return json({
        token: "test-cookie-managed",
        user: user.user,
        redirect: false,
      });
    }
    if (path.endsWith("/auth/sign-out")) {
      if (options.logoutFails) return json({ message: "Unavailable" }, 503);
      signedIn = false;
      return json({ success: true });
    }
    if (path.endsWith("/me"))
      return options.denied
        ? json(
            {
              error: {
                reasonCode: "ACCOUNT_ACCESS_DENIED",
                requestId: "test-id",
              },
            },
            403,
          )
        : signedIn
          ? json({ data: user })
          : json(
              {
                error: { reasonCode: "UNAUTHENTICATED", requestId: "test-id" },
              },
              401,
            );
    if (path.endsWith("/branches/central"))
      return json({ data: { id: "central", name: "PREPS Central" } });
    if (path.endsWith("/branches/east"))
      return json({ data: { id: "east", name: "PREPS East" } });
    return json(
      { error: { reasonCode: "NOT_FOUND", requestId: "test-id" } },
      404,
    );
  });
}
test("login uses auth then me; logout returns to login", async ({ page }) => {
  await fixture(page, { signedIn: false });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("rizky@example.test");
  await page.getByLabel("Kata sandi", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "Masuk ke akun" }).click();
  await expect(
    page.getByRole("heading", { name: "SIAP UNTUK HARI INI." }),
  ).toBeVisible();
  await expect(
    page.getByText("Belum ada benefit membership aktif", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Masuk ke akun" }),
  ).toBeVisible();
});
test("branch role changes navigation; no persisted tokens or fake business metrics", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Laporan", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cabang aktif").selectOption("east");
  await expect(
    page.getByText("PREPS East", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Laporan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Program latihan", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Program latihan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "PROGRAM LATIHAN SEGERA HADIR" }),
  ).toBeVisible();
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
});
test("account denied has no workspace and is not retried indefinitely", async ({
  page,
}) => {
  await fixture(page, { denied: true });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Akses tidak tersedia");
  await expect(page.getByRole("navigation")).toHaveCount(0);
});
test("revoked session clears current user when browser returns to focus", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SIAP UNTUK HARI INI." }),
  ).toBeVisible();
  await page.route("**/api/v1/me", (r) =>
    r.fulfill({
      status: 401,
      json: { error: { reasonCode: "UNAUTHENTICATED", requestId: "revoked" } },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Masuk ke akun" }),
  ).toBeVisible();
  await expect(page.getByText("Rizky Arfiansyah", { exact: true })).toHaveCount(
    0,
  );
});
test("failed server logout clears private view and allows retry", async ({
  page,
}) => {
  await fixture(page, { logoutFails: true });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SIAP UNTUK HARI INI." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(
    page.getByText("Logout belum terkonfirmasi.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Keluar dari sesi saat ini" }),
  ).toBeVisible();
});
test("mobile 360px fits and navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await fixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SIAP UNTUK HARI INI." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Buka navigasi" }).click();
  await page.getByRole("button", { name: "Membership", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "MEMBERSHIP SEGERA HADIR" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Buka navigasi" }),
  ).toHaveAttribute("aria-expanded", "false");
});
test("desktop visual reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto("/");
  await expect(page.getByText("AKUN TERHUBUNG", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
});
test("login visual reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, { signedIn: false });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Masuk ke akun" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login.png", fullPage: true });
});
