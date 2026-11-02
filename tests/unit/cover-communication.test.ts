import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { arrangementKey, arrangementOf, authorityOf, commsOutstanding, communicationState, describeArrangement, telHref, type AttemptLike } from "@/server/rota/cover-communication";
import { coverTargetFrom } from "@/server/rota/replacement-cover";

const NOW = new Date("2026-11-02T10:00:00Z");
let n = 0;
const attempt = (p: Partial<AttemptLike>): AttemptLike => ({
  id: `a${++n}`, outcome: "NO_ANSWER", arrangementKey: "K1", contactedAt: new Date(NOW.getTime() - 3600_000 + n * 1000), createdAt: new Date(NOW.getTime() - 3600_000 + n * 1000),
  correctsId: null, notApplicableReason: null, followUpRequired: false, followUpOwnerId: null, followUpDueAt: null, followUpDoneAt: null, ...p,
});

describe("communication state", () => {
  it("is 'not yet contacted' with no attempts: a state, not a fabricated attempt", () => {
    const s = communicationState([], "K1", NOW);
    expect(s.kind).toBe("NOT_CONTACTED");
    expect(s.effective).toEqual([]);
    expect(commsOutstanding(s.kind)).toBe(true);
  });

  it("keeps a message left or no answer as attempted, never informed", () => {
    expect(communicationState([attempt({ outcome: "MESSAGE_LEFT" })], "K1", NOW).kind).toBe("ATTEMPTED");
    expect(communicationState([attempt({ outcome: "NO_ANSWER" }), attempt({ outcome: "UNSUCCESSFUL" })], "K1", NOW).kind).toBe("ATTEMPTED");
  });

  it("is informed only for the arrangements as they stand now", () => {
    const told = attempt({ outcome: "INFORMED", arrangementKey: "K1" });
    expect(communicationState([attempt({ outcome: "MESSAGE_LEFT" }), told], "K1", NOW).kind).toBe("INFORMED");
    // The carer or time changed after they were told: the earlier record stays, and an update is owed.
    const changed = communicationState([told], "K2", NOW);
    expect(changed.kind).toBe("UPDATE_NEEDED");
    expect(changed.effective.map((a) => a.id)).toEqual([told.id]);
    // Telling them again about the new arrangements settles it.
    expect(communicationState([told, attempt({ outcome: "INFORMED", arrangementKey: "K2" })], "K2", NOW).kind).toBe("INFORMED");
  });

  it("records not applicable with its reason", () => {
    const s = communicationState([attempt({ outcome: "NOT_APPLICABLE", notApplicableReason: "In hospital this week" })], "K1", NOW);
    expect(s).toMatchObject({ kind: "NOT_APPLICABLE", reason: "In hospital this week" });
    expect(commsOutstanding(s.kind)).toBe(false);
  });

  it("replaces a corrected entry with its correction and keeps the original out of the state", () => {
    const wrong = attempt({ outcome: "INFORMED" });
    const fix = attempt({ outcome: "MESSAGE_LEFT", correctsId: wrong.id, contactedAt: wrong.contactedAt });
    const s = communicationState([wrong, fix], "K1", NOW);
    expect(s.kind).toBe("ATTEMPTED");
    expect(s.effective.map((a) => a.id)).toEqual([fix.id]);
  });

  it("orders by the actual contact time, not the time it was typed in", () => {
    const later = attempt({ outcome: "INFORMED", contactedAt: new Date(NOW.getTime() - 600_000), createdAt: new Date(NOW.getTime() - 590_000) });
    // Recorded afterwards, but it happened earlier.
    const earlier = attempt({ outcome: "NO_ANSWER", contactedAt: new Date(NOW.getTime() - 7200_000), createdAt: NOW });
    const s = communicationState([later, earlier], "K1", NOW);
    expect(s.effective.map((a) => a.id)).toEqual([earlier.id, later.id]);
    expect(s.kind).toBe("INFORMED");
  });

  it("reports the open follow-up, its owner and whether it is overdue", () => {
    const s = communicationState([attempt({ outcome: "NO_ANSWER", followUpRequired: true, followUpOwnerId: "u2", followUpDueAt: new Date(NOW.getTime() - 60_000) })], "K1", NOW);
    expect(s.followUp).toMatchObject({ ownerId: "u2", overdue: true });
    expect(communicationState([attempt({ followUpRequired: true, followUpOwnerId: "u2", followUpDueAt: NOW, followUpDoneAt: NOW })], "K1", NOW).followUp).toBeNull();
  });
});

