import { describe, expect, it } from "vitest";
import { parseFeed } from "@/server/sources/adapters/feed";
import { clmlToText } from "@/server/sources/adapters/legislation";
import { contentItemToSections, legalStatusFor } from "@/server/sources/adapters/govuk";
import { htmlToSections, sniffContentType } from "@/server/sources/extract";
import { HttpClient, HttpError, isAllowedByRobots } from "@/server/sources/http";
import { fixtureFetch, fixtureHttp } from "@/server/testing/fixtures";

describe("HTML extraction", () => {
  it("splits on headings, drops scripts and navigation, and deduplicates refs", () => {
    const s = htmlToSections("<nav>menu</nav><p>Intro text</p><h2>Duties</h2><p>Must do X.</p><script>evil()</script><h2>Duties</h2><ul><li>Item</li></ul>");
    expect(s.map((x) => x.ref)).toEqual(["intro", "duties", "duties-2"]);
    expect(s.map((x) => x.text).join(" ")).not.toContain("evil");
    expect(s.map((x) => x.text).join(" ")).not.toContain("menu");
  });
  it("sniffs content types from bytes", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.7"))).toBe("pdf");
    expect(sniffContentType(Buffer.from("<!DOCTYPE html><html>"))).toBe("html");
    expect(sniffContentType(Buffer.from('{"a":1}'))).toBe("json");
  });
});

describe("GOV.UK content items", () => {
  it("extracts summary, body sections and guide parts", () => {
    const s = contentItemToSections({
      content_id: "x",
      base_path: "/x",
      title: "T",
      description: "Desc",
      document_type: "guide",
      details: { body: "<h2>A</h2><p>Alpha</p>", parts: [{ title: "Part one", slug: "part-one", body: "<h2>B</h2><p>Beta</p>" }] },
    });
    expect(s.map((x) => x.ref)).toEqual(["summary", "a", "part-one/b"]);
  });
  it("labels statutory guidance", () => {
    expect(legalStatusFor({ document_type: "statutory_guidance" })).toBe("STATUTORY_GUIDANCE");
    expect(legalStatusFor({ document_type: "detailed_guide" })).toBe("ADVISORY_GUIDANCE");
  });
});

describe("feeds", () => {
  it("parses Atom", () => {
    const e = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:1</id><title>New guidance</title><link rel="alternate" href="https://example.gov.uk/a"/><updated>2026-10-01T10:00:00Z</updated><summary>&lt;p&gt;Hello&lt;/p&gt;</summary></entry></feed>`);
    expect(e[0]).toMatchObject({ id: "tag:1", title: "New guidance", link: "https://example.gov.uk/a", summary: "Hello" });
  });
  it("parses RSS 2.0", () => {
    const e = parseFeed(`<rss version="2.0"><channel><item><guid>g1</guid><title>News</title><link>https://x/a</link><pubDate>Tue, 01 Oct 2026 10:00:00 GMT</pubDate><description>Body</description></item></channel></rss>`);
    expect(e[0]?.id).toBe("g1");
    expect(e[0]?.updated?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });
  it("rejects unknown formats", () => {
    expect(() => parseFeed("<html></html>")).toThrow(/Unrecognised/);
  });
});

describe("legislation CLML", () => {
  it("extracts text and modification metadata, skipping metadata blocks", () => {
    const r = clmlToText(`<Legislation><ukm:Metadata><dc:title>Reg 13</dc:title><dc:modified>2026-03-01</dc:modified><ukm:UnappliedEffects><ukm:UnappliedEffect/></ukm:UnappliedEffects></ukm:Metadata><Secondary><Body><P1group><Title>Safeguarding</Title><P1><Pnumber>13</Pnumber><P1para><Text>Service users must be protected.</Text></P1para></P1></P1group></Body></Secondary></Legislation>`);
    expect(r.text).toContain("Service users must be protected.");
    expect(r.text).not.toContain("Reg 13");
    expect(r.modified?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(r.unappliedEffects).toBe(1);
  });
});

describe("HTTP client", () => {
  it("retries transient failures with backoff then succeeds", async () => {
    let n = 0;
    const f = fixtureFetch({ "/x": () => (++n < 3 ? { status: 503, body: "busy" } : { body: { ok: true } }) });
    const http = fixtureHttp(f);
    expect(await http.getJson("https://a.test/x")).toEqual({ ok: true });
    expect(f.calls).toHaveLength(3);
  });
  it("does not retry permanent errors", async () => {
    const f = fixtureFetch({});
    await expect(fixtureHttp(f).get("https://a.test/missing")).rejects.toMatchObject({ status: 404, transient: false });
    expect(f.calls).toHaveLength(1);
  });
  it("gives up after the retry budget with a transient error", async () => {
    const f = fixtureFetch({ "/x": { status: 500, body: "err" } });
    const err = await fixtureHttp(f).get("https://a.test/x").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.transient).toBe(true);
    expect(f.calls).toHaveLength(3);
  });
  it("times out slow responses", async () => {
    const slow = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const http = new HttpClient({ fetchImpl: slow, timeoutMs: 20, retries: 0, minIntervalMs: 0 });
    await expect(http.get("https://a.test/slow")).rejects.toThrow(/Timed out/);
  });
  it("enforces response size limits", async () => {
    const http = new HttpClient({ fetchImpl: fixtureFetch({ "/big": { body: "x".repeat(2000) } }), maxBytes: 100, minIntervalMs: 0 });
    await expect(http.get("https://a.test/big")).rejects.toThrow(/too large/);
  });
  it("respects robots.txt disallow rules", async () => {
    const http = fixtureHttp(fixtureFetch({ "/robots.txt": { body: "User-agent: *\nDisallow: /private" } }));
    expect(await isAllowedByRobots(http, "https://a.test/private/page")).toBe(false);
    expect(await isAllowedByRobots(http, "https://a.test/public")).toBe(true);
  });
});
