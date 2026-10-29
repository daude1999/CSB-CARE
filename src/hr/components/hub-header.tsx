"use client";
import { PageHeader } from "@/components/ui";

type Branch = { id: string; name: string };

/**
 * The top of every HR Hub screen, as on every other module's pages: the title bar in the module colour, then a strip
 * with what the page shows and the branch it shows it for. Platform styles, so it sits outside the HR Hub's `.cs` root.
 */
export function HubHeader({
  title,
  back,
  scope,
  setScope,
  data,
}: {
  title: string;
  back?: string;
  scope: string;
  setScope: (value: string) => void;
  data: { branches: Branch[]; allBranches: boolean };
}) {
  return (
    <PageHeader
      title={title}
      back={back ?? null}
      subtitle="People, checks and documents for the branch chosen here."
      actions={
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          Branch
          <select
            aria-label="Branch scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-[34px] rounded-[4px] border border-slate-300 bg-white px-2.5 text-[14px] text-slate-800 focus:border-navy-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
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