describe("arrangements", () => {
  const visit = (over: Partial<Parameters<typeof arrangementOf>[0]> = {}) => arrangementOf({
    id: "v1", reference: "V-1", status: "SCHEDULED", scheduledStart: new Date("2026-11-02T09:00:00Z"), scheduledEnd: new Date("2026-11-02T09:30:00Z"),
    assignments: [
      { slot: "SECOND", staffId: "s2", removedAt: null, staff: { displayName: "Bea" } },
      { slot: "PRIMARY", staffId: "s1", removedAt: null, staff: { displayName: "Ann" } },
      { slot: "SHADOW", staffId: "s9", removedAt: null, staff: { displayName: "Trainee" } },
      { slot: "PRIMARY", staffId: "s0", removedAt: new Date(), staff: { displayName: "Old" } },
    ],
    ...over,
  });
  it("lists who is coming, without shadows or removed carers", () => {
    expect(visit().carers.map((c) => c.name)).toEqual(["Ann", "Bea"]);
    expect(describeArrangement(visit())).toContain("Ann and Bea");
  });
  it("changes when the carer, the time or cancellation changes, but not when the visit starts", () => {
    const k = arrangementKey(visit());
    expect(arrangementKey(visit({ status: "IN_PROGRESS" }))).toBe(k);
    expect(arrangementKey(visit({ status: "CANCELLED" }))).not.toBe(k);
    expect(arrangementKey(visit({ scheduledStart: new Date("2026-11-02T09:15:00Z") }))).not.toBe(k);
    expect(arrangementKey(visit({ assignments: [{ slot: "PRIMARY", staffId: "s3", removedAt: null, staff: { displayName: "Cal" } }] }))).not.toBe(k);
  });
});

describe("contact details", () => {
  it("makes a tel: link only from a dialable number and never guesses digits", () => {
    expect(telHref("07700 900123")).toBe("tel:07700900123");
    expect(telHref("+44 (0)20 7946-0000")).toBe("tel:+4402079460000");
    expect(telHref("ring the daughter")).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
  it("shows recorded authority only, never from being next of kin", () => {
    expect(authorityOf({ kind: "NEXT_OF_KIN", authorityType: null, authorityScope: null })).toBeNull();
    expect(authorityOf({ kind: "LPA_HEALTH", authorityType: null, authorityScope: null })?.label).toContain("health and welfare");
    expect(authorityOf({ kind: "FAMILY", authorityType: "DEPUTY", authorityScope: "Finances only" })).toMatchObject({ label: "Court-appointed deputy", scope: "Finances only" });
  });
});

describe("Find Cover links", () => {
  it("reads the kind of cover and the place from the address, with each page's own default", () => {
    expect(coverTargetFrom({ cover: "v1" })).toEqual({ mode: "fill", id: "v1", slot: undefined });
    expect(coverTargetFrom({ cover: "c1" }, "recovery")).toMatchObject({ mode: "recovery" });
    expect(coverTargetFrom({ cover: "v1", fcMode: "replace", fcSlot: "SECOND" })).toEqual({ mode: "replace", id: "v1", slot: "SECOND" });
    // Older Unassigned Visits links used slot=.
    expect(coverTargetFrom({ cover: "v1", slot: "SECOND" })?.slot).toBe("SECOND");
    expect(coverTargetFrom({ cover: "v1", fcSlot: "SHADOW" })?.slot).toBeUndefined();
    expect(coverTargetFrom({})).toBeNull();
  });
});
