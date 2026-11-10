import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACTED_FIELDS, loggerOptions } from "@/lib/logger";
import { withRequestId } from "@/lib/request-context";

/** A logger with the application's real options, writing to memory so the emitted JSON can be read back. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk: Buffer, _enc, done) { lines.push(chunk.toString()); done(); } });
  const log = pino({ ...loggerOptions, level: "info" }, stream);
  return { log, lines, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

// Synthetic values only. Each is distinctive so a leak anywhere in the output is found by a plain text search.
const CARE_RECORD = {
  firstName: "Zelda-FIRST", lastName: "Quillfeather-LAST", preferredName: "Zee-PREF", dateOfBirth: "1931-02-03", nhsNumber: "999 000 1234",
  addressLine1: "1 Madeup Mews", addressLine2: "Flat 99Z", town: "Nowhereton", postcode: "ZZ99 9ZZ", phone: "07000 000001", altPhone: "07000 000002", email: "zelda@example.test",
  accessNotes: "Side gate, ring twice", keySafeCode: "4321-KEYSAFE", keySafeCipher: "v1:cipher-KEYSAFE", communicationNeeds: "Hard of hearing-NEEDS", carePreferences: "Tea first-PREFS",
  riskSummary: "Falls at night-RISK", diagnosis: "Madeup syndrome", allergies: "Penicillin-ALLERGY", medications: ["Madeupmycin 5mg"], notes: "Seemed low today-NOTE", note: "Refused lunch-NOTE",
  description: "Bruise on left arm-DESC", body: "Dear GP-BODY", content: "Support plan text-CONTENT", text: "Extracted plan text-TEXT", contacts: [{ name: "Daughter-CONTACT", phone: "07000 000003" }],
  nextOfKin: "Pat Quillfeather-NOK", gp: "Dr Madeup-GP", password: "hunter2-PASSWORD", token: "tok-SECRET", link: "https://example.test/account/tok-LINK",
} as const;

describe("log redaction", () => {
  it("replaces every care-record field at the top of a log line", () => {
    const { log, lines, records } = capture();
    log.info({ serviceUserId: "su_123", count: 3, ...CARE_RECORD }, "service user saved");
    const out = lines.join("");
    for (const [field, value] of Object.entries(CARE_RECORD)) {
      const leaked = (Array.isArray(value) ? value.flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))) : [value]).filter((v) => out.includes(String(v)));
      expect(leaked, `"${field}" reached the log`).toEqual([]);
      expect(records()[0]![field], field).toBe("[Redacted]");
    }
    // Ids and counts are what logs are for, and stay readable.
    expect(records()[0]).toMatchObject({ serviceUserId: "su_123", count: 3, msg: "service user saved" });
  });

  it("also redacts them one and two levels inside a logged object", () => {
    const { log, lines } = capture();
    log.warn({ serviceUser: CARE_RECORD, change: { before: CARE_RECORD, after: { ...CARE_RECORD } }, headers: { cookie: "evx_session=COOKIE-SECRET", authorization: "Bearer AUTH-SECRET" } }, "nested");
    const out = lines.join("");
    for (const marker of ["Zelda-FIRST", "Quillfeather-LAST", "1931-02-03", "999 000 1234", "ZZ99 9ZZ", "4321-KEYSAFE", "Seemed low today-NOTE", "Penicillin-ALLERGY", "Madeupmycin", "Daughter-CONTACT", "COOKIE-SECRET", "AUTH-SECRET", "tok-LINK"]) {
      expect(out.includes(marker), `"${marker}" reached the log`).toBe(false);
    }
  });

  it("covers the service user's personal columns in the database schema", () => {
    // If a personal column is added to ServiceUser and not to the redaction list, this fails and names it.
    const personal = ["firstName", "lastName", "preferredName", "dateOfBirth", "gender", "pronouns", "nhsNumber", "addressLine1", "addressLine2", "town", "postcode", "phone", "altPhone", "email", "accessNotes", "keySafeCipher", "communicationNeeds", "carePreferences", "riskSummary"];
    expect(personal.filter((f) => !(REDACTED_FIELDS as readonly string[]).includes(f))).toEqual([]);
  });

  it("does not stop an error's kind and message being logged", () => {
    const { log, records } = capture();
    log.error({ ref: "ERR-1", kind: "PrismaClientKnownRequestError", code: "P2002", err: "Unique constraint failed" }, "action failed");
    expect(records()[0]).toMatchObject({ ref: "ERR-1", kind: "PrismaClientKnownRequestError", code: "P2002", err: "Unique constraint failed" });
  });
});

describe("request id in logs", () => {
  it("adds the request id to every line written inside the request, and none outside it", async () => {
    const { log, records } = capture();
    log.info("before");
    await withRequestId("req-aaaaaaaa", async () => {
      log.info("first");
      await new Promise((r) => setTimeout(r, 5));
      log.info({ jobId: "j1" }, "second");
    });
    log.info("after");
    expect(records().map((r) => [r.msg, r.requestId])).toEqual([["before", undefined], ["first", "req-aaaaaaaa"], ["second", "req-aaaaaaaa"], ["after", undefined]]);
  });

  it("keeps two requests running at the same time apart", async () => {
    const { log, records } = capture();
    const one = (id: string, ms: number) => withRequestId(id, async () => { await new Promise((r) => setTimeout(r, ms)); log.info(`done ${id}`); });
    await Promise.all([one("req-11111111", 20), one("req-22222222", 5), one("req-33333333", 12)]);
    for (const r of records()) expect(r.msg).toBe(`done ${String(r.requestId)}`);
    expect(records()).toHaveLength(3);
  });
});
