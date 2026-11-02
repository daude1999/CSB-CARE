import { describe, expect, it } from "vitest";
import { afterPush, arrive, canBack, canForward, idxOf, parsePos, STATE_KEY } from "@/lib/app-history";

describe("header Back and Forward", () => {
  it("offers nothing on a direct link, a bookmark or a page reached from another site", () => {
    const p = arrive("navigate", null, null, null, false);
    expect([canBack(p), canForward(p)]).toEqual([false, false]);
    // Even with an earlier session's position stored, an address typed in starts again.
    expect(arrive("navigate", null, { idx: 4, max: 6 }, 4, false)).toEqual({ idx: 0, max: 0 });
  });

  it("goes back after following links, and forward again after going back", () => {
    let p = arrive("navigate", null, null, null, false);
    p = afterPush(p);
    p = afterPush(p);
    expect(p).toEqual({ idx: 2, max: 2 });
    expect([canBack(p), canForward(p)]).toEqual([true, false]);
    p = arrive("traverse", 1, p, null, false)!;
    expect([canBack(p), canForward(p)]).toEqual([true, true]);
    p = arrive("traverse", 0, p, null, false)!;
    expect([canBack(p), canForward(p)]).toEqual([false, true]);
    // A new page after going back replaces what was forward.
    p = afterPush(p);
    expect(p).toEqual({ idx: 1, max: 1 });
    expect(canForward(p)).toBe(false);
  });

  it("keeps its place through a refresh", () => {
    expect(arrive("reload", 3, { idx: 3, max: 5 }, 3, true)).toEqual({ idx: 3, max: 5 });
  });

  it("carries on across a full page load into or out of the HR Hub", () => {
    // Left page 2 by an HR Hub link: the new page is 3, with nothing forward.
    const hr = arrive("navigate", null, { idx: 2, max: 2 }, 2, true)!;
    expect(hr).toEqual({ idx: 3, max: 3 });
    expect(canBack(hr)).toBe(true);
    // Back across the full page load: page 2, and Forward returns to the HR page.
    const back = arrive("back_forward", 2, hr, 3, false)!;
    expect(back).toEqual({ idx: 2, max: 3 });
    expect(canForward(back)).toBe(true);
  });

  it("never offers Forward to another site", () => {
    // On page 0 with page 1 forward, the person left for another site, then pressed the browser's Back.
    expect(arrive("back_forward", 0, { idx: 0, max: 1 }, 0, false)).toEqual({ idx: 0, max: 0 });
  });

  it("disables both directions on an entry it cannot place, rather than guessing", () => {
    const p = arrive("traverse", null, { idx: 2, max: 3 }, null, false);
    expect(p).toBeNull();
    expect([canBack(p), canForward(p)]).toEqual([false, false]);
  });

  it("reads only well-formed positions", () => {
    expect(idxOf({ __NA: true, [STATE_KEY]: 2 })).toBe(2);
    expect(idxOf({ __NA: true })).toBeNull();
    expect(idxOf(null)).toBeNull();
    expect(idxOf({ [STATE_KEY]: -1 })).toBeNull();
    expect(parsePos('{"idx":1,"max":3}')).toEqual({ idx: 1, max: 3 });
    expect(parsePos('{"idx":4,"max":3}')).toBeNull();
    expect(parsePos("not json")).toBeNull();
    expect(parsePos(null)).toBeNull();
  });
});
