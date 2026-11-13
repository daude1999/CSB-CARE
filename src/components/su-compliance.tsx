import Link from "@/components/link";
import type { ComplianceRow } from "@/server/care/su-records";

const DOT: Record<ComplianceRow["tone"], string> = { green: "bg-[#2f8a5b]", amber: "bg-[#c98a12]", rose: "bg-[#c2333d]", slate: "bg-slate-400" };
const TEXT: Record<ComplianceRow["tone"], string> = { green: "text-[#1f6b45]", amber: "text-[#8a5a00]", rose: "text-[#a3242c]", slate: "text-slate-700" };

/**
 * "Records and compliance" on a service user's Overview: one line per kind of record, with its status in words and a
 * link to the section. Rows come from real records only (see serviceUserCompliance); nothing here is a fixed figure.
 */
export function ServiceUserCompliance({ rows }: { rows: ComplianceRow[] }) {
  return (
    <section aria-labelledby="su-compliance-h" className="card" data-testid="care-at-a-glance">
      <h2 id="su-compliance-h" className="mb-2 text-[17px]">Records and compliance</h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.key} data-row={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
            <span className="text-[14px] font-medium text-[#101828]">{r.label}</span>
            <span className="col-span-2 row-start-2 min-w-0 text-[14px] sm:col-span-1 sm:row-start-auto">
              <span className={`inline-flex items-center gap-1.5 font-medium ${TEXT[r.tone]}`}><span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.tone]}`} />{r.value}</span>
              {r.detail ? <span className="text-slate-600"> · {r.detail}</span> : null}
            </span>
            <Link href={r.href} className="col-start-2 row-start-1 text-[13px] sm:col-start-auto sm:row-start-auto">Open<span className="sr-only"> {r.label}</span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
