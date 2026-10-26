import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { acknowledgeAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, Stat, StatRow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AcknowledgementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const acks = ctx.organisationId
    ? await db.acknowledgement.findMany({ where: { userId: ctx.userId, organisationId: ctx.organisationId }, orderBy: [{ acknowledgedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], include: { publication: { include: { policy: { select: { id: true, ref: true, title: true } }, version: { select: { label: true, changeSummary: true } } } } } })
    : [];
  const now = new Date();
  const signed = acks.filter((a) => a.acknowledgedAt).length;
  const overdue = acks.filter((a) => !a.acknowledgedAt && a.dueAt && a.dueAt < now).length;
  return (
    <>
      <PageHeader eyebrow="Read and sign" title="My Reading List" subtitle="Policies published or updated that you have been asked to read and acknowledge." />
      <Flash searchParams={sp} />
      <StatRow>
        <Stat label="Overdue" value={overdue} hint="Past the due date" tone="rose" />
        <Stat label="Total Due" value={acks.length - signed} hint="Still to read and sign" tone="amber" />
        <Stat label="Completed" value={signed} hint="Read and signed" tone="green" />
        <Stat label="Progress" value={`${acks.length ? Math.round((signed / acks.length) * 100) : 100}%`} hint="Of your reading list" tone="navy" />
      </StatRow>
      <Card title="Policies to read">
        {acks.length ? (
          <ul className="rows">
            {acks.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`ack-${a.publication.policy.ref}`}>
                <div>
                  <span className="mr-3 text-[14px] text-slate-700">{a.publication.policy.ref.replace(/^CSB-/, "")}</span><Link href={`/policies/${a.publication.policy.id}`} className="row-title text-[15.5px]">{a.publication.policy.title}</Link> <span className="text-[13px] text-slate-600">{a.publication.version.label}</span>
                  {a.publication.version.changeSummary ? <div className="mt-0.5 text-[13px] text-slate-600">What changed: {a.publication.version.changeSummary}</div> : null}
                  <div className="mt-1.5">{a.acknowledgedAt ? <Badge tone="green">acknowledged {fmtDate(a.acknowledgedAt)}</Badge> : a.dueAt && a.dueAt < now ? <Badge tone="rose">overdue since {fmtDate(a.dueAt)}</Badge> : <Badge tone="amber">due {fmtDate(a.dueAt)}</Badge>}</div>
                </div>
                {!a.acknowledgedAt ? (
                  <form action={acknowledgeAction}>
                    <input type="hidden" name="acknowledgementId" value={a.id} />
                    <input type="hidden" name="back" value="/acknowledgements" />
                    <button className="btn-primary" type="submit">I have read and understood this policy</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>You have nothing to acknowledge.</Empty>
        )}
      </Card>
    </>
  );
}
