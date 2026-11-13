import { expect, type Page } from "@playwright/test";

/**
 * The Harbour menu (docs/design/harbour, owner's decision of 13 Nov 2026): closed by default, opened from the icon rail
 * (1024px and wider) or the top bar's "Open menu" button. Its links stay in the page while it is closed, so what is
 * current can be read without opening it; following a link needs it open.
 */
export const menu = (page: Page) => page.getByTestId("harbour-menu");
export const mainNav = (page: Page) => menu(page).locator('nav[aria-label="Main"]');
/** The current module's pages (rendered while the module's pages are unfolded, which they are by default). */
export const menuPages = (page: Page) => page.getByTestId("portal-pages").locator("a.hb-ti");
export const currentMenuPage = (page: Page) => menu(page).locator('a.hb-ti[aria-current="page"]');

/** Opens the menu at a module's pages (by default the current module's), unless it is already open. */
export async function openMenu(page: Page, module?: string) {
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  const current = await page.getByTestId("main-content").getAttribute("data-module");
  const trigger = phone ? page.getByRole("button", { name: "Open menu" }) : page.locator(`[data-rail="${module ?? (current && current !== "overview" ? current : "all")}"]`);
  // A click that lands before the page is interactive follows the rail link instead; try again once it is.
  await expect(async () => {
    if ((await menu(page).getAttribute("data-open")) === null) await trigger.click();
    await expect(menu(page)).toHaveAttribute("data-open", "", { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

/** Opens the menu and follows one of its links by its exact name. */
export async function followMenu(page: Page, name: string, module?: string) {
  await openMenu(page, module);
  await mainNav(page).getByRole("link", { name, exact: true }).click();
}
