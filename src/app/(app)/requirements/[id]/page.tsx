import Link from "@/components/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { visiblePolicyWhere } from "@/server/auth/rbac";
import { Card, Empty, Field, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const r = await db.regulatoryRequirement.findUnique({
    where: { id },
    include: {
      source: true,
      versions: { orderBy: { version: "desc" } },
      policyLinks: { where: { policy: visiblePolicyWhere(ctx) }, include: { policy: { select: { id: true, ref: true, title: true, kind: true } } } },
      auditQuestions: { include: { question: { include: { template: { select: { title: true, organisationId: true } } } } } },
      trainingLinks: { include: { training: true } },
    },
  });
  if (!r) notFound();
  const questions = r.auditQuestions.filter((q) => q.question.template.organisationId === null || q.question.template.organisationId === ctx.organisationId);
  const training = r.trainingLinks.filter((t) => t.training.organisationId === null || t.training.organisationId === ctx.organisationId);
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{r.ref} {r.title} <SimulatedBadge show={r.isSimulated} /></span>} subtitle={`${r.exactReference} · ${r.source.name}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Requirement">
            <blockquote className="prose-policy rounded bg-slate-50 p-3 text-sm">{r.excerpt}</blockquote>
            {r.applicabilityNotes ? <p className="mt-3 text-sm">{r.applicabilityNotes}</p> : null}
            <p className="mt-3 text-xs"><a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">Read the official source</a></p>
          </Card>
          <Card title="Mapped policies">
            {r.policyLinks.length ? <ul className="space-y-1 text-sm">{r.policyLinks.map((l) => <li key={l.id}><Link href={`/policies/${l.policy.id}`}>{l.policy.ref} {l.policy.title}</Link> <span className="text-xs text-slate-500">({l.policy.kind === "MASTER" ? "template" : "ours"}; section {l.sectionKey ?? "all"})</span></li>)}</ul> : <Empty>No mapped policies visible to you.</Empty>}
          </Card>
          <Card title="Audit questions and training">
            {questions.length || training.length ? (
              <ul className="space-y-1 text-sm">
                {questions.map((q) => <li key={q.questionId}>Audit: {q.question.template.title}: {q.question.text}</li>)}
                {training.map((t) => <li key={t.trainingId}>Training: {t.training.title}</li>)}
              </ul>
            ) : <Empty>None mapped.</Empty>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Status">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Verification"><StatusBadge status={r.verificationStatus === "VERIFIED" ? "VERIFIED_REQ" : r.verificationStatus} /></Field>
              <Field label="Legal status">{r.legalStatus.replace(/_/g, " ").toLowerCase()}</Field>
              <Field label="Jurisdiction">{r.jurisdiction === "ENG" ? "England" : r.jurisdiction}</Field>
              <Field label="Service types">{r.serviceTypes.join(", ") || "All"}</Field>
              <Field label="Effective date">{r.effectiveDate ? `${fmtDate(r.effectiveDate)}${r.effectiveDateVerified ? "" : " (unverified)"}` : "Not recorded"}</Field>
              <Field label="Last verified">{fmtDate(r.lastVerifiedAt)}</Field>
              <Field label="Review status">{r.reviewStatus.toLowerCase()}</Field>
              <Field label="Version">{r.version}</Field>
            </div>
          </Card>
          <Card title="History">
            {r.versions.length ? <ul className="space-y-1 text-xs">{r.versions.map((v) => <li key={v.id}>v{v.version} · {fmtDate(v.createdAt)} · {v.reason}</li>)}</ul> : <Empty>No earlier versions.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
