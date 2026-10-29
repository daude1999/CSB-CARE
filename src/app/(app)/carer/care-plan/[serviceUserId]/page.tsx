import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { orNotFound } from "@/server/auth/page-guard";
import { carerCarePlan } from "@/server/care/care-plans";
import { RISK_TYPE_LABEL } from "@/server/care/risks";
import { suName } from "@/server/rota/queries";
import { acknowledgePlanAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { LEVEL } from "@/components/risk-fields";

export const dynamic = "force-dynamic";

export default async function CarerCarePlanPage({ params, searchParams }: { params: Promise<{ serviceUserId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ serviceUserId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requirePortal("rota");
  const { serviceUser: su, plan, risks } = await orNotFound(carerCarePlan(ctx, serviceUserId));
  const back = `/carer/care-plan/${su.id}`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${suName(su)}`} back="/carer" subtitle="The care plan and risk controls for someone you visit. Read-only. Tell the office if anything here is out of date." />
      <Flash searchParams={sp} />
      {plan ? (
        <>
          {!plan.acknowledgements.length ? (
            <form action={acknowledgePlanAction} className="panel mb-3 flex flex-wrap items-center justify-between gap-2">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="serviceUserId" value={su.id} />
              <input type="hidden" name="planId" value={plan.id} />
              <p className="text-[14px]">Version {plan.version}. Confirm once you have read it all.</p>
              <button className="btn-primary">I have read this care plan</button>
            </form>
          ) : <p className="mb-3 text-[14px] text-slate-700"><Badge tone="green">Read</Badge> You confirmed version {plan.version}.</p>}
          {plan.summary ? <Card title="Summary" className="mb-3"><p className="whitespace-pre-line text-[14.5px]">{plan.summary}</p></Card> : null}
          {risks.length ? (
            <Card title="Risks and what to do" className="mb-3">
              <ul className="rows">
                {risks.map((r) => (
                  <li key={r.id} className="py-2.5 text-[14.5px]">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><Badge tone={LEVEL[r.level].tone}>{LEVEL[r.level].label}</Badge><span className="text-[12.5px] text-slate-500">{RISK_TYPE_LABEL[r.type]}</span></div>
                    <p className="mt-1 whitespace-pre-line">{r.controls}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {plan.sections.map((s) => (
            <Card key={s.id} title={s.title} className="mb-3">
              <p className="whitespace-pre-line text-[14.5px]">{s.body}</p>
              {s.outcomes ? <p className="mt-2 whitespace-pre-line border-l-2 border-teal-600 pl-3 text-[14px] text-slate-700"><span className="font-medium">Outcomes: </span>{s.outcomes}</p> : null}
            </Card>
          ))}
        </>
      ) : <Card><Empty>There is no approved care plan for {suName(su)} yet. Ask the office before your visit.</Empty></Card>}
      <p className="text-[14px]"><Link href={`/rota/incidents/new?su=${su.id}`}>Report an incident about {suName(su)}</Link></p>
    </div>
  );
}
