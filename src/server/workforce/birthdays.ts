import "server-only";
import { read as readHr } from "@/hr/lib/workspace-tx";
import { permits } from "@/hr/lib/domain";
import { db } from "@/lib/db";
import { canUsePortal } from "@/server/auth/portals";
import type { Ctx } from "@/server/auth/rbac";
import { addDays, daysBetween } from "@/lib/london";

/**
 * Upcoming birthdays, worked out from a stored date of birth. Shared by the service-user list (dates of birth in
 * Rostering) and the team list (dates of birth in HR & Workforce).
 */
export interface Birthday {
  id: string;
  name: string;
  dateOfBirth: string;
  /** The age they turn on their next birthday. */
  turns: number;
  next: string;
  inDays: number;
  href: string | null;
}

/** The next birthday on or after `today` for a YYYY-MM-DD date of birth (29 February falls on 28 February otherwise). */
export function nextBirthday(dob: string, today: string) {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const year = Number(today.slice(0, 4));
  const on = (yr: number) => {
    const leap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    const day = m === 2 && d === 29 && !leap ? 28 : d;
    return `${yr}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const next = on(year) >= today ? on(year) : on(year + 1);
  return { next, turns: Number(next.slice(0, 4)) - y, inDays: daysBetween(today, next) };
}

export function upcoming<T extends { id: string; name: string; dateOfBirth: string; href: string | null }>(people: T[], today: string, days: number): Birthday[] {
  const end = addDays(today, days);
  return people
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth))
    .map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth, href: p.href, ...nextBirthday(p.dateOfBirth, today) }))
    .filter((b) => b.next <= end)
    .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}

/**
 * Team-member birthdays. Dates of birth stay in HR & Workforce (they are never projected into Rostering), so they are
 * read from the HR record, and only for someone who can use HR & Workforce, for the employees their HR access covers,
 * and only for staff the caller can already see (`staffIds`). Anyone else gets null, so the panel says why it is empty.
 */
export async function staffBirthdays(ctx: Ctx, staffIds: string[], today: string, days: number): Promise<Birthday[] | null> {
  if (!ctx.organisationId || !canUsePortal(ctx, "hr")) return null;
  let state;
  try {
    state = await readHr(ctx.organisationId);
  } catch {
    return null;
  }
  const user = state.users.find((u) => u.id === ctx.hrUserId);
  if (!user?.active) return null;
  const staff = await db.staffMember.findMany({ where: { organisationId: ctx.organisationId, id: { in: staffIds } }, select: { id: true, hrEmployeeId: true, displayName: true } });
  const byHr = new Map(staff.map((s) => [s.hrEmployeeId, s]));
  const people = state.employees
    .filter((e) => e.status !== "Archived" && byHr.has(e.id) && permits(user, e) && e.dateOfBirth)
    .map((e) => {
      const s = byHr.get(e.id)!;
      return { id: s.id, name: s.displayName, dateOfBirth: e.dateOfBirth!, href: `/rota/staff/${s.id}` };
    });
  return upcoming(people, today, days);
}
