import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { bookmarksFor, savedReading, toggleBookmark } from "@/server/policies/bookmarks";
import { missingParts, policyPartFor, readerParts, resourcePartFor, sectionForView } from "@/lib/policy-reader";
import { BROOKFIELD, OAKRIDGE, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * The Policy Reader (owner's spec of 5 Nov 2026): how a version's sections become one continuous document, and the
 * reader's own "Mark as Important" / "Add to Reading List" markers against a real database.
 */
let orgId = "";
beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

describe("reader document structure", () => {
  it("keeps every seeded section exactly once, in reading order, for every policy in the library", async () => {
    const policies = await db.policy.findMany({ where: { docType: { in: ["POLICY", "PROCEDURE", "GUIDANCE"] } }, include: { currentPublishedVersion: { include: { sections: true } } } });
    expect(policies.length).toBeGreaterThan(5);
    for (const p of policies) {
      const sections = p.currentPublishedVersion?.sections ?? [];
      const parts = readerParts(sections, "policy");
      const placed = parts.flatMap((x) => x.sections.map((s) => s.key));
      expect(placed.sort()).toEqual(sections.map((s) => s.key).sort());
      // Parts with nothing written are left out rather than shown as empty headings.
      for (const part of parts) expect(part.sections.length > 0 || part.derived).toBeTruthy();
    }
  });

  it("puts named sections in the parts the reader's strip shows", () => {
    expect(policyPartFor("purpose")).toBe("purpose");
    expect(policyPartFor("statement")).toBe("policy");
    expect(policyPartFor("responsibilities")).toBe("policy");
    expect(policyPartFor("procedure.reporting")).toBe("procedure");
    expect(policyPartFor("escalation")).toBe("procedure");
    expect(policyPartFor("training")).toBe("monitoring");
    expect(policyPartFor("appendix.tower-hamlets")).toBe("appendices");
    expect(policyPartFor("branch.contacts")).toBe("appendices");
    expect(policyPartFor("framework")).toBe("further-reading");
    expect(policyPartFor("generated.references")).toBe("further-reading");
    expect(policyPartFor("keyfacts.staff")).toBe("keyfacts-staff");
    expect(policyPartFor("keyfacts.service-users")).toBe("keyfacts-service-users");
    expect(policyPartFor("objectives")).toBe("objectives");
    expect(policyPartFor("outstanding-practice")).toBe("outstanding-practice");
    expect(policyPartFor("something-new")).toBe("policy");
    expect(resourcePartFor("questions")).toBe("questions");
    expect(resourcePartFor("purpose")).toBe("about");
  });

  it("derives staff key facts from the procedure only when none are written, and says which parts are missing", () => {
    const sections = [
      { key: "purpose", heading: "Purpose", body: "Why." },
      { key: "procedure.one", heading: "Step", body: "Do this first. Then that." },
    ];
    const parts = readerParts(sections, "policy");
    expect(parts.map((p) => p.id)).toEqual(["purpose", "procedure", "keyfacts-staff"]);
    expect(parts.find((p) => p.id === "keyfacts-staff")?.derived).toBe(true);
    expect(missingParts(parts)).toEqual(["Scope", "Objectives", "Policy", "Definitions", "Key Facts (Staff)", "Key Facts (Service Users)", "Further Reading"]);
    const written = readerParts([...sections, { key: "keyfacts.staff", heading: "Key facts", body: "Fact." }], "policy");
    expect(written.find((p) => p.id === "keyfacts-staff")?.derived).toBeUndefined();
  });

  it("opens older ?view= links at the matching section", () => {
    expect(sectionForView("procedure")).toBe("procedure");
    expect(sectionForView("text")).toBe("policy");
    expect(sectionForView("forms")).toBe("forms");
    expect(sectionForView("history")).toBeUndefined();
  });
});

describe("Mark as Important and Add to Reading List", () => {
  it("toggles the signed-in person's own markers, records an audit entry and lists saved reading", async () => {
    const m = await ctxFor("manager@care-solution.demo", BROOKFIELD);
    const p = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    expect(await bookmarksFor(m, p.id)).toEqual({ IMPORTANT: false, READING_LIST: false });
    expect(await toggleBookmark(m, p.id, "IMPORTANT")).toBe(true);
    expect(await toggleBookmark(m, p.id, "READING_LIST")).toBe(true);
    expect(await bookmarksFor(m, p.id)).toEqual({ IMPORTANT: true, READING_LIST: true });
    expect((await savedReading(m)).map((s) => s.ref)).toEqual(["CSB-SAF-001"]);
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "policy.bookmark.added" } })).toBe(2);

    // Another person in the same organisation has their own markers.
    const carer = await ctxFor("carer1@care-solution.demo", BROOKFIELD);
    expect(await bookmarksFor(carer, p.id)).toEqual({ IMPORTANT: false, READING_LIST: false });
    expect(await savedReading(carer)).toEqual([]);

    expect(await toggleBookmark(m, p.id, "IMPORTANT")).toBe(false);
    expect(await bookmarksFor(m, p.id)).toEqual({ IMPORTANT: false, READING_LIST: true });
    expect(await db.auditLog.count({ where: { entityId: p.id, action: "policy.bookmark.removed" } })).toBe(1);
  });

  it("does not let another organisation bookmark, or see, a policy it cannot read", async () => {
    const other = await ctxFor("manager@oakridge.demo", OAKRIDGE);
    const p = await db.policy.findFirstOrThrow({ where: { organisationId: orgId, ref: "CSB-SAF-001" } });
    await expect(toggleBookmark(other, p.id, "READING_LIST")).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.policyBookmark.count({ where: { policyId: p.id, organisationId: { not: orgId } } })).toBe(0);
  });
});
