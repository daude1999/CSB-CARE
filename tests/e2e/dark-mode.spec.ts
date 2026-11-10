import { expect, test, type Page } from "@playwright/test";

/** The Light / Dark / Match my device switch in the top bar and in the Overview's account menu. */
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

    const menu = page.getByTestId("colour-mode-menu");
    await expect(menu.locator("summary")).toHaveAttribute("aria-label", "Appearance: Light");
    await menu.locator("summary").click();
    await menu.getByTestId("colour-mode-dark").click();
    expect(await mode(page)).toBe("dark");
    expect(await background(page, "body")).not.toBe(lightPanel);
    await expect(menu.locator("summary")).toHaveAttribute("aria-label", "Appearance: Dark");

    // The choice survives a reload and a new page, and the server renders it on the first paint.
    await page.goto("/rota");
    expect(await mode(page)).toBe("dark");
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "csb-mode")?.value).toBe("dark");

    // Back to normal.
    await page.getByTestId("colour-mode-menu").locator("summary").click();
    await page.getByTestId("colour-mode-light").click();
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
    await page.getByTestId("colour-mode-menu").locator("summary").click();
    await page.getByTestId("colour-mode-system").click();
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

  test("the header band's main action stays a white button with readable text in the dark", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "csb-mode", value: "dark", url: baseURL! }]);
    await signIn(page);
    await page.goto("/rota/visits");
    expect(await mode(page)).toBe("dark");
    // The current view (Board) is the band's main action: white, with the module colour as its text.
    const current = page.locator('.mh-band nav[aria-label="Rota view"] [aria-current="page"]');
    await expect(current).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const text = await current.evaluate((el) => getComputedStyle(el).color);
    const moduleColour = await page.locator("main").evaluate((el) => getComputedStyle(el).getPropertyValue("--module").trim());
    expect(text).not.toBe("rgb(255, 255, 255)");
    expect(moduleColour).not.toBe("");
    // The band is toned down towards the dark page, so it is not the full-strength light-mode colour.
    const band = await background(page, ".mh-band");
    await context.addCookies([{ name: "csb-mode", value: "light", url: baseURL! }]);
    await page.reload();
    expect(await background(page, ".mh-band")).not.toBe(band);
  });
});
