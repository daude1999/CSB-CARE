import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildTree, libraryHref, matchesQuick, parseLibraryQuery, policyStatus, sortRows, type LibraryRow } from "@/server/policies/library-view";

const NOW = new Date("2026-10-29T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function row(over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: "p1", ref: "CSB-SAF-001", title: "Safeguarding Adults", description: "", docType: "POLICY", categoryCode: "SAFEGUARDING", categoryName: "Safeguarding",
    areaKey: "safeguarding", areaLabel: "Safeguarding", serviceTypes: ["HOME_CARE"], kind: "CUSTOMER", ownerId: null, ownerName: null, reviewerId: null,
    version: "v1", publishedAt: days(-100), updatedAt: days(-100), nextReviewDate: days(300), openRevisionId: null, adopted: false, central: false,
    status: "current", ...over,
  };
}

describe("policy status", () => {
  const published = { publishedAt: days(-100), replacedEarlier: false };
  it("is current once a version is published, with no approval needed", () => {
    expect(policyStatus({ currentPublishedVersion: published, nextReviewDate: days(200) }, NOW)).toBe("current");
  });
  it("is updated for 30 days after a new version replaces an earlier one", () => {
    expect(policyStatus({ currentPublishedVersion: { publishedAt: days(-3), replacedEarlier: true }, nextReviewDate: days(300) }, NOW)).toBe("updated");
    expect(policyStatus({ currentPublishedVersion: { publishedAt: days(-31), replacedEarlier: true }, nextReviewDate: days(300) }, NOW)).toBe("current");
    expect(policyStatus({ currentPublishedVersion: { publishedAt: days(-3), replacedEarlier: false }, nextReviewDate: days(300) }, NOW)).toBe("current");
  });
  it("is a draft when nothing has been published", () => {
    expect(policyStatus({ currentPublishedVersion: null, nextReviewDate: days(-5) }, NOW)).toBe("draft");
  });
  it("flags reviews inside the 60-day window and past the date", () => {
    expect(policyStatus({ currentPublishedVersion: published, nextReviewDate: days(59) }, NOW)).toBe("review_due");
    expect(policyStatus({ currentPublishedVersion: published, nextReviewDate: days(61) }, NOW)).toBe("current");
    expect(policyStatus({ currentPublishedVersion: published, nextReviewDate: days(-1) }, NOW)).toBe("overdue");
  });
});

describe("workspace address", () => {
  it("drops unknown and malformed values and never carries an organisation", () => {
    const q = parseLibraryQuery({ tab: "nope", status: "bogus", sort: "x", page: "-3", selected: "'; drop", category: "safeguarding", organisationId: "org_other", pane: "secret" });
    expect(q).toMatchObject({ tab: "policies", status: undefined, sort: "updated", page: 1, selected: undefined, category: undefined, pane: "document" });
    expect(q).not.toHaveProperty("organisationId");
  });
  it("defaults to templates without an organisation and keeps the old overdue link working", () => {
    expect(parseLibraryQuery({}, false).tab).toBe("templates");
    expect(parseLibraryQuery({ overdue: "1" }).quick).toBe("overdue");
  });
  it("drops an area that doesn't contain the chosen category", () => {
    expect(parseLibraryQuery({ area: "governance", category: "SAFEGUARDING" }).area).toBeUndefined();
    expect(parseLibraryQuery({ area: "safeguarding", category: "SAFEGUARDING" }).area).toBe("safeguarding");
  });
  it("round-trips through libraryHref, leaving defaults out", () => {
    const q = parseLibraryQuery({ q: "falls", status: "overdue", sort: "title", page: "2" });
    expect(libraryHref(q)).toBe("/policies?q=falls&status=overdue&sort=title&page=2");
    expect(parseLibraryQuery(Object.fromEntries(new URL(`http://x${libraryHref(q)}`).searchParams))).toEqual(q);
    expect(libraryHref(parseLibraryQuery({}))).toBe("/policies");
  });
});

describe("register helpers", () => {
  it("groups areas and categories with counts, and puts unmapped categories under Other", () => {
    const tree = buildTree([row(), row({ id: "p2", categoryCode: "CONSENT", categoryName: "Consent" }), row({ id: "p3", categoryCode: "ZZZ", categoryName: "Misc", areaKey: null, areaLabel: null })]);
    const safeguarding = tree.find((n) => n.key === "safeguarding")!;
    expect(safeguarding.count).toBe(2);
    expect(safeguarding.categories.map((c) => [c.code, c.count])).toEqual([["SAFEGUARDING", 1], ["CONSENT", 1]]);
    expect(tree.at(-1)).toMatchObject({ key: "other", count: 1 });
  });
  it("sorts by title, reference, review date and last update", () => {
    const a = row({ id: "a", title: "B", ref: "CSB-B-1", nextReviewDate: days(10), publishedAt: days(-1) });
    const b = row({ id: "b", title: "A", ref: "CSB-A-1", nextReviewDate: days(5), publishedAt: days(-9) });
    expect(sortRows([a, b], "title").map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortRows([a, b], "ref").map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortRows([a, b], "review").map((r) => r.id)).toEqual(["b", "a"]);
    expect(sortRows([b, a], "updated").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("matches quick filters on real dates and submissions", () => {
    expect(matchesQuick(row({ nextReviewDate: days(30) }), "due", NOW)).toBe(true);
    expect(matchesQuick(row({ nextReviewDate: days(-2) }), "due", NOW)).toBe(false);
    expect(matchesQuick(row({ nextReviewDate: days(-2) }), "overdue", NOW)).toBe(true);
    expect(matchesQuick(row({ publishedAt: days(-3) }), "recent", NOW)).toBe(true);
    expect(matchesQuick(row({ openRevisionId: "r1" }), "drafts", NOW)).toBe(true);
    expect(matchesQuick(row(), "drafts", NOW)).toBe(false);
  });
});
