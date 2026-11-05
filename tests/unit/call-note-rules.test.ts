import { describe, expect, it } from "vitest";
import { basicOrganise, clauses, displayStatus, findDuplicate, formatReference, quoteInText, suggestedDecision, verifyProposal, type Organised } from "@/lib/call-note-rules";
import { destinationSchema, parseValue, readingToFacts, basicRead } from "@/lib/care-coordinator-rules";

const EXAMPLE = "Spoke to the daughter today. She said her mother has not been sleeping well, she would prefer carers to arrive slightly earlier in the morning and she is waiting for the GP to call about her medication.";

describe("Call Notes: organising text without AI", () => {
  const o = basicOrganise({ text: EXAMPLE, method: "TELEPHONE", contactName: "Daughter", contactRole: "Service user's daughter" });

  it("turns the example into one bullet per piece of information, each copied from the text", () => {
    expect(o.items.map((i) => i.text)).toEqual([
      "Spoke to the daughter today.",
      "She said her mother has not been sleeping well.",
      "She would prefer carers to arrive slightly earlier in the morning.",
      "She is waiting for the GP to call about her medication.",
    ]);
    for (const i of o.items) expect(quoteInText(EXAMPLE, i.quote)).toBe(true);
  });

  it("classifies each statement and routes it: wellbeing stays, the visit request goes to the rota, medication to reconciliation", () => {
    expect(o.items.map((i) => [i.kind, i.destination])).toEqual([
      ["CONFIRMED_FACT", "CALL_NOTE"],
      ["THIRD_PARTY_REPORT", "CALL_NOTE"],
      ["PREFERENCE_REQUEST", "ROTA"],
      ["UNVERIFIED", "MEDICATION"],
    ]);
  });

  it("builds the summary only from what was entered, and proposes follow-ups without deciding anything", () => {
    expect(o.summary).toBe("Telephone conversation with Daughter (Service user's daughter).");
    expect(o.followUps.some((f) => /review it against the current rota/.test(f))).toBe(true);
    expect(o.followUps.some((f) => /no medication change is authorised/.test(f))).toBe(true);
    expect(o.urgent).toEqual([]);
  });

  it("never invents: an empty or one-word note gives nothing to organise", () => {
    expect(basicOrganise({ text: "ok", method: "OTHER", contactName: "X", contactRole: null }).items).toEqual([]);
  });

  it("flags a safeguarding allegation as urgent and routes it to the safeguarding workflow, as reported not proven", () => {
    const s = basicOrganise({ text: "The neighbour said her son took her money and she is frightened of him.", method: "TELEPHONE", contactName: "Neighbour", contactRole: null });
    expect(s.urgent.map((u) => u.kind)).toContain("SAFEGUARDING");
    expect(s.items.some((i) => i.destination === "SAFEGUARDING" && i.kind === "THIRD_PARTY_REPORT")).toBe(true);
    expect(s.followUps.join(" ")).toMatch(/reported, not proven/);
  });

  it("splits on sentence ends and joined clauses but keeps each clause's exact words", () => {
    expect(clauses("Called the GP; no answer. Left a message.")).toEqual(["Called the GP", "no answer.", "Left a message."]);
  });
});

describe("Call Notes: checking an AI proposal", () => {
  it("keeps an item whose quote is not in the text but marks it, and adds urgent flags the AI missed", () => {
    const p: Organised = {
      summary: "Call with the daughter.",
      items: [
        { text: "Daughter requested an earlier morning visit.", kind: "PREFERENCE_REQUEST", destination: "ROTA", quote: "would prefer carers to arrive slightly earlier", urgent: null },
        { text: "Daughter says the GP stopped the tablets.", kind: "PROFESSIONAL_ADVICE", destination: "MEDICATION", quote: "the GP stopped her tablets", urgent: null },
        { text: "Mother fell yesterday.", kind: "THIRD_PARTY_REPORT", destination: "INCIDENT", quote: "she fell yesterday", urgent: null },
      ],
      followUps: [], clarifications: [], urgent: [],
    };
    const v = verifyProposal(`${EXAMPLE} She fell yesterday in the kitchen.`, p);
    expect(v.items.map((i) => i.quoteFound)).toEqual([true, false, true]);
    expect(v.urgent).toEqual([{ kind: "SAFETY", text: "Mother fell yesterday." }]);
    expect(suggestedDecision("MEDICATION", "NEW", false)).toBe("LEAVE_OUT");
  });
});

