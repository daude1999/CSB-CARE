import type { Prisma, RateBand, RateCard } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, fromDbDate, isoWeekday, londonMinute } from "@/lib/london";
import { priceWork, splitWork } from "./pricing";
import { financeSettings } from "./rates";

/**
 * Rota cost and revenue ESTIMATES. They price the planned rota with the organisation's own rate cards: charge from the
 * service user's funded package, pay from each carer's pay card (or the default), plus the organisation's stated
 * on-cost percentage. They are projections for planning, never payroll or invoices: verified figures come only from
 * approved pay and invoice runs, which are reported separately.
 */

type Card = RateCard & { bands: RateBand[] };
type Db = Prisma.TransactionClient | typeof db;

export interface EstimateVisit {
  id: string;
  date: Date;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
  carersRequired: number;
  chargeable: boolean;
  payable: boolean;
  serviceUserId: string;
  assignments: { staffId: string; slot: string }[];
}

export interface VisitEstimate {
  visitId: string;
  minutes: number;
  revenuePence: number | null;
  costPence: number | null;
  /** Open carer slots priced at the default pay rate. */
  openSlotsPriced: number;
  funderId: string | null;
  issues: { kind: "NO_FUNDER" | "NO_CHARGE_RATE" | "NO_PAY_RATE" | "NO_BAND"; message: string }[];
}

export interface EstimateFacts {
  chargeCards: Card[];
  payCards: Card[];
  payRates: { staffId: string; rateCardId: string; effectiveFrom: Date; effectiveTo: Date | null }[];
  defaultPayCardId: string | null;
  onCostPercent: number;
  holidays: Set<string>;
  packages: Map<string, { funderId: string | null; startDate: Date; endDate: Date | null; status: string; funder: { id: string; name: string; chargeRateCardId: string | null } | null }[]>;
}

export async function loadEstimateFacts(tx: Db, organisationId: string, from: string, to: string, serviceUserIds: string[]): Promise<EstimateFacts> {
  const [settings, cards, payRates, holidays, packages] = await Promise.all([
    financeSettings(tx, organisationId),
    tx.rateCard.findMany({ where: { organisationId }, include: { bands: true } }),
    tx.staffPayRate.findMany({ where: { organisationId }, select: { staffId: true, rateCardId: true, effectiveFrom: true, effectiveTo: true } }),
    tx.bankHoliday.findMany({ where: { organisationId, date: { gte: dbDate(from), lte: dbDate(addDays(to, 1)) } } }),
    tx.carePackage.findMany({ where: { organisationId, serviceUserId: { in: serviceUserIds } }, select: { serviceUserId: true, funderId: true, startDate: true, endDate: true, status: true, funder: { select: { id: true, name: true, chargeRateCardId: true } } } }),
  ]);
  const byUser = new Map<string, EstimateFacts["packages"] extends Map<string, infer V> ? V : never>();
  for (const p of packages) byUser.set(p.serviceUserId, [...(byUser.get(p.serviceUserId) ?? []), p]);
  return {
    chargeCards: cards.filter((c) => c.kind === "CHARGE"),
    payCards: cards.filter((c) => c.kind === "PAY"),
    payRates,
    defaultPayCardId: settings.defaultPayRateCardId,
    onCostPercent: settings.estimateOnCostPercent,
    holidays: new Set(holidays.map((h) => fromDbDate(h.date))),
    packages: byUser,
  };
}

function cardOn(cards: Card[], id: string | null | undefined, date: Date) {
  const c = cards.find((x) => x.id === id);
  return c && c.effectiveFrom <= date && (!c.effectiveTo || c.effectiveTo >= date) ? c : null;
}

