import { addDays, londonDate, mondayOf } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { Card, Flash, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Printable Rota: OnePlan's paper rota per team member or per service user, as a PDF made on the server. */
export default async function PrintRotaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("rota.view");
  const lk = await rotaLookups(ctx);
  const from = mondayOf(londonDate());
  const to = addDays(from, 6);
  const canKeySafe = hasOrgPermission(ctx, "serviceUser.keysafe");
  const options = (kind: "CARER" | "SERVICE_USER") => (
    <>
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-3 gap-2">
        <label><span className="label">From</span><input type="date" name="from" defaultValue={from} required className="input" /></label>
        <label><span className="label">To</span><input type="date" name="to" defaultValue={to} required className="input" /></label>
        <label><span className="label">Font size</span><select name="fontSize" defaultValue="10" className="input">{[8, 9, 10, 11, 12, 14].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <fieldset className="grid grid-cols-2 gap-1 text-[13.5px]">
        <legend className="label">Include</legend>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="includeCancelled" value="1" />Cancelled visits</label>
        {kind === "CARER" ? <label className="flex items-center gap-1.5"><input type="checkbox" name="includeShadow" value="1" defaultChecked />Shadow visits</label> : null}
        <label className="flex items-center gap-1.5"><input type="checkbox" name="separatePages" value="1" defaultChecked />A page per person</label>
        {kind === "CARER" ? <label className="flex items-center gap-1.5"><input type="checkbox" name="address" value="1" defaultChecked />Address</label> : null}
        <label className="flex items-center gap-1.5"><input type="checkbox" name="medication" value="1" />Medication prompt</label>
        {kind === "CARER" && canKeySafe ? <label className="flex items-center gap-1.5"><input type="checkbox" name="keySafe" value="1" />Key safe codes (recorded)</label> : null}
        <label className="flex items-center gap-1.5"><input type="checkbox" name="excludeSurname" value="1" />Leave out surnames</label>
      </fieldset>
    </>
  );
  return (
    <>
      <PageHeader title="Printable Rota" back="/rota" subtitle="Download a paper rota as a PDF, per team member or per service user, for up to 31 days. Every print is recorded, and key safe codes are only included when you ask and are allowed to see them." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Per team member">
          <form method="get" action="/api/rota/print" className="space-y-3">
            {options("CARER")}
            <label className="block"><span className="label">Team members</span><select name="ids" multiple required size={8} className="input">{lk.staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}</select></label>
            <button className="btn-primary">Download PDF</button>
          </form>
        </Card>
        <Card title="Per service user">
          <form method="get" action="/api/rota/print" className="space-y-3">
            {options("SERVICE_USER")}
            <label className="block"><span className="label">Service users</span><select name="ids" multiple required size={8} className="input">{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select></label>
            <button className="btn-primary">Download PDF</button>
          </form>
        </Card>
      </div>
    </>
  );
}