describe("Call Notes: duplicate detection", () => {
  const records = [
    { ref: "RiskAssessment:r1", label: "Risk assessment: Falls", text: "Falls. Unsteady on her feet when getting up at night", destination: "RISK" as const },
    { ref: "CallNote:n1", label: "Call Note CALL-2026-000001", text: "Daughter requested an earlier morning visit", destination: "ANY" as const },
    { ref: "Contact:c1", label: "Contact: Jane Example", text: "Jane Example daughter 07700 900123", destination: "CONTACTS" as const },
  ];
  it("finds an exact duplicate and suggests linking it instead of copying", () => {
    const d = findDuplicate("Daughter requested an earlier morning visit.", "ROTA", records);
    expect(d).toMatchObject({ kind: "EXACT", ref: "CallNote:n1" });
    expect(suggestedDecision("ROTA", d.kind, true)).toBe("LINK");
  });
  it("tells an update, a conflict and new information apart", () => {
    expect(findDuplicate("She is now unsteady on her feet getting up at night", "RISK", records).kind).toBe("UPDATE");
    expect(findDuplicate("She is not unsteady on her feet when getting up at night", "RISK", records).kind).toBe("CONFLICT");
    expect(findDuplicate("The family is going on holiday next week", "CALL_NOTE", records).kind).toBe("NEW");
  });
  it("only compares a structured item with records of its own kind (and with notes)", () => {
    expect(findDuplicate("Unsteady on her feet when getting up at night", "MEDICATION", records).kind).toBe("NEW");
  });
});

describe("Call Notes: references and status", () => {
  it("formats an organisation-scoped reference", () => {
    expect(formatReference(2026, 1)).toBe("CALL-2026-000001");
    expect(formatReference(2027, 123456)).toBe("CALL-2027-123456");
  });
  it("shows Follow-up Required and Completed for approved notes, keeping the workflow status apart", () => {
    expect(displayStatus("APPROVED", [{ status: "OPEN" }]).label).toBe("Follow-up Required");
    expect(displayStatus("APPROVED", [{ status: "DONE" }]).label).toBe("Completed");
    expect(displayStatus("APPROVED", []).label).toBe("Approved");
    expect(displayStatus("AWAITING_REVIEW", [{ status: "OPEN" }]).label).toBe("Awaiting Review");
  });
});

describe("AI Care Coordinator: Call Notes section", () => {
  it("accepts a general communication fact and refuses an empty one", () => {
    expect(destinationSchema("callnote")?.section).toBe("CALL_NOTES");
    expect(parseValue("callnote", { summary: "Social worker confirmed the review meeting is on 12 November.", contactName: "Social worker", method: "TELEPHONE", date: null })).toMatchObject({ ok: true });
    expect(parseValue("callnote", { summary: "" }).ok).toBe(false);
  });
  it("the basic reader picks up labelled communication lines with their page and quote", () => {
    const r = basicRead(["Name: Ada Example\nTelephone call with social worker: Review meeting moved to 12/11/2026 at the family's request."]);
    const facts = readingToFacts(r).filter((f) => f.destination === "callnote");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ section: "CALL_NOTES", page: 1, value: { contactName: "Social worker", method: "TELEPHONE" } });
  });
  it("does not mistake a communication-needs line for a Call Note", () => {
    const r = basicRead(["Name: Ada Example\nCommunication needs: Speak slowly and check the hearing aid is in."]);
    expect(readingToFacts(r).filter((f) => f.destination === "callnote")).toHaveLength(0);
  });
  it("does not call two statements the same because they share one word", () => {
    expect(findDuplicate("Rang the daughter back.", "CALL_NOTE", [{ ref: "VisitNote:v1", label: "Visit note", text: "Back pain reported at lunch", destination: "ANY" }]).kind).toBe("NEW");
  });
});
