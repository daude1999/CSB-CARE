import { expect, test, type Page } from "@playwright/test";

/**
 * Service user Call Notes in the browser (4 Nov 2026), synthetic demo people only: the tab sits beside the existing
 * groups, a coordinator organises a telephone note and checks it, a manager approves it, search and filters work,
 * and Visit Notes stay where they were.
 */
const PASSWORD = "DemoPassword!2026";
const TEXT = "Spoke to the daughter today. She said her mother has not been sleeping well, she would prefer carers to arrive slightly earlier in the morning and she is waiting for the GP to call about her medication.";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

let person = "";

test.describe.serial("Call Notes", () => {
  test("the Call Notes tab is in the profile navigation and Visit Notes are unchanged", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.locator('main a[href^="/rota/service-users/c"]').first().click();
    const groups = page.getByRole("navigation", { name: "Service user sections" });
    await expect(groups.getByRole("link", { name: "Call Notes", exact: true })).toBeVisible();
    person = page.url().split("?")[0]!;
    const labels = await groups.getByRole("link").allInnerTexts();
    expect(labels.map((l) => l.trim())).toEqual(["Overview", "Personal details", "Reference Numbers", "Care", "Health and safety", "Visits", "Documents", "Contacts & carers", "Call Notes", "History"]);
    await groups.getByRole("link", { name: "Call Notes", exact: true }).click();
    await expect(page).toHaveURL(/tab=call-notes/);
    await expect(page.getByRole("heading", { name: "Call Notes", exact: true })).toBeVisible();
    await expect(page.getByText("Record conversations, communications and follow-up information relating to this service user.")).toBeVisible();
    await expect(page.getByText(/No Call Notes have been recorded for/)).toBeVisible();
    await page.goto(`${person}?tab=notes`);
    await expect(page.getByRole("heading", { name: "Visit notes" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filter visit notes" })).toBeVisible();
  });

  test("a coordinator organises a telephone note, checks each bullet and sends it for review", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto(`${person}?tab=call-notes`);
    await page.getByRole("link", { name: "Add Call Note" }).click();
    const form = page.getByTestId("new-call-note");
    await form.getByLabel("Person contacted").fill("Jane Example");
    await form.getByLabel("Relationship or professional role").fill("Daughter");
    await form.getByLabel("Detailed notes").fill(TEXT);
    await form.getByRole("button", { name: /Organise/ }).click();
    const draft = page.getByTestId("call-note-draft");
    await expect(draft).toBeVisible();
    await expect(draft.getByText("Organised by keyword rules, no AI")).toBeVisible();
    await expect(draft.getByTestId("draft-item")).toHaveCount(4);
    await expect(draft.getByText(TEXT)).toBeVisible();
    await expect(draft.getByTestId("draft-item").nth(2).getByLabel("Belongs in")).toHaveValue("ROTA");
    await expect(draft.getByTestId("draft-item").nth(3).getByLabel("Belongs in")).toHaveValue("MEDICATION");
    await expect(draft.getByText("Needs authorised verification. No medication change is made from a Call Note.")).toBeVisible();
    await draft.getByLabel("Create task").first().check();
    await draft.getByLabel("Assign to").first().selectOption({ label: "Casey Coordinator" });
    await draft.getByRole("button", { name: "Save and send for review" }).click();
    await expect(page.getByText(/saved and sent for review/)).toBeVisible();
    const card = page.getByTestId("call-note").first();
    await expect(card).toContainText("Telephone conversation");
    await expect(card).toContainText("Awaiting Review");
    await expect(card).toContainText("Spoke with: Jane Example (Daughter)");
    await expect(card.getByText("Waiting for a manager who did not write this note.")).toBeVisible();
  });

  test("a manager approves it; routed items wait in their records' queues and the follow-up shows", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto(`${person}?tab=call-notes`);
    const card = page.getByTestId("call-note").first();
    await card.locator("summary").first().click();
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status").getByText(/approved/).or(page.getByText(/CALL-\d{4}-\d{6} approved/)).first()).toBeVisible();
    const open = page.getByTestId("call-note").first();
    await expect(open).toContainText("Follow-up Required");
    await expect(open).toContainText("Sent to other records");
    await expect(open).toContainText("Care Package / Rota");
    await expect(open).toContainText("Information requiring clinical verification; no medication change authorised.");
    await expect(open.getByTestId("call-note-task")).toContainText("Assigned to Casey Coordinator");
  });

  test("search and filters work, with clear empty states", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto(`${person}?tab=call-notes`);
    const search = page.getByRole("search", { name: "Search and filter Call Notes" });
    await search.getByLabel("Search notes").fill("sleeping");
    await search.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("call-note")).toHaveCount(1);
    await search.getByLabel("Search notes").fill("");
    await search.getByLabel("Type").selectOption("EMAIL");
    await search.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("No Call Notes match these filters.")).toBeVisible();
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page.getByTestId("call-note")).toHaveCount(1);
  });

  test("a carer cannot open Call Notes", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    const res = await page.goto(`${person}?tab=call-notes`);
    expect(await page.getByTestId("call-notes").count()).toBe(0);
    expect(res?.status()).not.toBe(500);
  });
});
