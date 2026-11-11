import { describe, expect, it } from "vitest";
import { scrubEvent, scrubMessage, trackingDsn, type TrackedEvent } from "@/lib/error-tracking";

describe("where errors may be sent", () => {
  it("is off without an address", () => {
    expect(trackingDsn({})).toEqual({ dsn: null, reason: "SENTRY_DSN is not set" });
    expect(trackingDsn({ SENTRY_DSN: "  " }).dsn).toBeNull();
  });

  it("accepts only Sentry's EU region", () => {
    const eu = "https://abc123@o123456.ingest.de.sentry.io/4500000000000000";
    expect(trackingDsn({ SENTRY_DSN: eu })).toEqual({ dsn: eu });
    for (const elsewhere of ["https://abc123@o123456.ingest.us.sentry.io/45", "https://abc123@o123456.ingest.sentry.io/45", "https://abc123@de.sentry.io.example.com/45", "https://abc123@errors.example.test/1"]) {
      expect(trackingDsn({ SENTRY_DSN: elsewhere }), elsewhere).toEqual({ dsn: null, reason: "SENTRY_DSN is not in Sentry's EU region (the address must end in .de.sentry.io)" });
    }
    expect(trackingDsn({ SENTRY_DSN: "not a url" })).toEqual({ dsn: null, reason: "SENTRY_DSN is not a valid address" });
  });
});

describe("error messages", () => {
  it("masks emails, links, quoted values, postcodes, NHS numbers, phone numbers and long numbers", () => {
    expect(scrubMessage("No account for zelda@example.test")).toBe("No account for [email]");
    expect(scrubMessage("Reset link https://csb.example.test/account/tokSECRET123 expired")).toBe("Reset link [link] expired");
    expect(scrubMessage('Service user "Zelda Quillfeather" has no package')).toBe("Service user [value] has no package");
    expect(scrubMessage("Cannot geocode ZZ99 9ZZ")).toBe("Cannot geocode [postcode]");
    expect(scrubMessage("NHS number 999 000 1234 is already used")).toBe("NHS number [number] is already used");
    expect(scrubMessage("Could not text 07000 000001")).toBe("Could not text [phone]");
    expect(scrubMessage("Reference 12345678 not found")).toBe("Reference [number] not found");
    expect(scrubMessage("Key safe code 4321 was refused (HTTP 502)")).toBe("Key safe code [number] was refused (HTTP 502)");
  });

  it("keeps only the first line, at most 200 characters", () => {
    expect(scrubMessage("Something failed\n  at line with Zelda's notes: seemed low today")).toBe("Something failed");
    expect(scrubMessage("x".repeat(500))).toHaveLength(200);
  });

  it("reduces database errors to their code, because their messages can quote the record", () => {
    const prisma = "\nInvalid `prisma.serviceUser.create()` invocation:\n\n{ data: { firstName: \"Zelda\", nhsNumber: \"9990001234\" } }\n\nUnique constraint failed on the fields: (`nhsNumber`) P2002";
    expect(scrubMessage(prisma, "PrismaClientKnownRequestError")).toBe("Database error P2002");
    expect(scrubMessage("Argument `firstName`: Invalid value \"Zelda\"", "PrismaClientValidationError")).toBe("Database error");
  });

  it("leaves a plain technical message readable", () => {
    expect(scrubMessage("Cannot read properties of undefined (reading 'map')", "TypeError")).toBe("Cannot read properties of undefined (reading [value])");
    expect(scrubMessage("fetch failed", "TypeError")).toBe("fetch failed");
  });
});

