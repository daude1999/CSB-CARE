import type { RiskAssessment, RiskLevel } from "@prisma/client";
import type { Tone } from "@/components/ui";
import { RISK_TYPE_LABEL } from "@/server/care/risks";
import { addDays, fromDbDate, londonDate } from "@/lib/london";

export const LEVEL: Record<RiskLevel, { label: string; tone: Tone }> = { LOW: { label: "Low", tone: "green" }, MEDIUM: { label: "Medium", tone: "amber" }, HIGH: { label: "High", tone: "rose" } };

/** The fields of a risk assessment, shared by "new" and "review". Server-rendered; no client state. */
export function RiskFields({ risk }: { risk?: Pick<RiskAssessment, "type" | "title" | "hazards" | "controls" | "level" | "reviewDue"> }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
      <label><span className="label">Type</span>
        <select name="type" defaultValue={risk?.type ?? ""} required className="input"><option value="" disabled>Choose…</option>{Object.entries(RISK_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label><span className="label">Risk level after controls</span>
        <select name="level" defaultValue={risk?.level ?? ""} required className="input"><option value="" disabled>Choose…</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
      </label>
      <label><span className="label">Review by</span><input type="date" name="reviewDue" required defaultValue={risk ? fromDbDate(risk.reviewDue) : addDays(londonDate(), 182)} className="input" /></label>
      <label className="md:col-span-3"><span className="label">Title</span><input name="title" required minLength={3} defaultValue={risk?.title ?? ""} placeholder="e.g. Transfers from bed to chair" className="input" /></label>
      <label className="md:col-span-3"><span className="label">Hazards: what could go wrong, and who could be hurt</span><textarea name="hazards" rows={4} required minLength={10} defaultValue={risk?.hazards ?? ""} className="input" /></label>
      <label className="md:col-span-3"><span className="label">Controls: what carers do to reduce the risk</span><textarea name="controls" rows={5} required minLength={10} defaultValue={risk?.controls ?? ""} className="input" /></label>
    </div>
  );
}
