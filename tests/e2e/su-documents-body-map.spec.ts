import { expect, test, type Page } from "@playwright/test";

/** Council Documents, Other Documents and the Digital Body Map on a service user's profile. */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function openFirstServiceUser(page: Page) {
  await page.goto("/rota/service-users");
  await page.locator('main a[href^="/rota/service-users/c"]').first().click();
  await expect(page).toHaveURL(/\/rota\/service-users\/c/);
  return page.url().split("?")[0]!;
}

const pdf = (text: string) => ({ name: "support-plan.pdf", mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`) });

test.describe("Service user documents and body map", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("upload a council document, replace it, and keep Other Documents separate", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    const base = await openFirstServiceUser(page);
    await page.getByRole("navigation", { name: "Service user sections" }).getByRole("link", { name: "Documents" }).click();
    const council = page.getByTestId("documents-council");
    await expect(council.getByTestId("required-council-docs")).toContainText("Council Support Plan: missing");
    await council.getByText("Upload Document", { exact: true }).click();
    await council.getByLabel("File").setInputFiles(pdf("version one"));
    await council.getByLabel("Document name").fill("Support plan from adult social care");
    await council.getByLabel("Category").selectOption("COUNCIL_SUPPORT_PLAN");
    await council.getByLabel("Council or issuing authority").fill("Liverpool City Council");
    await council.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Document uploaded");
    await expect(council.getByTestId("required-council-docs")).toContainText("Council Support Plan: held");
    const detail = page.getByTestId("document-detail");
    await expect(detail).toContainText("Support plan from adult social care");
    await expect(detail.getByRole("link", { name: "Preview" }).first()).toHaveAttribute("href", /mode=preview/);
    const download = await page.request.get((await detail.getByRole("link", { name: "Download" }).first().getAttribute("href"))!);
    expect(download.status()).toBe(200);
    expect(await download.text()).toContain("version one");

    await detail.getByText("Replace with a new version").click();
    await detail.getByLabel("New file").setInputFiles(pdf("version two"));
    await detail.getByLabel("What changed (optional)").fill("Hours increased");
    await detail.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("status")).toContainText("New version 2 saved");
    await expect(page.getByTestId("document-versions").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("document-history")).toContainText("Replaced with a new version");

    await page.getByRole("navigation", { name: "Document sections" }).getByRole("link", { name: "Other Documents" }).click();
    await expect(page.getByTestId("documents-other")).toContainText("No other documents yet");
    // Files are never reachable without signing in.
    const href = `${base.replace(/\/rota\/service-users\/.*/, "")}/api/service-users/documents/x`;
    const anon = await page.context().browser()!.newContext();
    // Without a session the request is sent to the sign-in page and the file is never served.
    const res = await anon.request.get(href, { maxRedirects: 0 });
    expect([302, 307, 401]).toContain(res.status());
    if (res.status() !== 401) expect(res.headers()["location"]).toContain("/login");
    await anon.close();
  });

  test("record a body map observation, then a manager decides no incident is needed", async ({ page }) => {
    await signIn(page);
    await openFirstServiceUser(page);
    await page.getByRole("navigation", { name: "Service user sections" }).getByRole("link", { name: "Health and safety" }).click();
    await page.getByRole("navigation", { name: "Health and safety sections" }).getByRole("link", { name: "Body map" }).click();
    await page.getByRole("link", { name: "Record Observation" }).first().click();
    await page.getByRole("group", { name: "Body view" }).getByRole("button", { name: "Back", exact: true }).click();
    const svg = page.getByTestId("body-map-svg");
    const box = (await svg.boundingBox())!;
    // The drawing shows x 25-175 of its 200-wide grid; the sacrum is at the centre, 42% down.
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
    await expect(page.getByTestId("body-map-pin")).toBeVisible();
    await expect(page.getByLabel("Body Location")).toHaveValue("Base of spine (sacrum)");
    await expect(page.getByTestId("body-map-selected-area")).toContainText("Base of spine (sacrum)");
    // Choosing the type on the left fills the form.
    await page.getByRole("group", { name: "Observation Types" }).getByRole("button", { name: "Redness" }).click();
    await expect(page.getByLabel("Observation Type")).toHaveValue("Redness");
    await page.getByLabel("Description (manual entry)").fill("Red patch at the base of the spine, skin intact, blanches when pressed.");
    await page.getByLabel("Pain / Discomfort").selectOption("NONE");
    // Follow-up is required by default, so the date is needed; switching it off removes the need.
    await page.getByRole("switch", { name: "Follow-up Required" }).click();
    await page.getByTestId("body-map-save").click();
    await expect(page.getByRole("status")).toContainText("Observation saved");
    const detail = page.getByTestId("body-map-detail");
    await expect(detail).toContainText("Redness");
    await expect(detail).toContainText("Base of spine (sacrum)");
    await expect(page.getByTestId("body-map-counts")).toContainText("1 awaiting manager review");

    // A manual note is added on top of the observation.
    await detail.getByLabel("Add Note / Update").fill("Reviewed today. Redness has faded and the service user reports no discomfort.");
    await detail.getByRole("button", { name: "Save Note" }).click();
    await expect(page.getByRole("status")).toContainText("Note saved");
    await detail.getByRole("link", { name: /History/ }).click();
    await expect(page.getByTestId("body-map-timeline")).toContainText("Redness has faded");
    await expect(page.getByTestId("body-map-timeline")).toContainText("Observation recorded");

    // The incident decision is in Linked Records.
    await detail.getByRole("link", { name: "Linked Records" }).click();
    await detail.getByLabel("No incident report needed, because").fill("Known pressure area, already in the care plan");
    await detail.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByRole("status")).toContainText("no incident report needed");
    await expect(page.getByTestId("body-map-list")).toContainText("No incident needed");

    // AI suggestions are off until an admin switches them on; the page says so plainly.
    await detail.getByRole("link", { name: /AI Suggestions/ }).click();
    await expect(page.getByTestId("body-map-ai")).toContainText("Switched off for your organisation");
    await expect(page.getByTestId("body-map-ai")).toContainText("do not replace clinical judgement");
    await detail.getByRole("link", { name: "Audit Trail" }).click();
    await expect(page.getByTestId("body-map-audit")).toContainText("Note added");
  });
});
