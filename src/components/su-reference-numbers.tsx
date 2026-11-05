import Link from "@/components/link";
import { COMMON_ISSUERS, COMMON_SYSTEMS, REFERENCE_TYPES, REFERENCE_TYPE_HELP, REFERENCE_TYPE_LABEL, isPersonSpecific, referenceTitle, type ReferenceType } from "@/lib/reference-numbers";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { referenceNumbersTab, type NhsCheck, type SourceDoc } from "@/server/care/reference-numbers";
import { addReferenceAction, supersedeReferenceAction, verifyReferenceAction } from "@/app/reference-actions";
import { Badge, Card, Empty, fmtDate } from "@/components/ui";

type Tab = Awaited<ReturnType<typeof referenceNumbersTab>>;
type Row = Tab["rows"][number];

const STATE: Record<Row["state"], { label: string; tone: "amber" | "green" | "rose" | "slate" }> = {
  AWAITING: { label: "Awaiting verification", tone: "amber" },
  VERIFIED: { label: "Verified", tone: "green" },
  REJECTED: { label: "Rejected", tone: "rose" },
  SUPERSEDED: { label: "Superseded", tone: "slate" },
};

const HISTORY_LABEL: Record<string, string> = {
  "serviceUser.externalReference.added": "Reference added",
  "serviceUser.externalReference.verified": "Verification decision",
  "serviceUser.externalReference.superseded": "Reference superseded",
  "serviceUser.externalReference.reinstated": "Reference put back into use",
};

const NHS_TEXT: Record<NhsCheck, { text: string; tone: "green" | "amber" | "rose" | "slate" | null }> = {
  MATCH: { text: "The NHS number in the register matches Personal details.", tone: "green" },
  DIFFERS: { text: "The register holds a different NHS number from Personal details. Check the source documents, then correct or withdraw the wrong one.", tone: "rose" },
  REGISTER_ONLY: { text: "An NHS number is in the register but not in Personal details. Personal details is the record carers' paperwork uses: add it there once verified.", tone: "amber" },
  PROFILE_ONLY: { text: "Recorded in Personal details only. Nothing to reconcile.", tone: null },
  NONE: { text: "No NHS number is recorded.", tone: null },
  RESTRICTED: { text: "Restricted. Your role cannot view NHS numbers.", tone: null },
};

function sourceLink(base: string, s: SourceDoc | null, canIntake: boolean) {
  if (!s) return <span className="text-slate-500">Not recorded (entered by hand)</span>;
  if (s.kind === "missing") return <span className="text-slate-500">Document no longer available</span>;
  if (s.restricted) return <span className="text-slate-600">{s.name} <Badge tone="violet">Restricted</Badge></span>;
  if (s.kind === "document") return <Link href={`${base}?tab=documents&section=${s.section === "COUNCIL" ? "council" : "other"}&doc=${s.id}`}>{s.name}</Link>;
  return canIntake ? <Link href={`/rota/coordinator/${s.intakeId}`}>{s.name} (Care Coordinator intake)</Link> : <span>{s.name}</span>;
}

