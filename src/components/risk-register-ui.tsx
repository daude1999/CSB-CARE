import Link from "@/components/link";
import { BAND_LABEL, CONTROL_EFFECTIVENESS, IMPACT, LIKELIHOOD, REVIEW_MONTHS, RISK_CATEGORIES, riskBand, type RiskBand } from "@/server/compliance/risks";
import type { Tone } from "@/components/ui";

export const BAND_TONE: Record<RiskBand, Tone> = { LOW: "green", MODERATE: "amber", HIGH: "rose", EXTREME: "rose" };
const CELL: Record<RiskBand, string> = { LOW: "bg-[#dff3e7] text-[#1c5e37]", MODERATE: "bg-[#fdf0d8] text-[#7a4f00]", HIGH: "bg-[#fbd5c8] text-[#8a2a0d]", EXTREME: "bg-[#f3b7b7] text-[#7a1010]" };

/** A rating as "12 High", coloured by band. */
export function RatingChip({ score }: { score: number }) {
  const band = riskBand(score);
  return <span className={`inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[4px] px-[7px] text-[12px] font-medium ${CELL[band]}`}><span className="tabular-nums">{score}</span> {BAND_LABEL[band]}</span>;
}

/**
 * The 5 x 5 matrix with the number of open risks in each residual cell. Each count opens the register filtered to
 * that band. Likelihood runs up the side, impact along the bottom, as on a paper register.
 */
export function RiskMatrix({ cells }: { cells: Map<string, number> }) {
  return (
    <figure>
      <table className="w-full border-separate border-spacing-[3px] text-center text-[12px]" aria-label="Open risks by residual likelihood and impact">
        <tbody>
          {[5, 4, 3, 2, 1].map((l) => (
            <tr key={l}>
              <th scope="row" className="w-[86px] pr-1 text-right font-normal text-slate-600">{LIKELIHOOD[l - 1]} ({l})</th>
              {[1, 2, 3, 4, 5].map((i) => {
                const n = cells.get(`${l}:${i}`) ?? 0;
                const band = riskBand(l * i);
                return <td key={i} className={`h-[30px] rounded-[3px] ${CELL[band]} ${n ? "font-semibold" : "opacity-70"}`} title={`Likelihood ${l} x impact ${i} = ${l * i} (${BAND_LABEL[band]}): ${n} open`}>{n || ""}<span className="sr-only">{n ? "" : "0"}</span></td>;
              })}
            </tr>
          ))}
          <tr>
            <td />
            {[1, 2, 3, 4, 5].map((i) => <th key={i} scope="col" className="pt-1 align-top text-[11px] font-normal leading-tight text-slate-600">{IMPACT[i - 1]} ({i})</th>)}
          </tr>
        </tbody>
      </table>
      <figcaption className="mt-2 text-[12px] leading-5 text-slate-600">Rating = likelihood x impact. Low 1 to 3, Moderate 4 to 6, High 8 to 12, Extreme 15 to 25. Review at least every {REVIEW_MONTHS.LOW} months (Low), {REVIEW_MONTHS.MODERATE} (Moderate), {REVIEW_MONTHS.HIGH} (High) or monthly (Extreme). An internal management tool, not a regulatory rating.</figcaption>
    </figure>
  );
}

type RiskValues = { title: string; description: string; category: string; branchId: string | null; likelihood: number; impact: number; existingControls: string; controlEffectiveness: string; residualLikelihood: number; residualImpact: number; ownerId: string; reviewDate: Date; findingId?: string | null };

const ScoreSelect = ({ name, label, scale, value }: { name: string; label: string; scale: readonly string[]; value?: number }) => (
  <label><span className="label">{label}</span>
    <select name={name} required defaultValue={value ? String(value) : ""} className="input">
      <option value="" disabled>Choose…</option>
      {scale.map((s, n) => <option key={s} value={n + 1}>{n + 1}. {s}</option>)}
    </select>
  </label>
);

/** The risk's fields, for adding and editing. Server-rendered; every value is validated again on the server. */
export function RiskFormFields({ risk, branches, members, branchRequired }: { risk?: RiskValues; branches: { id: string; name: string }[]; members: { userId: string; name: string }[]; branchRequired: boolean }) {
  const reviewDefault = risk ? risk.reviewDate.toISOString().slice(0, 10) : new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="md:col-span-2"><span className="label">Title</span><input name="title" required minLength={5} maxLength={160} defaultValue={risk?.title ?? ""} placeholder="e.g. Not enough carers for weekend evening calls" className="input" /></label>
      <label className="md:col-span-2"><span className="label">Description: what could happen, why, and who would be affected</span><textarea name="description" required minLength={10} rows={3} defaultValue={risk?.description ?? ""} className="input" /></label>
      <label><span className="label">Category</span>
        <select name="category" required defaultValue={risk?.category ?? ""} className="input"><option value="" disabled>Choose…</option>{Object.entries(RISK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label><span className="label">Scope</span>
        <select name="branchId" defaultValue={risk?.branchId ?? ""} required={branchRequired} className="input">
          {branchRequired ? <option value="" disabled>Choose a branch…</option> : <option value="">Whole organisation</option>}
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <fieldset className="rounded-[4px] border border-slate-200 p-3 md:col-span-2">
        <legend className="px-1 text-[13px] font-medium text-slate-800">Inherent risk (before any controls)</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreSelect name="likelihood" label="Likelihood" scale={LIKELIHOOD} value={risk?.likelihood} />
          <ScoreSelect name="impact" label="Impact" scale={IMPACT} value={risk?.impact} />
        </div>
      </fieldset>
      <label className="md:col-span-2"><span className="label">Existing controls: what is already in place to reduce the risk</span><textarea name="existingControls" required minLength={5} rows={3} defaultValue={risk?.existingControls ?? ""} className="input" /></label>
      <label><span className="label">How well the controls work</span>
        <select name="controlEffectiveness" defaultValue={risk?.controlEffectiveness ?? "NOT_ASSESSED"} className="input">{Object.entries(CONTROL_EFFECTIVENESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <span className="hidden md:block" />
      <fieldset className="rounded-[4px] border border-slate-200 p-3 md:col-span-2">
        <legend className="px-1 text-[13px] font-medium text-slate-800">Residual risk (with the existing controls)</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreSelect name="residualLikelihood" label="Likelihood" scale={LIKELIHOOD} value={risk?.residualLikelihood} />
          <ScoreSelect name="residualImpact" label="Impact" scale={IMPACT} value={risk?.residualImpact} />
        </div>
      </fieldset>
      <label><span className="label">Owner</span>
        <select name="ownerId" required defaultValue={risk?.ownerId ?? ""} className="input"><option value="" disabled>Choose…</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
      </label>
      <label><span className="label">Next review</span><input type="date" name="reviewDate" required defaultValue={reviewDefault} className="input" /></label>
      {risk?.findingId ? <input type="hidden" name="findingId" value={risk.findingId} /> : null}
    </div>
  );
}

export function RiskRef({ id, refText, title }: { id: string; refText: string; title: string }) {
  return <Link href={`/compliance/risks/${id}`} className="row-title"><span className="mr-2 font-normal text-slate-600">{refText}</span>{title}</Link>;
}
