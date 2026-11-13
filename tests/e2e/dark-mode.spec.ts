import { expect, test, type Page } from "@playwright/test";

/** The Light / Dark / Match my device switch, in the account menu on every page (Harbour top bar, 13 Nov 2026). */
async function signIn(page: Page, email = "coordinator@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const mode = (page: Page) => page.locator("html").getAttribute("data-mode");
const background = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("Dark and light appearance", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("starts light, switches to dark and back, and remembers the choice", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    expect(await mode(page)).toBe("light");
    const lightPanel = await background(page, "body");

    const menu = page.getByTestId("account-menu");
    await menu.locator("summary").click();
    await expect(menu.getByTestId("colour-mode-light")).toHaveAttribute("aria-pressed", "true");
    await menu.getByTestId("colour-mode-dark").click();
    expect(await mode(page)).toBe("dark");
    expect(await background(page, "body")).not.toBe(lightPanel);
    await expect(menu.getByTestId("colour-mode-dark")).toHaveAttribute("aria-pressed", "true");

    // The choice survives a reload and a new page, and the server renders it on the first paint.
    await page.goto("/rota");
    expect(await mode(page)).toBe("dark");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "csb-mode")?.value).toBe("dark");

    // Back to normal.
    await page.getByTestId("account-menu").locator("summary").click();
    await page.getByTestId("account-menu").getByTestId("colour-mode-light").click();
    expect(await mode(page)).toBe("light");
    expect(await background(page, "body")).toBe(lightPanel);
    await page.reload();
    expect(await mode(page)).toBe("light");
  });

  test("'Match my device' follows the device setting", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto("/rota");
    expect(await mode(page)).toBe("light");
    await page.getByTestId("account-menu").locator("summary").click();
    await page.getByTestId("account-menu").getByTestId("colour-mode-system").click();
    expect(await mode(page)).toBe("dark");
    await page.reload();
    expect(await mode(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => mode(page)).toBe("light");
    await context.close();
  });

  test("the Overview offers the same choice in the account menu, without changing its header", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByTestId("overview-header").getByTestId("colour-mode-menu")).toHaveCount(0);
    await page.getByTestId("account-menu").locator("summary").click();
    await page.getByTestId("account-menu").getByTestId("colour-mode-dark").click();
    expect(await mode(page)).toBe("dark");
    await expect(page.getByTestId("account-menu").getByTestId("colour-mode-dark")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("account-menu").getByTestId("colour-mode-light").click();
    expect(await mode(page)).toBe("light");
  });

  test("the page header's main action keeps white text on a deep navy button in the dark", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "csb-mode", value: "dark", url: baseURL! }]);
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/");
    expect(await mode(page)).toBe("dark");
    // Harbour (13 Nov 2026): Create policy is the header's navy main action; in the dark it is a deeper navy so the
    // white text stays readable (at least 4.5:1).
    const current = page.getByTestId("title-bar").getByRole("link", { name: "Create policy" });
    await expect(current).toHaveCSS("color", "rgb(255, 255, 255)");
    const bg = await current.evaluate((el) => getComputedStyle(el).backgroundColor);
    const lum = (c: string) => { const [r, g, b] = c.match(/[\d.]+/g)!.map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    expect(1.05 / (lum(bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
    // The header strip is toned down towards the dark page, so it is not the light-mode colour.
    const band = await background(page, ".mh-band");
    await context.addCookies([{ name: "csb-mode", value: "light", url: baseURL! }]);
    await page.reload();
    expect(await background(page, ".mh-band")).not.toBe(band);
  });
});
