import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Policy Library", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("browses, filters, inspects and reads a policy", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Library" })).toBeVisible();
    const register = page.getByTestId("policy-register");
    await expect(register.getByRole("heading", { level: 2 })).toHaveText(/^Policies \(\d+\)$/);
    await expect(page.getByRole("link", { name: "Create Policy" })).toBeVisible();
    await expect(page.getByText("Upload Policy")).toHaveCount(0);

    // The first policy opens in the inspector, with the real PDF rendered.
    const inspector = page.getByTestId("policy-inspector");
    await expect(inspector.locator("[data-page='1'][data-rendered=true] canvas")).toBeVisible({ timeout: 30_000 });
    await expect(inspector.getByTestId("key-information")).toContainText("Owner");

    // Selecting another row swaps the inspector.
    const second = register.getByTestId("policy-row").nth(1);
    const title = (await second.getByRole("heading").innerText()).trim();
    await second.getByRole("link", { name: title }).first().click();
    await expect(page).toHaveURL(/selected=/);
    await expect(inspector.getByRole("heading", { level: 2 })).toHaveText(title);

    for (const [tab, id] of [["History", "inspector-history"], ["Sign-off", "inspector-signoff"], ["Linked Items", "inspector-linked"]] as const) {
      await inspector.getByRole("tab", { name: tab }).click();
      await expect(inspector.getByTestId(id)).toBeVisible();
    }

    // Category explorer and status filter narrow the register and agree on counts.
    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /^Safeguarding/ }).first().click();
    await expect(page).toHaveURL(/area=safeguarding/);
    const n = Number((await register.getByRole("heading", { level: 2 }).innerText()).match(/\((\d+)\)/)![1]);
    expect(n).toBeGreaterThan(0);
    await page.getByLabel("Status").selectOption("published");
    await expect(page).toHaveURL(/status=published/);
    await expect(page.getByTestId("register-empty").or(register.getByTestId("policy-row").first())).toBeVisible();

    // Search covers titles and policy text, and can be cleared.
    await page.goto("/policies");
    await page.getByRole("searchbox", { name: "Search policies" }).first().fill("safeguarding");
    await page.getByRole("searchbox", { name: "Search policies" }).first().press("Enter");
    await expect(page).toHaveURL(/q=safeguarding/);
    await expect(register.getByTestId("policy-row").first()).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page).not.toHaveURL(/q=/);

    // Templates and the review calendar.
    await page.getByRole("navigation", { name: "Library views" }).getByRole("link", { name: "Templates" }).click();
    await expect(register.getByRole("heading", { level: 2 })).toHaveText(/^Templates \(\d+\)$/);
    await page.getByRole("navigation", { name: "Library views" }).getByRole("link", { name: "Review Calendar" }).click();
    await expect(page.getByTestId("review-calendar")).toBeVisible();
  });

  test("shows the real PDF readably: same pixels as the downloaded file, full-height panel, reader and print", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => {
        (window as unknown as { printed: number }).printed++;
      };
    });
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies");
    const viewer = page.getByTestId("document-viewer");
    await expect(viewer.locator("[data-page='1'][data-rendered=true] canvas")).toBeVisible({ timeout: 30_000 });

    // The panel is a practical reading height, not a 306px strip.
    expect((await viewer.boundingBox())!.height).toBeGreaterThanOrEqual(440);

    const total = Number((await viewer.getByTestId("page-count").innerText()).split("/")[1]);
    expect(total).toBeGreaterThanOrEqual(3);
    await viewer.getByLabel("Next page").click();
    await expect(viewer.getByTestId("page-count")).toHaveText(`2 / ${total}`);

    // The reader opens across the window; at 100% its page is the downloaded PDF drawn by PDF.js, pixel for pixel
    // within anti-aliasing, so what people read in the app is exactly the controlled document.
    await viewer.getByRole("button", { name: "Open full-screen reader" }).click();
    const reader = page.getByTestId("document-reader");
    await expect(reader.locator("[data-page='1'][data-rendered=true] canvas")).toBeVisible();
    expect((await reader.boundingBox())!.height).toBeGreaterThan(900);
    await reader.getByRole("combobox").selectOption("100");
    await reader.getByLabel("Next page").click();
    await expect(reader.getByTestId("page-count")).toHaveText(`2 / ${total}`);
    const second = reader.locator("[data-page='2'][data-rendered=true] canvas");
    await expect(second).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(800);
    const shot = await second.screenshot();
    const href = await reader.getByRole("link", { name: "Download PDF" }).getAttribute("href");
    const pdf = Buffer.from(await (await page.request.get(href!)).body());
    expect(pdf.toString("latin1")).not.toMatch(/\/BaseFont \/Helvetica/);
    const { renderPages, compareWithBaseline } = await import("../support/pdf-inspect");
    const [, reference] = await renderPages(pdf, 1);
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const file = `${mkdtempSync(`${tmpdir()}/viewer-`)}/page2.png`;
    await compareWithBaseline(reference!, file);
    expect((await compareWithBaseline(shot, file, { allowShift: true })).diff).toBeLessThan(0.02);
    await reader.getByRole("navigation", { name: "Sections" }).getByRole("button").first().click();
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);

    // Print draws every page into the print layer and opens the browser's print dialog.
    await viewer.getByRole("button", { name: "Print" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    await expect(page.locator(".pdf-print-root img")).toHaveCount(total);
  });

  test("archives and restores a policy with a reason", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies?sort=title");
    const inspector = page.getByTestId("policy-inspector");
    const title = (await inspector.getByRole("heading", { level: 2 }).innerText()).trim();
    await inspector.getByTitle("More policy actions").click();
    await page.getByRole("button", { name: "Archive policy" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Replaced by a combined policy");
    await dialog.getByRole("button", { name: "Archive policy" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).toHaveURL(/tab=archived/);
    await expect(page.getByTestId("policy-register").getByRole("heading", { level: 2 })).toHaveText("Archived policies (1)");
    await expect(inspector.getByRole("heading", { level: 2 })).toHaveText(title);

    await inspector.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("dialog").getByLabel("Reason").fill("Combined policy withdrawn");
    await page.getByRole("dialog").getByRole("button", { name: "Restore policy" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).not.toHaveURL(/tab=archived/);
  });

  test("care staff can read but not manage", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/policies");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Policy" })).toHaveCount(0);
    const inspector = page.getByTestId("policy-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Assign for Review" })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Create Revision" })).toHaveCount(0);
    // A forged selection of another organisation's policy is "not found", never shown.
    await page.goto("/policies?selected=cmzzzzzzzzzzzzzzzzzzzzzzz");
    await expect(inspector).toContainText("Policy not found");
  });

  test("is keyboard reachable from the search shortcut", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies");
    await page.keyboard.press("Control+k");
    await expect(page.locator("#global-search")).toBeFocused();
    await page.locator("#global-search").fill("medicines");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=medicines/);
  });
});