/** Service User → Reference Numbers: the permanent CSB reference and every external reference, with source and history. */
export async function ServiceUserReferenceNumbers({ ctx, serviceUserId, base }: { ctx: Ctx; serviceUserId: string; base: string }) {
  const t = await referenceNumbersTab(ctx, serviceUserId);
  const canEdit = hasOrgPermission(ctx, "serviceUser.edit");
  const sensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const canVerify = canEdit && sensitive;
  const canIntake = hasOrgPermission(ctx, "serviceUser.documents");
  const back = `${base}?tab=references`;
  const current = t.rows.filter((r) => r.status === "ACTIVE");
  const superseded = t.rows.filter((r) => r.status === "SUPERSEDED");
  const types = REFERENCE_TYPES.filter((x) => x !== "NHS" || sensitive);

  return (
    <div className="space-y-3" data-testid="reference-numbers">
      <section aria-labelledby="csb-ref-h" className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="csb-ref-h" className="text-[13px] font-medium uppercase tracking-wide text-slate-500">Permanent CSB reference</h2>
          <p className="mt-1 font-mono text-[28px] font-semibold leading-tight text-[#1d2939]" data-testid="csb-reference">{t.csbReference ?? "Not yet assigned"}</p>
          <p className="text-[13px] text-slate-600">{t.csbReference ? "Automatically assigned · Read-only · Never reused" : "A number is assigned automatically. Ask an administrator if this record has none."}</p>
        </div>
        <dl className="grid min-w-[220px] gap-2 text-[13.5px]">
          {t.legacyReference ? (
            <div><dt className="text-slate-500">Legacy reference</dt><dd className="font-mono" data-testid="legacy-reference">{t.legacyReference}</dd></div>
          ) : null}
          <div><dt className="text-slate-500">Search</dt><dd>Find this person by any number on this page in <Link href="/rota/service-users">Service Users</Link> or the rostering search.</dd></div>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <Card title="External references" actions={canEdit ? <a href="#add-reference" className="btn-secondary py-1">Add reference</a> : null}>
            {current.length ? (
              <ul className="divide-y divide-slate-100" aria-label="External references">
                {current.map((r) => <ReferenceRow key={r.id} r={r} base={base} back={back} canEdit={canEdit && (r.type !== "NHS" || sensitive)} canVerify={canVerify} canIntake={canIntake} />)}
              </ul>
            ) : <Empty>No council, NHS or other external references are recorded yet.</Empty>}
            {superseded.length ? (
              <details className="mt-3 border-t border-slate-200 pt-3">
                <summary className="cursor-pointer text-[14px] font-medium text-[#1d4f91]">Superseded references ({superseded.length})</summary>
                <ul className="mt-2 divide-y divide-slate-100" aria-label="Superseded references">
                  {superseded.map((r) => (
                    <li key={r.id} className="py-2 text-[13.5px] text-slate-600">
                      <span className="font-medium text-slate-700">{referenceTitle(r)}</span> <span className="font-mono line-through">{r.value ?? "Restricted"}</span> <Badge>Superseded</Badge>
                      <span className="block">{r.supersededBy ?? "Unknown"} · {fmtDate(r.supersededAt, true)}{r.supersedeReason ? ` · ${r.supersedeReason}` : ""}{r.replacedById ? " · replaced by a corrected number" : " · withdrawn"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          {t.proposals.length ? (
            <Card title="Possible references in older records">
              <p className="mb-2 text-[13.5px] text-slate-600">These Frameworki numbers are written in this person&apos;s existing record text. They have not been moved or changed. Add one only after checking what it identifies.</p>
              <ul className="space-y-3">
                {t.proposals.map((p) => (
                  <li key={p.value} className="rounded-md border border-slate-200 p-3">
                    <div className="text-[14px]"><span className="font-mono font-semibold">{p.value}</span> <span className="text-slate-600">found in {p.where.toLowerCase()}</span> {p.clear ? null : <Badge tone="amber">Type to confirm</Badge>}</div>
                    <p className="mt-1 text-[13px] italic text-slate-600">“{p.quote}”</p>
                    <form action={addReferenceAction} className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="serviceUserId" value={serviceUserId} />
                      <input type="hidden" name="value" value={p.value} />
                      <input type="hidden" name="systemLabel" value="Frameworki" />
                      <input type="hidden" name="sourceQuote" value={p.quote} />
                      <input type="hidden" name="verificationNote" value={`Found in ${p.where.toLowerCase()} of the existing record`} />
                      <label><span className="label">What it identifies</span>
                        <select name="type" required defaultValue={p.clear ? p.type : ""} className="input"><option value="">Choose…</option>{(["COUNCIL_CLIENT", "COUNCIL_PACKAGE", "COUNCIL_FRAMEWORK"] as const).map((x) => <option key={x} value={x}>{REFERENCE_TYPE_LABEL[x]}</option>)}</select>
                      </label>
                      <label><span className="label">Issuing organisation</span><input name="issuer" required defaultValue={t.defaults.issuer} className="input" /></label>
                      <button className="btn-secondary">Add for verification</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-3">
          <Card title="Care package references">
            {t.packages.length ? (
              <ul className="space-y-2 text-[14px]" data-testid="package-references">
                {t.packages.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">{p.reference}</span>
                    <span className="text-[12.5px] text-slate-600">{p.status === "ACTIVE" ? <Badge tone="green">Active</Badge> : <Badge>{p.status.toLowerCase()}</Badge>} from {fmtDate(p.startDate)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[14px] text-slate-600">No package reference recorded.</p>}
            <p className="mt-2 text-[12.5px] text-slate-500">Managed in <Link href={`${base}?tab=package`}>Care → Care package</Link>. Kept separate from the CSB reference and council numbers.</p>
          </Card>

          <Card title="NHS number">
            <p className="text-[14px]" data-testid="nhs-check">{NHS_TEXT[t.nhs].tone ? <Badge tone={NHS_TEXT[t.nhs].tone!}>{t.nhs === "MATCH" ? "Matches" : t.nhs === "DIFFERS" ? "Discrepancy" : "Check"}</Badge> : null} {NHS_TEXT[t.nhs].text}</p>
            <p className="mt-2 text-[12.5px] text-slate-500">The NHS number in Personal details is the authoritative value. Only registered managers can see or add NHS numbers.</p>
          </Card>

          {canEdit ? (
            <Card title="Add a reference">
              <form id="add-reference" action={addReferenceAction} className="grid gap-2.5">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="serviceUserId" value={serviceUserId} />
                <label><span className="label">Reference type</span>
                  <select name="type" required defaultValue="" className="input" aria-describedby="ref-type-help">
                    <option value="">Choose…</option>
                    {types.map((x) => <option key={x} value={x}>{REFERENCE_TYPE_LABEL[x]}</option>)}
                  </select>
                </label>
                <ul id="ref-type-help" className="space-y-0.5 text-[12px] text-slate-500">
                  {types.map((x: ReferenceType) => <li key={x}><span className="font-medium text-slate-600">{REFERENCE_TYPE_LABEL[x]}:</span> {REFERENCE_TYPE_HELP[x]}</li>)}
                </ul>
                <label><span className="label">Issuing organisation</span><input name="issuer" required minLength={2} maxLength={180} list="ref-issuers" className="input" placeholder={t.defaults.issuer} /></label>
                <datalist id="ref-issuers">{COMMON_ISSUERS.map((x) => <option key={x} value={x} />)}</datalist>
                <label><span className="label">System or label (optional)</span><input name="systemLabel" maxLength={80} list="ref-systems" className="input" placeholder={`e.g. ${t.defaults.system}`} /></label>
                <datalist id="ref-systems">{COMMON_SYSTEMS.map((x) => <option key={x} value={x} />)}</datalist>
                <label><span className="label">Reference number</span><input name="value" required maxLength={120} autoComplete="off" className="input font-mono" /></label>
                <p className="-mt-1 text-[12px] text-slate-500">Type it exactly as printed. Leading zeroes are kept.</p>
                <div className="grid grid-cols-[1fr_88px] gap-2">
                  <label><span className="label">Source document (optional)</span>
                    <select name="sourceDocumentId" defaultValue="" className="input"><option value="">None</option>{t.documents.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
                  </label>
                  <label><span className="label">Page</span><input name="sourcePage" type="number" min={1} max={2000} className="input" /></label>
                </div>
                <label><span className="label">Verification note</span><textarea name="verificationNote" rows={2} maxLength={500} className="input" placeholder="Where you saw it, and anything a manager should check" /></label>
                <button className="btn-primary justify-self-start">Add reference</button>
                <p className="text-[12px] text-slate-500">Saved as awaiting verification. A manager verifies it separately against the source.</p>
              </form>
            </Card>
          ) : null}

          <Card title="Reference history">
            {t.history.length ? (
              <ol className="space-y-2 text-[13.5px]" data-testid="reference-history">
                {t.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}{h.action.endsWith(".verified") ? `: ${h.verified ? "verified" : "rejected"}` : ""}{h.type ? <span className="font-normal text-slate-600"> · {h.systemLabel ?? REFERENCE_TYPE_LABEL[h.type as ReferenceType] ?? h.type}</span> : null}</div>
                    {h.reason ? <div className="text-[13px] text-slate-600">{h.reason}</div> : null}
                    <div className="text-[12.5px] text-slate-500">{h.actor} · {fmtDate(h.at, true)}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-[14px] text-slate-600">No reference changes recorded yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReferenceRow({ r, base, back, canEdit, canVerify, canIntake }: { r: Row; base: string; back: string; canEdit: boolean; canVerify: boolean; canIntake: boolean }) {
  const st = STATE[r.state];
  const restricted = r.value === null;
  return (
    <li className="py-3" data-testid="reference-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#1d2939]">{referenceTitle(r)}</h3>
          <p className="font-mono text-[20px] font-semibold leading-snug" data-testid="reference-value">{restricted ? <span className="font-sans text-[15px] font-normal text-slate-500">Restricted</span> : r.value}</p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-2">
        <div><dt className="inline text-slate-500">Type: </dt><dd className="inline">{REFERENCE_TYPE_LABEL[r.type]}{isPersonSpecific(r.type) ? "" : " (shared, not proof of identity)"}</dd></div>
        <div><dt className="inline text-slate-500">Issued by: </dt><dd className="inline">{r.issuer}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-slate-500">Source: </dt><dd className="inline">{sourceLink(base, r.source, canIntake)}{r.sourcePage ? ` · Page ${r.sourcePage}` : ""}</dd></div>
        <div><dt className="inline text-slate-500">Added: </dt><dd className="inline">{r.addedBy} · {fmtDate(r.createdAt)}</dd></div>
        <div><dt className="inline text-slate-500">{r.state === "REJECTED" ? "Rejected" : "Verified"}: </dt><dd className="inline">{r.verifiedAt ? `${r.verifiedBy} · ${fmtDate(r.verifiedAt)}` : "Not yet"}</dd></div>
      </dl>
      {r.sourceQuote ? <p className="mt-1 text-[13px] italic text-slate-600">Source wording: “{r.sourceQuote}”</p> : null}
      {r.verificationNote ? <p className="mt-1 text-[13px] text-slate-600">Note: {r.verificationNote}</p> : null}
      {canEdit || canVerify ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {canVerify ? (
            <details className="w-full sm:w-auto">
              <summary className="btn-secondary inline-flex cursor-pointer py-1 text-[13px]">{r.state === "AWAITING" ? "Verify" : "Change verification"}</summary>
              <form action={verifyReferenceAction} className="mt-2 grid gap-2 rounded-md border border-slate-200 p-3 sm:w-[420px]">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="referenceId" value={r.id} />
                <p className="text-[12.5px] text-slate-600">Open the source document and compare the number before deciding.</p>
                <fieldset className="flex gap-4 text-[14px]">
                  <legend className="sr-only">Decision</legend>
                  <label className="flex items-center gap-1.5"><input type="radio" name="decision" value="VERIFIED" required /> Matches the source</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="decision" value="REJECTED" /> Does not match</label>
                </fieldset>
                <label><span className="label">Reason</span><textarea name="reason" required minLength={3} maxLength={500} rows={2} className="input" placeholder="e.g. Checked against support plan page 2" /></label>
                <button className="btn-primary justify-self-start py-1">Save decision</button>
              </form>
            </details>
          ) : null}
          {canEdit ? (
            <details className="w-full sm:w-auto">
              <summary className="btn-secondary inline-flex cursor-pointer py-1 text-[13px]">Correct or withdraw</summary>
              <form action={supersedeReferenceAction} className="mt-2 grid gap-2 rounded-md border border-slate-200 p-3 sm:w-[420px]">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="referenceId" value={r.id} />
                <p className="text-[12.5px] text-slate-600">The current entry is kept as superseded with its history. Nothing is overwritten.</p>
                <label><span className="label">Corrected number (leave blank to withdraw)</span><input name="value" maxLength={120} autoComplete="off" className="input font-mono" /></label>
                <label><span className="label">Reason</span><textarea name="reason" required minLength={3} maxLength={500} rows={2} className="input" /></label>
                <button className="btn-secondary justify-self-start py-1">Save correction</button>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