/** Pure: the estimate for one visit from loaded facts. Cancelled and not-delivered visits cost and earn nothing here. */
export function estimateVisit(v: EstimateVisit, f: EstimateFacts): VisitEstimate {
  const minutes = Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60000);
  const out: VisitEstimate = { visitId: v.id, minutes, revenuePence: null, costPence: null, openSlotsPriced: 0, funderId: null, issues: [] };
  if (["CANCELLED", "NOT_DELIVERED"].includes(v.status)) return { ...out, revenuePence: 0, costPence: 0 };
  const day = fromDbDate(v.date);
  const parts = (card: Card) => splitWork(card.bands, day, londonMinute(v.scheduledStart), minutes, (d) => f.holidays.has(d), (d) => addDays(d, 1), isoWeekday);

  // Revenue: a missed visit is not charged.
  if (!v.chargeable || v.status === "MISSED") out.revenuePence = 0;
  else {
    const pkg = (f.packages.get(v.serviceUserId) ?? []).find((p) => p.startDate <= v.date && (p.endDate ? p.endDate >= v.date : p.status === "ACTIVE"));
    out.funderId = pkg?.funder?.id ?? null;
    if (!pkg?.funder) out.issues.push({ kind: "NO_FUNDER", message: "No funded care package on this date" });
    else {
      const card = cardOn(f.chargeCards, pkg.funder.chargeRateCardId, v.date);
      if (!card) out.issues.push({ kind: "NO_CHARGE_RATE", message: `${pkg.funder.name} has no charge rate card on this date` });
      else {
        const p = priceWork(parts(card));
        if (!p) out.issues.push({ kind: "NO_BAND", message: `"${card.name}" has no band for all of this visit` });
        else out.revenuePence = p.amountPence * v.carersRequired;
      }
    }
  }

  // Cost: each booked carer at their own card; open slots at the default card. A missed visit is still costed, since
  // the carer may be paid for the booking; the estimate errs on the side of cost.
  if (!v.payable) out.costPence = 0;
  else {
    const booked = v.assignments.filter((a) => a.slot !== "SHADOW");
    const open = Math.max(0, v.carersRequired - booked.length);
    let total = 0;
    let ok = true;
    const priceFor = (cardId: string | null | undefined, who: string) => {
      const card = cardOn(f.payCards, cardId, v.date);
      if (!card) {
        out.issues.push({ kind: "NO_PAY_RATE", message: `${who}: no pay rate card on this date` });
        return null;
      }
      const p = priceWork(parts(card));
      if (!p) out.issues.push({ kind: "NO_BAND", message: `"${card.name}" has no band for all of this visit` });
      return p?.amountPence ?? null;
    };
    for (const a of booked) {
      const rate = f.payRates.find((r) => r.staffId === a.staffId && r.effectiveFrom <= v.date && (!r.effectiveTo || r.effectiveTo >= v.date));
      const p = priceFor(rate?.rateCardId ?? f.defaultPayCardId, "A booked carer");
      if (p === null) ok = false;
      else total += p;
    }
    for (let i = 0; i < open; i++) {
      const p = priceFor(f.defaultPayCardId, "Open slot (default pay rate)");
      if (p === null) ok = false;
      else {
        total += p;
        out.openSlotsPriced++;
      }
    }
    out.costPence = ok ? Math.round(total * (1 + f.onCostPercent / 100)) : null;
  }
  return out;
}

export interface EstimateTotals {
  visits: number;
  minutes: number;
  revenuePence: number;
  costPence: number;
  /** Visits with both figures, used for the margin (so a missing rate never inflates it). */
  pricedVisits: number;
  pricedRevenuePence: number;
  pricedCostPence: number;
  marginPence: number;
  marginPercent: number | null;
  missingRevenue: number;
  missingCost: number;
  openSlotsPriced: number;
}

export function totals(list: VisitEstimate[]): EstimateTotals {
  const priced = list.filter((e) => e.revenuePence !== null && e.costPence !== null);
  const pricedRevenuePence = priced.reduce((n, e) => n + e.revenuePence!, 0);
  const pricedCostPence = priced.reduce((n, e) => n + e.costPence!, 0);
  const marginPence = pricedRevenuePence - pricedCostPence;
  return {
    visits: list.length,
    minutes: list.reduce((n, e) => n + e.minutes, 0),
    revenuePence: list.reduce((n, e) => n + (e.revenuePence ?? 0), 0),
    costPence: list.reduce((n, e) => n + (e.costPence ?? 0), 0),
    pricedVisits: priced.length,
    pricedRevenuePence,
    pricedCostPence,
    marginPence,
    marginPercent: pricedRevenuePence > 0 ? Math.round((marginPence / pricedRevenuePence) * 1000) / 10 : null,
    missingRevenue: list.filter((e) => e.revenuePence === null).length,
    missingCost: list.filter((e) => e.costPence === null).length,
    openSlotsPriced: list.reduce((n, e) => n + e.openSlotsPriced, 0),
  };
}
