"use client";
import { HrPageHeader } from "@/components/module-header";
import { HrTabs, hrTabs, type HrSection } from "@/components/hr-tabs";

type Branch = { id: string; name: string };

/** What each HR Hub screen is for, in one plain sentence (shown under the title bar). */
const PURPOSE: Record<string, string> = {
  dashboard: "Your people, the checks that need action and what is coming up, for the branch chosen here.",
  alerts: "Reminders about checks that are due or overdue, and the HR tasks assigned to people.",
  tasks: "HR tasks assigned to you. Open a task to see the employee and what is needed.",
  people: "Everyone employed, with their role, branch and whether their checks are up to date.",
  record: "One employee's details, checks, documents, training and history.",
  training: "Each employee's checks and training at a glance. Open a person to record or verify evidence.",
  compliance: "Every required check, its evidence and review date. Review a check to record a decision.",
  documents: "Find an employee and see which required documents are on file, verified or missing.",
  branches: "Your branches and how each one is doing.",
  settings: "Checks required for each role, reminder timings, document types and data retention.",
  imports: "Bring employee records in from a spreadsheet.",
};

const SECTION_OF: Record<string, { section: HrSection; tab: string; title: string } | undefined> = {
  dashboard: { section: "home", tab: "dashboard", title: "HR Dashboard" },
  alerts: { section: "home", tab: "alerts", title: "HR Dashboard" },
  tasks: { section: "home", tab: "tasks", title: "HR Dashboard" },
  training: { section: "checks", tab: "training", title: "Checks & Training" },
  compliance: { section: "checks", tab: "compliance", title: "Checks & Training" },
  settings: { section: "settings", tab: "settings", title: "Settings" },
  branches: { section: "settings", tab: "branches", title: "Settings" },
};

/**
 * The top of every HR Hub screen: the orange HR title bar (left-aligned, as in the approved HR designs), the tabs of
 * the HR destination the screen belongs to, then one strip with what the page is for and the branch picker.
 */
export function HubHeader({
  title,
  page,
  back,
  scope,
  setScope,
  data,
}: {
  title: string;
  /** The screen on show: dashboard, tasks, alerts, people, record, training, compliance, documents, ... */
  page: string;
  back?: string;
  scope: string;
  setScope: (value: string) => void;
  data: { branches: Branch[]; allBranches: boolean };
}) {
  const where = SECTION_OF[page];
  const tabs = where ? hrTabs(where.section, { hrLogin: true }) : [];
  return (
    <HrPageHeader
      title={where?.title ?? title}
      back={back ?? null}
      tabs={where ? <HrTabs tabs={tabs} active={where.tab} label={`${where.title} sections`} branch={scope} /> : undefined}
      subtitle={PURPOSE[page] ?? "People, checks and documents for the branch chosen here."}
      actions={
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          Branch
          <select
            aria-label="Branch scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-[34px] rounded-[6px] border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800 focus:border-[#c2410c] focus:outline-none focus:ring-2 focus:ring-[#fed7aa]"
          >
            <option value="all">{data.allBranches ? "All branches" : "All assigned branches"}</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      }
    />
  );
}
