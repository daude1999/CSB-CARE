import type { ReactNode } from "react";
import type { RecruitmentStage, RightToWorkStatus } from "@prisma/client";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { PIPELINE, RTW_LABEL, STAGE_LABEL } from "@/server/recruitment/model";

/** Recruitment's building blocks, in the Daily Rota's interaction language with HR & Workforce's orange accent. */

export const HR_ACCENT = "#c2410c";
export const R_PANEL = "min-w-0 rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
export const R_BTN = "inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-4 text-[14.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c2410c] disabled:opacity-60";
export const R_PRIMARY = `${R_BTN} bg-[#c2410c] text-white hover:bg-[#9a3412]`;
export const R_SECONDARY = `${R_BTN} border border-[#d0d5dd] bg-white text-[#101828] hover:bg-slate-50`;
export const R_TH = "whitespace-nowrap px-3 py-2.5 text-left text-[13.5px] font-semibold text-[#101828]";
export const R_TD = "px-3 py-2.5 align-top";

const STAGE_TONE: Record<RecruitmentStage, string> = {
  APPLIED: "bg-[#f2f4f7] text-[#344054]",
  SCREENING: "bg-[#eef4ff] text-[#3538cd]",
  INTERVIEW: "bg-[#f4f3ff] text-[#5925dc]",
  OFFER: "bg-[#fef6ee] text-[#b93815]",
  ONBOARDING: "bg-[#ecfdf3] text-[#067647]",
  READY: "bg-[#067647] text-white",
  WITHDRAWN: "bg-[#f2f4f7] text-[#667085]",
  UNSUCCESSFUL: "bg-[#fef3f2] text-[#b42318]",
};

