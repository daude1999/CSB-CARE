import { notFound } from "next/navigation";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { requirePortal } from "@/server/auth/portals";
import { recruitmentAccess } from "@/server/recruitment/access";
import { recruitmentSettings } from "@/server/recruitment/candidates";
import { recruitmentSettingsAction } from "@/app/recruitment-actions";
import { Flash, PageHeader } from "@/components/ui";
import { R_PANEL, R_PRIMARY, R_SECONDARY } from "@/components/recruitment-ui";

export const dynamic = "force-dynamic";

const INPUT = "h-10 w-24 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] tabular-nums";

/** When recruiters are reminded, and how long closed applications are kept. Reminders stay inside the platform. */
export default async function RecruitmentSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  const a = await recruitmentAccess(ctx).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const s = await recruitmentSettings(a.organisationId);
  const canChange = a.hrUser.role === "Organisation Admin" || a.hrUser.role === "Group HR";
  const row = (name: keyof typeof s, label: string, unit: string, min: number, max: number) => (
    <label className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f2f4f7] py-2.5 text-[14.5px] last:border-0">
      <span>{label}</span>
      <span className="flex items-center gap-2"><input name={name} type="number" min={min} max={max} defaultValue={String(s[name])} disabled={!canChange} className={INPUT} /><span className="w-12 text-[13.5px] text-[#475467]">{unit}</span></span>
    </label>
  );
  return (
    <div className="-mt-1">
      <PageHeader title="Recruitment: Reminders & Retention" back="/hr/recruitment" subtitle="Reminders appear in the recruiter's notifications and on the Recruitment page. Nothing is sent to candidates: no email, text or job-board connection is set up." />
      <Flash searchParams={sp} />
      <form action={recruitmentSettingsAction} className={`${R_PANEL} max-w-3xl p-4`}>
        <input type="hidden" name="back" value="/hr/recruitment/settings" />
        <label className="mb-2 flex items-center gap-2 text-[15px] font-semibold"><input type="checkbox" name="remindersOn" defaultChecked={s.remindersOn} disabled={!canChange} className="h-4 w-4" />Remind recruiters</label>
        <fieldset>
          <legend className="sr-only">Reminder timings</legend>
          {row("incompleteAfterDays", "An application is still incomplete after", "days", 1, 60)}
          {row("screeningAfterDays", "Screening answers are still not recorded after", "days", 1, 60)}
          {row("interviewConfirmHours", "An interview is not confirmed within", "hours", 1, 168)}
          {row("referencesAfterDays", "References are still outstanding after the offer by", "days", 1, 60)}
          {row("onboardingDocsAfterDays", "HR checks still have no evidence after onboarding starts by", "days", 1, 60)}
          {row("trainingAfterDays", "Required training is not complete after onboarding starts by", "days", 1, 90)}
        </fieldset>
        <h2 className="mb-1 mt-4 text-[15px] font-bold">Retention</h2>
        {row("retentionMonths", "Keep withdrawn and unsuccessful applications for", "months", 1, 24)}
        <p className="mt-1 text-[12.5px] text-[#667085]">After this, an organisation administrator or Group HR can remove the personal details. Check the period with your data protection lead; six months is common for unsuccessful applications.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {canChange ? <button className={R_PRIMARY}>Save Settings</button> : <p className="text-[13.5px] text-[#475467]">Only an organisation administrator or Group HR can change these.</p>}
          <Link href="/hr/recruitment" className={R_SECONDARY}>Back to Recruitment</Link>
        </div>
      </form>
    </div>
  );
}
