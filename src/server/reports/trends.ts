import { db } from "@/lib/db";
import type { Ctx } from "../auth/rbac";

export type MonthBar = { key: string; label: string; value: number; highlight?: "current" | "overdue" };

// Month only, with the year on January and on the first column so the axis stays readable.
const label = (d: Date, first: boolean) => d.toLocaleDateString("en-GB", { month: "short", ...(first || d.getUTCMonth() === 0 ? { year: "2-digit" } : {}), timeZone: "UTC" });
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function months(from: Date, count: number) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)));
}

/** Monthly figures for the reports page charts, scoped like the dashboard. */
export async function reportTrends(ctx: Ctx) {
  const scope = { organisationId: ctx.organisationId ?? null };
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const pastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const futureEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1));
  const [published, reviews] = await Promise.all([
    db.policyPublication.findMany({ where: { ...scope, publishedAt: { gte: pastStart } }, select: { publishedAt: true } }),
    db.policy.findMany({ where: { ...scope, status: "ACTIVE", nextReviewDate: { lt: futureEnd } }, select: { nextReviewDate: true } }),
  ]);

  const pubCounts = new Map<string, number>();
  for (const p of published) if (p.publishedAt) pubCounts.set(monthKey(p.publishedAt), (pubCounts.get(monthKey(p.publishedAt)) ?? 0) + 1);
  const publications: MonthBar[] = months(pastStart, 12).map((m, i) => ({ key: monthKey(m), label: label(m, i === 0), value: pubCounts.get(monthKey(m)) ?? 0, highlight: m.getTime() === thisMonth.getTime() ? "current" : undefined }));

  let overdue = 0;
  const dueCounts = new Map<string, number>();
  for (const p of reviews) {
    if (!p.nextReviewDate) continue;
    if (p.nextReviewDate < now) overdue++;
    else dueCounts.set(monthKey(p.nextReviewDate), (dueCounts.get(monthKey(p.nextReviewDate)) ?? 0) + 1);
  }
  const reviewCalendar: MonthBar[] = [
    { key: "overdue", label: "Overdue", value: overdue, highlight: "overdue" },
    ...months(thisMonth, 12).map((m) => ({ key: monthKey(m), label: label(m, false), value: dueCounts.get(monthKey(m)) ?? 0 })),
  ];
  return { publications, reviewCalendar };
}
