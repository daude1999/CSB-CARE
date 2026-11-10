import { vi } from "vitest";

/**
 * Optional fixed clock for the vitest suite. With TEST_NOW set (an ISO time such as 2026-11-10T23:30:00Z), every
 * test file starts at that moment and the clock keeps ticking from there, so date and time-of-day rules can be
 * checked at the awkward times (late evening, just after midnight, a Sunday night) on demand instead of only when
 * the suite happens to run then. Only `Date` is faked: timers, the database and the network run normally.
 *
 *   TEST_NOW=2026-11-10T23:30:00Z npx vitest run tests/integration/cutoff.test.ts
 *
 * Only the JavaScript clock moves; PostgreSQL keeps the real time. Tests that compare the two (rate-limit windows,
 * job run times, database-stamped approvals) therefore fail under a far-away TEST_NOW without being wrong. Use it on
 * one file at a time. CI does not use it: it runs the whole suite at the real late-evening and after-midnight times.
 */
const now = process.env.TEST_NOW;
if (now) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) throw new Error(`TEST_NOW is not a valid date: ${now}`);
  vi.useFakeTimers({ toFake: ["Date"], now: at, shouldAdvanceTime: true });
}
