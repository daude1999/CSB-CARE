import type { InterviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { addDays, londonDate, londonToUtc } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { recruitmentAccess } from "@/server/recruitment/access";
import { isOpen } from "@/server/recruitment/model";

/**
 * The parts of the HR overview (`/hr/dashboard`) that live in the platform database rather than the HR Hub's own
 * workspace: interviews from Recruitment and leave requests from Time Off. Access follows the member's HR account
 * exactly as Recruitment and Time Off do (role and branches), and the organisation always comes from the session.
 *
 * Counting rules (shown on screen and documented in docs/implementation/HR_OVERVIEW_REDESIGN.md):
 * - Interviews today: interviews of open applications whose start falls on today's London date and that are booked
 *   (awaiting confirmation or confirmed) or already held today. Cancelled, declined and missed ones are not counted.
 * - Coming up: booked interviews from now until the end of the 14th day ahead.
 * - Leave requests to approve: requests still waiting for a decision whose end is no earlier than 30 days ago, the
 *   same list the Holidays & Sickness page opens on.
 */

export const INTERVIEW_DAYS_AHEAD = 14;
const BOOKED: InterviewStatus[] = ["AWAITING_CONFIRMATION", "CONFIRMED"];

export interface HrOverviewInterview {
  id: string;
  candidateId: string;
  name: string;
  role: string;
  branch: string;
  startsAt: string;
  endsAt: string;
  status: InterviewStatus;
}

export interface HrOverviewExtras {
  today: string;
  interviewsToday: number;
  interviews: HrOverviewInterview[];
  leaveRequests: number;
  /** Branch Viewers can look but not decide; the overview says so rather than offering a decision. */
  canDecide: boolean;
}

/** `branchKey` is the HR Hub's branch scope: "all" (every branch the HR account covers) or one HR branch key. */
export async function hrOverview(ctx: Ctx, branchKey: string, now = new Date()): Promise<HrOverviewExtras> {
  const a = await recruitmentAccess(ctx);
  const keys = branchKey === "all" ? a.hrUser.branches : a.hrUser.branches.includes(branchKey) ? [branchKey] : null;
  // Another branch's figures are never revealed: an unknown or unauthorised branch is "not found".
  if (!keys) throw new NotFoundError("Branch");
  const branches = a.branches.filter((b) => keys.includes(b.hrBranchKey));
  const branchIds = branches.map((b) => b.id);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const today = londonDate(now);

  const [rows, leaveRequests] = await Promise.all([
    db.candidateInterview.findMany({
      where: {
        organisationId: a.organisationId,
        candidate: { organisationId: a.organisationId, branchId: { in: branchIds } },
        status: { in: [...BOOKED, "COMPLETED"] },
        startsAt: { gte: londonToUtc(today, 0), lt: londonToUtc(addDays(today, INTERVIEW_DAYS_AHEAD + 1), 0) },
      },
      include: { candidate: { select: { id: true, firstName: true, lastName: true, roleApplied: true, branchId: true, stage: true } } },
      orderBy: { startsAt: "asc" },
      take: 200,
    }),
    db.staffAbsence.count({
      where: {
        organisationId: a.organisationId,
        status: "REQUESTED",
        staff: { organisationId: a.organisationId, hrBranchKey: { in: keys } },
        endsAt: { gte: londonToUtc(addDays(today, -30), 0) },
      },
    }),
  ]);
  const open = rows.filter((r) => isOpen(r.candidate.stage));
  return {
    today,
    interviewsToday: open.filter((r) => londonDate(r.startsAt) === today).length,
    interviews: open
      .filter((r) => BOOKED.includes(r.status) && r.startsAt >= now)
      .slice(0, 10)
      .map((r) => ({
        id: r.id,
        candidateId: r.candidate.id,
        name: `${r.candidate.firstName} ${r.candidate.lastName}`,
        role: r.candidate.roleApplied,
        branch: branchName.get(r.candidate.branchId) ?? "",
        startsAt: r.startsAt.toISOString(),
        endsAt: new Date(r.startsAt.getTime() + r.durationMin * 60_000).toISOString(),
        status: r.status,
      })),
    leaveRequests,
    canDecide: a.canEdit,
  };
}
