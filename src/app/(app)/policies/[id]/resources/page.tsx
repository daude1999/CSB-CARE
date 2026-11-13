import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ActionDialog } from "@/components/dialog";
import { Empty, Flash, fmtDate } from "@/components/ui";
import { PcBadge } from "@/components/compliance-ui";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { resourceLinkAdmin } from "@/server/forms/links";
import { addResourceLinkAction, withdrawResourceLinkAction } from "../../../../actions";

export const dynamic = "force-dynamic";

const ORIGIN: Record<string, string> = {
  BACKFILL_RELATED_TEXT: "From the form's Related policies",
  TEMPLATE: "Copied from the CSB template",
  MANUAL: "Added by hand",
};

/**
 * The forms, templates, checklists and tools linked to one policy, and where in its procedure each is used. Authors of
 * the organisation's own policies add and remove links here; everyone who can read the policy sees the list and its
 * history. Removing a link keeps it in the history.
 */
export default async function PolicyResourceLinksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const data = await orNotFound(resourceLinkAdmin(ctx, id));
  const { policy, canManage, placements, active, withdrawn, choices, names } = data;
  const back = `/policies/${policy.id}`;
  const here = `${back}/resources`;
  const placeLabel = (p: { step: number | null; heading: string } | null, key: string | null) =>
    p ? (p.step ? `Step ${p.step}: ${p.heading}` : p.heading) : key ? "A step no longer in this version" : "Whole policy";

  return (
    <>
      <CompliancePageHeader
        back={back}
        crumbs={[{ label: "Policy & Compliance", href: "/" }, { label: "Policy Library", href: policy.kind === "MASTER" ? "/policies?tab=templates" : "/policies" }, { label: `${policy.ref} ${policy.title}`, href: back }]}
        title="Linked forms"
        subtitle="The forms and resources staff use with this policy, and the procedure step each one belongs to. They appear in the Policy Reader's Forms & Resources section and inside the step."
        actions={<Link className="btn-secondary" href={`${back}#forms`}>Back to the policy</Link>}
      />
      <Flash searchParams={sp} />

      <section className="pc-panel mb-4 overflow-hidden" aria-labelledby="links-title" data-testid="active-links">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="links-title" className="font-semibold">Linked now</h2>
          <span className="text-meta text-slate-600">{active.length} {active.length === 1 ? "link" : "links"}</span>
        </div>
        {active.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-meta">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Form or resource</th>
                  <th scope="col" className="px-4 py-3">Where it is used</th>
                  <th scope="col" className="px-4 py-3">Added</th>
                  {canManage ? <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {active.map((l) => (
                  <tr key={l.id} className="align-top" data-testid={`link-${l.resource.ref}`}>
                    <td className="px-4 py-3">
                      <Link href={`/policies/${l.resource.id}`} className="font-semibold">{l.resource.ref} · {l.resource.title}</Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {l.required ? <PcBadge tone="red">Required</PcBadge> : null}
                        {!l.resource.currentPublishedVersionId || l.resource.status !== "ACTIVE" ? <PcBadge tone="amber">Not published, so staff do not see it yet</PcBadge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{placeLabel(l.place, l.sectionKey)}</div>
                      {l.useWhen ? <div className="mt-0.5 text-slate-600">Use when {l.useWhen}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      <div>{fmtDate(l.createdAt)}{l.createdById ? ` · ${names.get(l.createdById) ?? "Unknown"}` : ""}</div>
                      <div>{ORIGIN[l.origin] ?? l.origin}</div>
                    </td>
                    {canManage ? (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <ActionDialog trigger="Remove" triggerClassName="pc-btn-secondary pc-btn-sm" title={`Remove ${l.resource.ref} from this policy?`} description="Staff will no longer see this form with the policy. The link stays in the history below.">
                          <form action={withdrawResourceLinkAction} className="space-y-3">
                            <input type="hidden" name="linkId" value={l.id} />
                            <input type="hidden" name="back" value={here} />
                            <label className="block"><span className="label">Reason</span><textarea name="reason" required minLength={5} maxLength={500} rows={3} className="input" /></label>
                            <button type="submit" className="btn-primary">Remove link</button>
                          </form>
                        </ActionDialog>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><Empty>No forms are linked to this policy yet.</Empty></div>}
      </section>

      {canManage ? (
        <section className="pc-panel mb-4 p-4" aria-labelledby="add-title" data-testid="add-link">
          <h2 id="add-title" className="font-semibold">Link a form</h2>
          <p className="mt-1 text-meta text-slate-600">Choose one of your organisation&rsquo;s forms, templates, checklists or tools. Place it at the procedure step where staff need it, or leave it on the whole policy.</p>
          {choices.length ? (
            <form action={addResourceLinkAction} className="mt-3 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="policyId" value={policy.id} />
              <input type="hidden" name="back" value={here} />
              <label className="block"><span className="label">Form or resource</span>
                <select name="resourceId" required className="input" defaultValue="">
                  <option value="" disabled>Choose a form</option>
                  {choices.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.title} ({c.typeLabel})</option>)}
                </select>
              </label>
              <label className="block"><span className="label">Where it is used</span>
                <select name="sectionKey" className="input" defaultValue="">
                  <option value="">Whole policy</option>
                  {placements.map((p) => <option key={p.sectionKey} value={p.sectionKey}>Step {p.step}: {p.heading}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2"><span className="label">Use when (optional)</span>
                <input name="useWhen" maxLength={300} className="input" placeholder="for example: you notice a new mark or bruise" />
              </label>
              <label className="flex items-center gap-2 text-body"><input type="checkbox" name="required" className="h-4 w-4" />Staff must complete this form at this step</label>
              <div className="md:text-right"><button type="submit" className="btn-primary">Link form</button></div>
            </form>
          ) : <p className="mt-3 text-meta text-slate-600">Your library has no forms or resources yet. Adopt them from the CSB templates first.</p>}
        </section>
      ) : null}

      <section className="pc-panel overflow-hidden" aria-labelledby="history-title" data-testid="link-history">
        <h2 id="history-title" className="border-b border-slate-200 px-4 py-3 font-semibold">Removed links</h2>
        {withdrawn.length ? (
          <ul className="divide-y divide-slate-100 text-meta">
            {withdrawn.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <span className="font-medium">{l.resource.ref} · {l.resource.title}</span>
                <span className="text-slate-600"> · removed {fmtDate(l.withdrawnAt)}{l.withdrawnById ? ` by ${names.get(l.withdrawnById) ?? "Unknown"}` : ""}</span>
                {l.withdrawReason ? <span className="block text-slate-600">Reason: {l.withdrawReason}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-4 text-meta text-slate-600">No links have been removed.</p>}
      </section>
    </>
  );
}
