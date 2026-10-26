import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import type { Section } from "@/server/sources/extract";
import { Badge, Card, Field, fmtDate, PageHeader, SimulatedBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Immutable stored source text. Readable by any signed-in user (it is public regulatory material). */
export default async function SourceVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCtx();
  const v = await db.sourceVersion.findUnique({ where: { id }, include: { document: { include: { source: true } } } });
  if (!v) notFound();
  const sections = (v.sections as unknown as Section[]) ?? [];
  return (
    <>
      <PageHeader back="/changes" title={<span className="flex items-center gap-2">{v.document.title} <Badge>stored version {v.versionNumber}</Badge> <SimulatedBadge show={v.isSimulated} /></span>} subtitle={<a href={v.document.url} target="_blank" rel="noreferrer noopener">{v.document.url}</a>} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Retrieved text">
          <div className="space-y-4">
            {sections.map((s) => (
              <section key={s.ref} id={s.ref}>
                <h3>{s.heading} <span className="font-mono text-[11px] font-normal text-slate-400">{s.ref}</span></h3>
                <p className="prose-policy mt-1 text-sm">{s.text}</p>
              </section>
            ))}
          </div>
        </Card>
        <Card title="Provenance">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Source">{v.document.source.name}</Field>
            <Field label="Legal status">{v.document.legalStatus.replace(/_/g, " ").toLowerCase()}</Field>
            <Field label="Retrieved">{fmtDate(v.retrievedAt, true)}</Field>
            <Field label="Official published date">{v.publishedAt ? fmtDate(v.publishedAt) : "Not supplied by source"}</Field>
            <Field label="Official modified date">{v.modifiedAt ? fmtDate(v.modifiedAt) : "Not supplied by source"}</Field>
            <Field label="Content hash"><span className="break-all font-mono text-[11px]">{v.contentHash}</span></Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">Stored versions cannot be edited or deleted. Always check the live source before relying on this text.</p>
        </Card>
      </div>
    </>
  );
}
