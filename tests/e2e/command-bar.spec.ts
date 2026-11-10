import { expect, test, type Page } from "@playwright/test";

/**
 * The command bar (approved redesign PR 4, owner's brief of 10 Nov 2026): Ctrl+K opens a centred 640px search dialog
 * from any page; results are grouped; arrow keys move, Enter opens, Esc closes. Record results are scoped on the
 * server (tests/integration/command-bar.test.ts proves another organisation's records never appear).
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** A fictional demo person's full name and profile address, read from the directory. */
async function demoPerson(page: Page) {
  await page.goto("/rota/service-users");
  const link = page.locator("table tbody tr").first().locator("td").first().locator("a");
  return { name: (await link.innerText()).trim(), href: (await link.getAttribute("href"))! };
}

/** Ctrl+K works once the page has hydrated; retry the key press rather than racing it. */
async function openBar(page: Page) {
  const bar = page.getByTestId("command-bar");
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(bar).toBeVisible({ timeout: 1000 });
  }).toPass();
  return bar;
}

const rgb = (hex: string, alpha: number) => {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return n.map((c) => Math.round(c * alpha + 255 * (1 - alpha)));
};

test.describe("Command bar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Ctrl+K opens a centred 640px dialog; typing a name groups real results; arrows move, Enter opens", async ({ page }) => {
    await signIn(page);
    const person = await demoPerson(page);
    await page.goto("/rota");
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    const bar = await openBar(page);
    await expect(bar).toHaveAttribute("role", "dialog");
    await expect(bar).toHaveAttribute("aria-modal", "true");
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.width)).toBe(640);
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1);
    const input = bar.getByRole("combobox");
    await expect(input).toBeFocused();

    // Before typing: the modules this person may open, and actions.
    await expect(bar.getByRole("group", { name: "Pages" }).getByRole("option", { name: /Rostering & Care Management/ })).toBeVisible();
    await expect(bar.getByRole("group", { name: "Actions" }).getByRole("option", { name: /Add a visit/ })).toBeVisible();

    await input.fill(person.name);
    const people = bar.getByRole("group", { name: "Service users" });
    await expect(people.getByRole("option")).toHaveCount(1);
    await expect(people.getByRole("option").first()).toContainText(person.name);
    // Actions for that person follow, as in the approved design.
    const actions = bar.getByRole("group", { name: "Actions" });
    await expect(actions.getByRole("option", { name: `Add a visit for ${person.name}` })).toBeVisible();
    await expect(actions.getByRole("option", { name: `Open care plans for ${person.name}` })).toBeVisible();
    // Groups appear in the brief's order.
    const order = await bar.locator("[role=group] > div:first-child").allInnerTexts();
    const wanted = ["SERVICE USERS", "STAFF", "VISITS TODAY", "PAGES", "ACTIONS"].filter((g) => order.map((o) => o.toUpperCase()).includes(g));
    expect(order.map((o) => o.toUpperCase())).toEqual(wanted);

    // The first row is highlighted with a 10% tint of the module colour (Rota purple on white), and arrows move it.
    const rows = bar.getByTestId("command-row");
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
    const [r, g, b] = rgb("#6b46c9", 0.1);
    const tint = await rows.first().evaluate((el) => {
      const c = document.createElement("canvas").getContext("2d")!;
      c.fillStyle = "#fff";
      c.fillRect(0, 0, 1, 1);
      c.fillStyle = getComputedStyle(el).backgroundColor;
      c.fillRect(0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
    expect(Math.abs(tint[0]! - r!) + Math.abs(tint[1]! - g!) + Math.abs(tint[2]! - b!)).toBeLessThanOrEqual(3);
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows.first()).toHaveAttribute("aria-selected", "false");
    await expect(input).toHaveAttribute("aria-activedescendant", "command-row-1");
    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
    // Typing stays in the box while the list is driven from it.
    await expect(input).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${person.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(bar).toHaveCount(0);
  });

  test("Esc closes it and returns focus; Tab never leaves the dialog", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const opener = page.getByRole("searchbox", { name: "Search rostering" });
    await opener.focus();
    const bar = await openBar(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(bar.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(opener).toBeFocused();
    // The Esc button and the dimmed page close it too.
    await openBar(page);
    await bar.getByRole("button", { name: "Close search" }).click();
    await expect(bar).toHaveCount(0);
    await openBar(page);
    await page.mouse.click(40, 860);
    await expect(bar).toHaveCount(0);
  });

  test("opens on every module, in that module's colour, and finds pages and actions by name", async ({ page }) => {
    await signIn(page);
    for (const [path, colour] of [["/policies", "#1f5fd1"], ["/rota/visits", "#6b46c9"], ["/hr/dashboard", "#c2410c"], ["/analytics", "#0b6f99"], ["/settings", "#4b5666"], ["/overview", "#1565c0"]] as const) {
      await page.goto(path);
      const bar = await openBar(page);
      expect(await bar.evaluate((el) => getComputedStyle(el).getPropertyValue("--module").trim()), path).toBe(colour);
      await page.keyboard.press("Escape");
      await expect(bar).toHaveCount(0);
    }
    await page.goto("/policies");
    const bar = await openBar(page);
    await bar.getByRole("combobox").fill("daily rota");
    const pages = bar.getByRole("group", { name: "Pages" });
    await expect(pages.getByRole("option", { name: /Daily Rota/ }).first()).toBeVisible();
    await expect(bar.getByTestId("command-row").first()).toContainText("Daily Rota");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();

    await openBar(page);
    await bar.getByRole("combobox").fill("add a service user");
    await expect(bar.getByRole("group", { name: "Actions" }).getByRole("option", { name: /Add a service user/ })).toBeVisible();
    await bar.getByRole("option", { name: /Add a service user/ }).click();
    await expect(page).toHaveURL(/\/rota\/service-users\/new/);
  });

  test("nothing found says so plainly, and the search needs a sign-in", async ({ page, request }) => {
    expect((await request.get("/api/search/command?q=anything")).status()).toBe(401);
    await signIn(page);
    await page.goto("/rota");
    const bar = await openBar(page);
    await bar.getByRole("combobox").fill("zzqxj no such thing");
    await expect(bar.getByRole("status")).toHaveText("Nothing you are allowed to see matches “zzqxj no such thing”.");
    await expect(bar.getByTestId("command-row")).toHaveCount(0);
    expect((await page.request.get(`/api/search/command?q=${"x".repeat(101)}`)).status()).toBe(400);
  });

  test("a member without the rota sees pages and actions only, never people or visits", async ({ page }) => {
    await signIn(page, "finance@care-solution.demo");
    const person = "a";
    const res = await page.request.get(`/api/search/command?q=${person}${person}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ serviceUsers: [], staff: [], visitsToday: [] });
    const bar = await openBar(page);
    await expect(bar.getByRole("group", { name: "Actions" }).getByRole("option", { name: /Add a visit/ })).toHaveCount(0);
    await expect(bar.getByRole("group", { name: "Pages" }).getByRole("option").first()).toBeVisible();
  });

  test("fits a phone without the page scrolling sideways", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await page.setViewportSize({ width: 390, height: 844 });
    const bar = await openBar(page);
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(15);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