describe("what is sent with an error", () => {
  const SECRETS = ["Zelda", "Quillfeather", "zelda@example.test", "evx_session=COOKIE", "Bearer AUTH", "nhs=9990001234", "ZZ99 9ZZ", "manager@care-solution.demo", "seemed low today", "10.1.2.3", "cmwaqku3p09ip7doimqidb77v", "4321-KEYSAFE"];

  it("removes the request body, cookies, headers, query, user, breadcrumbs, variables and extra data", () => {
    const event: TrackedEvent = {
      message: 'Could not save "Zelda Quillfeather"',
      exception: { values: [{ type: "Error", value: "Key safe 4321-KEYSAFE rejected for zelda@example.test\nnotes: seemed low today", stacktrace: { frames: [{ filename: "src/server/care/keysafe.ts", lineno: 42, function: "saveKeySafe", vars: { code: "4321-KEYSAFE", name: "Zelda" } }] } }] },
      request: { method: "POST", url: "https://csb.example.test/rota/service-users/cmwaqku3p09ip7doimqidb77v?nhs=9990001234", query_string: "nhs=9990001234", cookies: { evx_session: "evx_session=COOKIE" }, headers: { authorization: "Bearer AUTH", cookie: "evx_session=COOKIE", "x-forwarded-for": "10.1.2.3" }, data: { firstName: "Zelda", postcode: "ZZ99 9ZZ" } },
      user: { id: "u1", email: "manager@care-solution.demo", ip_address: "10.1.2.3" },
      breadcrumbs: [{ message: "Opened Zelda Quillfeather" }],
      extra: { formData: { notes: "seemed low today" } },
      contexts: { runtime: { name: "node", version: "v22.0.0" }, trace: { data: { url: "/x?nhs=9990001234" } }, state: { serviceUser: "Zelda" } },
      tags: { requestId: "0b0b0b0b-1111-2222-3333-444444444444", route: "/rota/service-users/[id]", serviceUserName: "Zelda", url: "/rota/service-users/cmwaqku3p09ip7doimqidb77v" },
      transaction: "POST /rota/service-users/cmwaqku3p09ip7doimqidb77v",
      server_name: "ip-10.1.2.3",
    };
    const sent = scrubEvent(event);
    const json = JSON.stringify(sent);
    for (const secret of SECRETS) expect(json.includes(secret), `"${secret}" would be sent`).toBe(false);

    // What is kept is what is needed to find and fix the fault.
    expect(sent.request).toEqual({ method: "POST" });
    expect(sent.tags).toEqual({ requestId: "0b0b0b0b-1111-2222-3333-444444444444", route: "/rota/service-users/[id]" });
    expect(sent.contexts).toEqual({ runtime: { name: "node", version: "v22.0.0" } });
    expect(sent.exception?.values?.[0]).toMatchObject({ type: "Error", value: "Key safe [number]-KEYSAFE rejected for [email]" });
    expect(sent.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({ filename: "src/server/care/keysafe.ts", lineno: 42, function: "saveKeySafe" });
    expect(sent.transaction).toBeUndefined();
    expect(sent.message).toBe("Could not save [value]");
  });

  it("keeps a route pattern as the transaction", () => {
    expect(scrubEvent({ transaction: "GET /rota/service-users/[id]" }).transaction).toBe("GET /rota/service-users/[id]");
    expect(scrubEvent({ transaction: "GET /search?q=zelda" }).transaction).toBeUndefined();
  });
});

describe("the real SDK with the application's options", () => {
  it("sends an error with nothing personal in it, and sends no traces", async () => {
    const Sentry = await import("@sentry/nextjs");
    const { trackingOptions } = await import("@/lib/error-report");
    const sent: string[] = [];
    // A transport that keeps what would go over the network instead of sending it.
    const transport = () => ({
      send: async (envelope: unknown) => { sent.push(JSON.stringify(envelope)); return {}; },
      flush: async () => true,
    });
    Sentry.init({ ...trackingOptions("https://abc123@o123456.ingest.de.sentry.io/4500000000000000", { NODE_ENV: "test", GIT_COMMIT: "abc1234" }), transport, defaultIntegrations: false });

    Sentry.withScope((scope) => {
      scope.setTags({ requestId: "0b0b0b0b-1111-2222-3333-444444444444", route: "/rota/service-users/[id]", serviceUserName: "Zelda" });
      scope.setUser({ id: "u1", email: "manager@care-solution.demo" });
      scope.setExtra("formData", { notes: "seemed low today" });
      Sentry.addBreadcrumb({ message: "Opened Zelda Quillfeather" });
      Sentry.captureException(new Error('Could not save "Zelda Quillfeather" (zelda@example.test, ZZ99 9ZZ, key safe 4321)\nnotes: seemed low today'));
    });
    await Sentry.flush(2000);

    const events = sent.filter((s) => s.includes('"type":"event"'));
    expect(events).toHaveLength(1);
    const wire = events[0]!;
    // (The key-safe digits are checked through the exact message below: four digits can occur by chance in a timestamp.)
    for (const secret of ["Zelda", "Quillfeather", "zelda@example.test", "ZZ99 9ZZ", "manager@care-solution.demo", "seemed low today"]) expect(wire.includes(secret), `"${secret}" would be sent to Sentry`).toBe(false);
    expect(wire).toContain("Could not save [value] ([email], [postcode], key safe [number])");
    expect(wire).toContain('"requestId":"0b0b0b0b-1111-2222-3333-444444444444"');
    expect(wire).toContain('"route":"/rota/service-users/[id]"');
    expect(wire).toContain('"release":"abc1234"');
    expect(sent.some((s) => s.includes('"type":"transaction"'))).toBe(false);
    await Sentry.close(1000);
  });
});
