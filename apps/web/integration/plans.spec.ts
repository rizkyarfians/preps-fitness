import { test, expect } from "@playwright/test";
const api = "http://localhost:3000/api/v1";
for (const mobile of [false, true])
  test(`package UI publishes immutable offers usable by registration (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    context,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Email", { exact: true }).fill("admin@example.test");
    await page
      .getByLabel("Kata sandi", { exact: true })
      .fill(process.env.SEED_PASSWORD!);
    const login = async () => {
      const pending = page.waitForResponse(
        (r) =>
          r.url() === `${api}/auth/sign-in/email` &&
          r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Masuk ke akun" }).click();
      return pending;
    };
    let response = await login();
    if (response.status() === 429) {
      const seconds = Number(response.headers()["x-retry-after"]);
      expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 10).toBe(
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
      response = await login();
    }
    expect(response.status()).toBe(200);
    await expect(
      page.getByText("AKUN TERHUBUNG", { exact: true }),
    ).toBeVisible();
    const me = (await (await context.request.get(`${api}/me`)).json()).data;
    const branchId = me.branchAccess[0].branchId;
    let n = 0;
    const command = async (
      method: "POST" | "PATCH",
      path: string,
      data: object,
    ) => {
      const result = await context.request.fetch(`${api}${path}`, {
        method,
        headers: {
          Origin: "http://localhost:5173",
          "Idempotency-Key": `browser-plan-${mobile}-${++n}-${crypto.randomUUID()}`,
        },
        data,
      });
      expect(result.ok(), await result.text()).toBe(true);
      return (await result.json()).data;
    };
    if (mobile)
      await page.getByRole("button", { name: "Buka navigasi" }).click();
    await page.getByRole("button", { name: "Paket", exact: true }).click();
    await page.getByRole("button", { name: "Buat paket", exact: true }).click();
    const planName = `Browser authored ${mobile ? "mobile" : "desktop"} plan`;
    await page.getByLabel("Nama paket", { exact: true }).fill(planName);
    await page.getByLabel("Harga", { exact: true }).fill("300000");
    await page.getByLabel("Durasi", { exact: true }).fill("1");
    await page.getByLabel("Benefit (satu per baris)").fill("Gym access");
    const saved = page.waitForResponse(
      (r) => r.url() === `${api}/plans` && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Simpan draft", exact: true })
      .click();
    const p = (await (await saved).json()).data.plan;
    expect(p.status).toBe("draft");
    page.once("dialog", (d) => d.accept());
    const published = page.waitForResponse(
      (r) =>
        r.url().includes(`/plans/${p.id}/publish`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publikasikan paket", exact: true })
      .click();
    const publication = (await (await published).json()).data;
    expect(publication.plan.status).toBe("published");
    const offer = publication.publishedVersion;
    await expect(
      page.getByRole("region", { name: "Riwayat versi" }),
    ).toContainText("IDR 300000.00");
    const selected = await context.request.get(
      `${api}/plan-versions/${offer.id}?branchId=${branchId}`,
    );
    expect(selected.status()).toBe(200);
    expect((await selected.json()).data.price.amount).toBe("300000.00");
    let registration = (
      await command("POST", "/registrations", {
        branchId,
        planVersionId: offer.id,
        identity: {
          fullName: mobile
            ? "Package Mobile Synthetic"
            : "Package Desktop Synthetic",
          phone: mobile ? "+62819999555556" : "+62819999555555",
          address: "Test only",
          birthDate: "2000-01-01",
        },
      })
    ).registration;
    registration = (
      await command("POST", `/registrations/${registration.id}/submit`, {
        version: registration.version,
      })
    ).registration;
    expect(registration.status).toBe("pending_review");
    registration = (
      await command("POST", `/registrations/${registration.id}/review`, {
        version: registration.version,
        decision: "approve",
      })
    ).registration;
    expect(registration.orderId).toBeTruthy();
    expect(registration.offer.id).toBe(offer.id);
    await page.getByRole("button", { name: "Edit draft", exact: true }).click();
    await page.getByLabel("Harga", { exact: true }).fill("400000.50");
    await page
      .getByRole("button", { name: "Simpan draft", exact: true })
      .click();
    await expect(
      page.getByText("Draft berhasil disimpan.", { exact: true }),
    ).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Publikasikan paket", exact: true })
      .click();
    const history = page.getByRole("region", { name: "Riwayat versi" });
    await expect(history).toContainText("IDR 400000.50");
    await expect(history).toContainText("IDR 300000.00");
    const preserved = (
      await (
        await context.request.get(`${api}/registrations/${registration.id}`)
      ).json()
    ).data;
    expect(preserved.offer.id).toBe(offer.id);
    expect(preserved.offer.price.amount).toBe("300000.00");
    const selectable = (
      await (
        await context.request.get(
          `${api}/plan-versions/${offer.id}?branchId=${branchId}`,
        )
      ).json()
    ).data;
    expect(selectable.price.amount).toBe("300000.00");
    expect(
      (await (await context.request.get(`${api}/me`)).json()).data.entitlements,
    ).toEqual([]);
  });
