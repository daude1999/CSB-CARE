"use client";
import { useMemo, useState } from "react";
import Link from "@/components/link";
import { bulkSignoffAction } from "@/app/signoff-actions";
import { Menu } from "@/components/library/menu";
import { DotsThreeVertical } from "@phosphor-icons/react";

export type RegisterRow = {
  id: string;
  person: string;
  personHref: string;
  role: string;
  branch: string;
  policy: string;
  policyHref: string;
  version: string;
  assigned: string;
  due: string;
  overdue: boolean;
  status: string;
  tone: "green" | "amber" | "red" | "blue" | "purple" | "grey";
  acknowledged: string;
  outstanding: boolean;
};

type Op = "remind" | "extend" | "exempt";

/**
 * The Staff Sign-off register (screenshot 04). With sign-off management rights, rows can be ticked and a bar offers
 * Send reminder, Extend due date and Exempt. Only outstanding rows can be ticked: nobody is ever marked as having read
 * a policy on their behalf, and acknowledged rows are evidence that cannot be changed. The server re-checks every row.
 */
export function SignoffRegister({ rows, canManage, back }: { rows: RegisterRow[]; canManage: boolean; back: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [op, setOp] = useState<Op | null>(null);
  const selectable = useMemo(() => rows.filter((r) => r.outstanding).map((r) => r.id), [rows]);
  const all = selectable.length > 0 && selectable.every((id) => picked.has(id));
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={bulkSignoffAction} data-testid="signoff-register">
      <input type="hidden" name="back" value={back} />
      {canManage && picked.size ? (
        <div className="pc-bulk" role="region" aria-label="Bulk actions" data-testid="bulk-bar">
          <span className="font-semibold">{picked.size} selected</span>
          <span aria-hidden="true" className="h-5 w-px bg-module/[.30]" />
          {[...picked].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <button type="submit" name="op" value="remind" formNoValidate className="pc-btn-secondary pc-btn-sm">Send reminder</button>
          <button type="button" className="pc-btn-secondary pc-btn-sm" aria-expanded={op === "extend"} onClick={() => setOp(op === "extend" ? null : "extend")}>Extend due date</button>
          <button type="button" className="pc-btn-secondary pc-btn-sm" aria-expanded={op === "exempt"} onClick={() => setOp(op === "exempt" ? null : "exempt")}>Exempt</button>
          <button type="button" className="ml-auto text-meta font-semibold text-module" onClick={() => { setPicked(new Set()); setOp(null); }}>Clear selection</button>
          {op ? (
            <div className="flex w-full flex-wrap items-end gap-2 border-t border-[#e4dcf8] pt-2">
              {op === "extend" ? (
                <label className="text-meta font-medium text-[#344054]">New due date<input type="date" name="dueAt" required min={today} className="input mt-1 h-[34px] py-0" /></label>
              ) : null}
              <label className="min-w-[240px] flex-1 text-meta font-medium text-[#344054]">Reason (kept on each record)<input name="reason" required minLength={5} maxLength={500} placeholder={op === "extend" ? "For example: on annual leave until 20 Nov" : "For example: on long-term leave, not working"} className="input mt-1 h-[34px] py-0" /></label>
              <button type="submit" name="op" value={op} className="pc-btn pc-btn-sm">{op === "extend" ? `Set new date for ${picked.size}` : `Exempt ${picked.size}`}</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="relative min-w-0 overflow-x-auto xl:overflow-visible">
        <table className="pc-table">
          <thead>
            <tr>
              {canManage ? (
                <th className="w-[44px]">
                  <input type="checkbox" className="pc-check" aria-label="Select every outstanding row" checked={all} disabled={!selectable.length} onChange={() => setPicked(all ? new Set() : new Set(selectable))} />
                </th>
              ) : null}
              <th>Employee</th><th>Policy</th><th>Assigned</th><th>Due</th><th>Status</th><th>Acknowledged</th><th className="w-[52px]"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="signoff-row">
                {canManage ? (
                  <td>
                    <input type="checkbox" className="pc-check" aria-label={`Select ${r.person}, ${r.policy}`} disabled={!r.outstanding} checked={picked.has(r.id)} onChange={() => toggle(r.id)} title={r.outstanding ? undefined : "Only outstanding reading can be selected"} />
                  </td>
                ) : null}
                <td>
                  <Link href={r.personHref} className="pc-strong">{r.person}</Link>
                  <span className="pc-sub">{r.role} · {r.branch}</span>
                </td>
                <td className="max-w-[360px]">
                  <Link href={r.policyHref} className="pc-strong font-medium">{r.policy}</Link>
                  <span className="pc-sub">{r.version}</span>
                </td>
                <td className="whitespace-nowrap">{r.assigned}</td>
                <td className={`whitespace-nowrap ${r.overdue ? "font-semibold text-[#b42318]" : ""}`}>{r.due}</td>
                <td><span className="pc-badge" data-tone={r.tone}>{r.status}</span></td>
                <td className="whitespace-nowrap">{r.acknowledged}</td>
                <td className="text-right">
                  <Menu label={`Actions for ${r.person}, ${r.policy}`} trigger={<DotsThreeVertical size={18} weight="bold" />}>
                    <Link href={r.personHref} className="pl-menu-item">Open {r.person}&apos;s reading</Link>
                    <Link href={r.policyHref} className="pl-menu-item">Open the policy&apos;s sign-off</Link>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
