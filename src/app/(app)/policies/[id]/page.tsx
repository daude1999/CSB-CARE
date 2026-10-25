import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { canOnPolicy, hasOrgPermission } from "@/server/auth/rbac";
import { getPolicy } from "@/server/policies/library";
import { newRevisionAction, rollbackAction, confirmImplementationAction } from "../../../actions";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const p = await orNotFound(getPolicy(ctx, id));
  const v = p.currentPublishedVersion;
  const canAuthor = canOnPolicy(ctx, p, "author");
  const back = `/policies/${p.id}`;
  // Organisation policies inherit requirement mappings from the template they were adopted from.
  const inherited = !p.requirementLinks.length && p.templateId;
  const links = inherited ? await db.requirementPolicyLink.findMany({ where: { policyId: p.templateId! }, include: { requirement: true } }) : p.requirementLinks;
  links.sort((a, b) => a.requirement.ref.localeCompare(b.requirement.ref));
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{p.title} <Badge tone={p.kind === "MASTER" ? "navy" : "teal"}>{p.kind === "MASTER" ? "Evantix template" : "Organisation policy"}</Badge></span>}
        subtitle={p.description}
        actions={
          canAuthor ? (
            <form action={newRevisionAction} className="flex gap-2">
              <input type="hidden" name="policyId" value={p.id} />
              <input type="hidden" name="back" value={back} />
              <input className="input w-64" name="reason" placeholder="Reason for revision" required aria-label="Reason for revision" />
              <button className="btn-primary" type="submit">Start revision</button>
            </form>
          ) : null
        }
      />
      <Flash searchParams={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={v ? `Current version ${v.label}` : "No published version"}>
            {v ? (
              <>
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  <Badge tone="green">published {fmtDate(v.publishedAt)}</Badge>
                  <Badge>effective {fmtDate(v.effectiveDate)}</Badge>
                  {v.origin === "SEED" ? <Badge tone="amber">Seeded starter content: not professionally reviewed, no approval record</Badge> : null}
                  <SimulatedBadge show={v.isSimulated} />
                </div>
                <div className="space-y-5">
                  {v.sections.map((s) => (
                    <section key={s.key} id={s.key}>
                      <h3 className="flex items-center gap-2">{s.heading}{s.isLocal ? <Badge tone="teal">local</Badge> : null}</h3>
                      <p className="prose-policy mt-1">{s.body}</p>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <Empty>This policy has not been published yet. See open revisions.</Empty>
            )}
          </Card>
          <Card title="Version history">
            <p className="muted mb-2">Approved and published versions are never overwritten. Restoring an earlier version creates a new draft that must be approved.</p>
            <table className="table">
              <thead><tr><th>Version</th><th>Status</th><th>Origin</th><th>Summary</th><th>Approvals</th><th>Published</th><th /></tr></thead>
              <tbody>
                {p.versions.map((ver) => (
                  <tr key={ver.id}>
                    <td><Link href={`/policies/${p.id}/versions/${ver.id}`}>{ver.label}</Link></td>
                    <td><StatusBadge status={ver.status} /></td>
                    <td className="text-xs">{ver.origin.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="max-w-xs text-xs">{ver.changeSummary ?? ver.reasonForChange ?? "—"}</td>
                    <td className="text-xs">{ver.approvals.filter((a) => a.decision === "APPROVE").length || (ver.origin === "SEED" ? "none (seed)" : "—")}</td>
                    <td className="text-xs">{fmtDate(ver.publishedAt)}</td>
                    <td>
                      {ver.revisionAsDraft && !["PUBLISHED", "SUPERSEDED", "ARCHIVED"].includes(ver.status) ? <Link href={`/revisions/${ver.revisionAsDraft.id}`}>Open draft</Link> : null}
                      {canAuthor && ["SUPERSEDED"].includes(ver.status) ? (
                        <form action={rollbackAction} className="flex gap-1">
                          <input type="hidden" name="policyId" value={p.id} />
                          <input type="hidden" name="versionId" value={ver.id} />
                          <input type="hidden" name="back" value={back} />
                          <input className="input py-1 text-xs" name="reason" placeholder="Reason" required aria-label="Rollback reason" />
                          <button className="btn-secondary py-1 text-xs" type="submit">Restore</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reference"><span className="font-mono">{p.ref}</span></Field>
              <Field label="Category">{p.category.name}</Field>
              <Field label="Jurisdiction">{p.jurisdiction === "ENG" ? "England" : p.jurisdiction}</Field>
              <Field label="Service types">{p.serviceTypes.join(", ") || "All"}</Field>
              <Field label="Next review">{fmtDate(p.nextReviewDate)}</Field>
              <Field label="Review interval">{p.reviewIntervalMonths} months</Field>
              {p.template ? <Field label="Based on template"><Link href={`/policies/${p.template.id}`}>{p.template.ref}</Link></Field> : null}
            </div>
          </Card>
          <Card title="Linked requirements">
            {links.length ? (
              <>
                {inherited ? <p className="muted mb-2 text-xs">Inherited from the Evantix template {p.template?.ref}.</p> : null}
                <ul className="space-y-2 text-sm">
                  {links.map((l) => (
                    <li key={l.id}>
                      <Link href={`/requirements/${l.requirementId}`}>{l.requirement.ref}</Link> {l.requirement.exactReference}
                      <div className="text-xs text-slate-500">section: {l.sectionKey ? <a href={`#${l.sectionKey}`}>{l.sectionKey}</a> : "whole policy"} · <StatusBadge status={l.requirement.verificationStatus === "VERIFIED" ? "VERIFIED_REQ" : l.requirement.verificationStatus} /></div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty>No requirements mapped.</Empty>
            )}
          </Card>
          <Card title="Flagged by regulatory changes">
            {p.candidates.length ? (
              <ul className="space-y-2 text-sm">
                {p.candidates.map((c) => (
                  <li key={c.id}>
                    <Link href={`/changes/${c.changeId}`}>{c.change.title}</Link> <SimulatedBadge show={c.change.isSimulated} />
                    <div className="text-xs text-slate-500">{c.reason.replace(/_/g, " ").toLowerCase()}: {c.evidence.slice(0, 160)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not flagged by any detected change.</Empty>
            )}
          </Card>
          <Card title="Publications">
            {p.publications.length ? (
              <ul className="space-y-3 text-sm">
                {p.publications.map((pub) => {
                  const done = pub.acknowledgements.filter((a) => a.acknowledgedAt).length;
                  return (
                    <li key={pub.id}>
                      <div className="flex items-center gap-2"><StatusBadge status={pub.status} /> {fmtDate(pub.publishedAt ?? pub.scheduledFor)}</div>
                      {pub.requiresAcknowledgement ? <div className="text-xs text-slate-500">Acknowledged by {done} of {pub.acknowledgements.length}</div> : null}
                      {pub.implementationConfirmedAt ? (
                        <div className="text-xs text-emerald-700">Implementation confirmed {fmtDate(pub.implementationConfirmedAt)}: {pub.implementationNotes}</div>
                      ) : pub.status === "PUBLISHED" && pub.organisationId && hasOrgPermission(ctx, "implementation.confirm") ? (
                        <form action={confirmImplementationAction} className="mt-1 flex gap-1">
                          <input type="hidden" name="publicationId" value={pub.id} />
                          <input type="hidden" name="back" value={back} />
                          <input className="input py-1 text-xs" name="notes" placeholder="How was it implemented?" required aria-label="Implementation notes" />
                          <button className="btn-secondary py-1 text-xs">Confirm implemented</button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>Not yet published.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