export function StageBadge({ stage }: { stage: RecruitmentStage }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

export function RtwBadge({ status }: { status: RightToWorkStatus }) {
  const tone = status === "VERIFIED" ? "text-[#067647]" : status === "NOT_ELIGIBLE" ? "text-[#b42318]" : status === "IN_PROGRESS" ? "text-[#b54708]" : "text-[#475467]";
  return <span className={`whitespace-nowrap text-[13px] font-medium ${tone}`}>{RTW_LABEL[status]}</span>;
}

/** Applied → Screening → Interview → Offer → Onboarding → Ready for Work, with the current stage marked. */
export function StageSteps({ stage }: { stage: RecruitmentStage }) {
  const at = PIPELINE.indexOf(stage);
  return (
    <ol aria-label="Recruitment stage" className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[13.5px]">
      {PIPELINE.map((s, i) => {
        const done = at > i;
        const current = at === i;
        return (
          <li key={s} aria-current={current ? "step" : undefined} className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ${current ? "bg-[#c2410c] text-white" : done ? "bg-[#fff1e6] text-[#9a3412]" : "bg-[#f2f4f7] text-[#667085]"}`}>
              {done ? <Check size={13} weight="bold" aria-hidden /> : <span aria-hidden className="tabular-nums">{i + 1}</span>}
              {STAGE_LABEL[s]}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
            {i < PIPELINE.length - 1 ? <span aria-hidden className="h-px w-3 bg-[#d0d5dd]" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function Section({ id, title, aside, children, className = "" }: { id: string; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`${R_PANEL} ${className}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eaecf0] px-4 py-3">
        <h2 id={id} className="text-[16px] font-bold text-[#101828]">{title}</h2>
        {aside ? <span className="ml-auto flex flex-wrap items-center gap-2">{aside}</span> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12.5px] font-semibold uppercase tracking-[0.02em] text-[#667085]">{k}</dt>
          <dd className="mt-0.5 break-words text-[14.5px] text-[#101828]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Eligible / Needs Review / Not Eligible, in the words the rota uses. */
export function EligibilityPill({ state, label }: { state: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE"; label: string }) {
  const tone = state === "ELIGIBLE" ? "bg-[#ecfdf3] text-[#067647] ring-[#abefc6]" : state === "REQUIRES_REVIEW" ? "bg-[#fffaeb] text-[#b54708] ring-[#fedf89]" : "bg-[#fef3f2] text-[#b42318] ring-[#fecdca]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${tone}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>;
}

export interface CandidateFormValues {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  roleApplied?: string;
  branchId?: string;
  availability?: string | null;
  experience?: string | null;
  driving?: string;
  rightToWork?: RightToWorkStatus;
  source?: string | null;
  applicationComplete?: boolean;
  outstandingDocuments?: string[];
  recruiterId?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  contactConsent?: boolean;
}

const INPUT = "h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#101828]";
const AREA = "w-full rounded-[8px] border border-[#d0d5dd] bg-white px-3 py-2 text-[14px] text-[#101828]";
const LABEL = "mb-1 block text-[13.5px] font-semibold text-[#344054]";

/** The candidate form, for adding and editing. Only the details needed to recruit are asked for. */
export function CandidateFields({ v = {}, branches, recruiters, documents }: { v?: CandidateFormValues; branches: { id: string; name: string }[]; recruiters: { id: string; name: string }[]; documents: string[] }) {
  const extra = (v.outstandingDocuments ?? []).filter((d) => !documents.includes(d));
  return (
    <div className="space-y-4">
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <legend className="mb-2 text-[15px] font-bold text-[#101828]">Who and what for</legend>
        <label><span className={LABEL}>First name</span><input name="firstName" required maxLength={60} defaultValue={v.firstName ?? ""} className={INPUT} autoComplete="off" /></label>
        <label><span className={LABEL}>Last name</span><input name="lastName" required maxLength={60} defaultValue={v.lastName ?? ""} className={INPUT} autoComplete="off" /></label>
        <label><span className={LABEL}>Email</span><input name="email" type="email" maxLength={200} defaultValue={v.email ?? ""} className={INPUT} autoComplete="off" /></label>
        <label><span className={LABEL}>Phone</span><input name="phone" type="tel" maxLength={30} defaultValue={v.phone ?? ""} className={INPUT} autoComplete="off" /></label>
        <label><span className={LABEL}>Role applied for</span><input name="roleApplied" required maxLength={100} defaultValue={v.roleApplied ?? "Care Support Worker"} className={INPUT} /></label>
        <label><span className={LABEL}>Preferred branch</span><select name="branchId" required defaultValue={v.branchId ?? branches[0]?.id ?? ""} className={INPUT}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label><span className={LABEL}>Where the application came from</span><input name="source" maxLength={80} defaultValue={v.source ?? ""} placeholder="For example: website, referral, job board (typed in by hand)" className={INPUT} /></label>
        <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" name="contactConsent" defaultChecked={v.contactConsent ?? false} className="h-4 w-4" />The candidate agreed to be contacted about this application</label>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <legend className="mb-2 text-[15px] font-bold text-[#101828]">Suitability</legend>
        <label><span className={LABEL}>Availability</span><textarea name="availability" rows={2} maxLength={500} defaultValue={v.availability ?? ""} placeholder="Days and times they can work" className={AREA} /></label>
        <label><span className={LABEL}>Relevant experience</span><textarea name="experience" rows={2} maxLength={1000} defaultValue={v.experience ?? ""} className={AREA} /></label>
        <label><span className={LABEL}>Driving</span><select name="driving" defaultValue={v.driving ?? "NOT_ASKED"} className={INPUT}><option value="NOT_ASKED">Not asked yet</option><option value="DRIVER_WITH_CAR">Drives and has a car</option><option value="DRIVER_NO_CAR">Drives, no car</option><option value="NON_DRIVER">Does not drive</option></select></label>
        <label><span className={LABEL}>Right to work</span><select name="rightToWork" defaultValue={v.rightToWork ?? "NOT_CHECKED"} className={INPUT}><option value="NOT_CHECKED">Not checked yet</option><option value="IN_PROGRESS">Check in progress</option><option value="VERIFIED">Seen and verified</option><option value="NOT_ELIGIBLE">No right to work</option></select></label>
        <label className="flex items-center gap-2 text-[14px] md:col-span-2"><input type="checkbox" name="incomplete" defaultChecked={v.applicationComplete === false} className="h-4 w-4" />The application is missing details we still need from the candidate</label>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold text-[#101828]">Outstanding documents</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => <label key={d} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="docs" value={d} defaultChecked={v.outstandingDocuments?.includes(d)} className="h-4 w-4" />{d}</label>)}
        </div>
        <label className="mt-2 block"><span className={LABEL}>Anything else (one per line)</span><textarea name="outstandingDocuments" rows={2} defaultValue={extra.join("\n")} className={AREA} /></label>
      </fieldset>
      <fieldset className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <legend className="mb-2 text-[15px] font-bold text-[#101828]">Who is dealing with it</legend>
        <label><span className={LABEL}>Recruiter</span><select name="recruiterId" defaultValue={v.recruiterId ?? ""} className={INPUT}><option value="">Not assigned</option>{recruiters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label><span className={LABEL}>Next action (optional)</span><input name="nextAction" maxLength={160} defaultValue={v.nextAction ?? ""} placeholder="Leave blank to use the suggested next step" className={INPUT} /></label>
        <label><span className={LABEL}>Next action by</span><input name="nextActionDue" type="date" defaultValue={v.nextActionDue ?? ""} className={INPUT} /></label>
      </fieldset>
      <p className="text-[12.5px] text-[#667085]">Only ask for what is needed to recruit. Do not record health, age, family or other protected characteristics here.</p>
    </div>
  );
}
