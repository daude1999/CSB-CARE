import { requireCtx } from "@/server/auth/current";
import { platformHealth } from "@/server/platform/health";
import { fmtBytes, KeyValues, Pill, PxHeader, PxPanel, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Health" };

export default async function HealthPage() {
  const ctx = await requireCtx();
  const h = await platformHealth(ctx);
  return (
    <>
      <PxHeader title="Platform Health" description="Checked now, when this page opened. Each line says whether it was measured, recorded by a person, or is not configured." />
      <p className="mb-4 text-[15px]">Overall: <strong className={h.overall === "Healthy" ? "text-[#17663a]" : "text-[#a11d2b]"}>{h.overall}</strong> <span className="text-[13px] text-[#5b6478]">(database and job queue)</span></p>
      <PxPanel title="Checks">
        <Table head={["Check", "State", "Detail", "Source"]}>
          {h.checks.map((c) => <tr key={c.name}><td className="font-medium">{c.name}</td><td><Pill value={c.state} /></td><td className="text-[13px]">{c.detail}</td><td className="text-[12.5px] text-[#5b6478]">{c.measure}</td></tr>)}
        </Table>
      </PxPanel>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PxPanel title="Database"><KeyValues items={[["Response time", h.database.latencyMs === null ? "Not responding" : `${h.database.latencyMs} ms`], ["Size", fmtBytes(h.database.sizeBytes)]]} /></PxPanel>
        <PxPanel title="Deployment"><KeyValues items={[["Version", h.deployment.commit ?? "Not reported by the host"], ["Branch", h.deployment.branch ?? "—"], ["Environment", h.deployment.environment], ["Host", h.deployment.host], ["Region", h.deployment.region ?? "—"], ["Node.js", h.deployment.nodeVersion]]} /></PxPanel>
      </div>
    </>
  );
}
