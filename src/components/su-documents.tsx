import type { ServiceUserDocumentSection } from "@prisma/client";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { memberNames } from "@/server/rota/queries";
import { ACCEPT_DOCUMENTS, DOCUMENT_SECTIONS, MAX_DOCUMENT_BYTES, REQUIRED_COUNCIL_CATEGORIES, categoriesFor, categoryLabel, getDocument, listDocuments, previewable, type DocumentRow } from "@/server/care/su-documents";
import { archiveSuDocumentAction, decideSuDocumentVersionAction, replaceSuDocumentAction, updateSuDocumentAction, uploadSuDocumentAction } from "@/app/su-record-actions";
import { PrivateFileInput } from "@/components/private-file-input";
import { Badge, Empty, fmtDate } from "@/components/ui";
import { compareWithPrevious, documentHistory, versionInForce, VERSION_STATUS, type VersionStatus } from "@/server/care/document-versions";

const VERSION_TONE: Record<VersionStatus, "teal" | "amber" | "slate" | "rose"> = { CURRENT: "teal", PENDING_REVIEW: "amber", SUPERSEDED: "slate", WITHDRAWN: "rose", REJECTED: "rose" };

const SECTION_PARAM: Record<ServiceUserDocumentSection, string> = { COUNCIL: "council", OTHER: "other" };

const HISTORY_LABEL: Record<string, string> = {
  "suDocument.uploaded": "Uploaded",
  "suDocument.replaced": "Replaced with a new version",
  "suDocument.updated": "Details changed",
  "suDocument.archived": "Moved to historical documents",
  "suDocument.restored": "Restored",
  "suDocument.previewed": "Previewed",
  "suDocument.downloaded": "Downloaded",
};

const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const fileUrl = (id: string, opts: { v?: number; preview?: boolean } = {}) => `/api/service-users/documents/${id}?${new URLSearchParams({ ...(opts.v ? { v: String(opts.v) } : {}), ...(opts.preview ? { mode: "preview" } : {}) })}`;

function DetailFields({ section, doc, canSensitive }: { section: ServiceUserDocumentSection; doc?: { name: string; category: string; issuingAuthority: string | null; receivedOn: Date | null; effectiveFrom: Date | null; expiresOn: Date | null; notes: string | null; sensitive: boolean }; canSensitive: boolean }) {
  const cats = categoriesFor(section);
  return (
    <>
      <label className="md:col-span-2"><span className="label">Document name</span><input name="name" required minLength={2} maxLength={160} defaultValue={doc?.name} className="input" placeholder={section === "COUNCIL" ? "e.g. Support plan from adult social care" : "e.g. Signed consent to share information"} /></label>
      <label><span className="label">Category</span><select name="category" required defaultValue={doc?.category ?? ""} className="input"><option value="">Choose…</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}{c.sensitive ? " (restricted)" : ""}</option>)}</select></label>
      <label><span className="label">{section === "COUNCIL" ? "Council or issuing authority" : "Issued by (optional)"}</span><input name="issuingAuthority" maxLength={160} defaultValue={doc?.issuingAuthority ?? ""} className="input" /></label>
      <label><span className="label">Date received</span><input type="date" name="receivedOn" defaultValue={isoDay(doc?.receivedOn)} className="input" /></label>
      <label><span className="label">Effective from (if applicable)</span><input type="date" name="effectiveFrom" defaultValue={isoDay(doc?.effectiveFrom)} className="input" /></label>
      <label><span className="label">Expires (if applicable)</span><input type="date" name="expiresOn" defaultValue={isoDay(doc?.expiresOn)} className="input" /></label>
      <label className="flex items-center gap-2 pt-6 text-[14px]">
        <input type="checkbox" name="markSensitive" defaultChecked={doc?.sensitive} disabled={!canSensitive} className="h-4 w-4" /> Restrict to managers
        {!canSensitive ? <span className="text-[12.5px] text-slate-500">(managers only)</span> : null}
      </label>
      <label className="md:col-span-2"><span className="label">Notes</span><textarea name="notes" rows={2} maxLength={4000} defaultValue={doc?.notes ?? ""} className="input" /></label>
    </>
  );
}

function StatusBadges({ d }: { d: Pick<DocumentRow, "archivedAt" | "expired" | "sensitive" | "expiresOn"> }) {
  return (
    <>
      {d.archivedAt ? <Badge>Historical</Badge> : d.expired ? <Badge tone="rose">Expired</Badge> : d.expiresOn ? <Badge tone="green">Current</Badge> : null}
      {d.sensitive ? <Badge tone="violet">Restricted</Badge> : null}
    </>
  );
}

/**
 * One document section (Council Documents or Other Documents) of a service user's profile: the upload form, the list
 * (current, then historical), and the selected document with its preview, versions and history. The two sections are
 * separate screens; only the storage and this component are shared.
 */
export async function ServiceUserDocuments({ ctx, serviceUserId, section, selectedId, base, inForce, compare }: { ctx: Ctx; serviceUserId: string; section: ServiceUserDocumentSection; selectedId?: string; base: string; inForce?: string; compare?: string }) {
  const canManage = hasOrgPermission(ctx, "serviceUser.documents");
  const canSensitive = hasOrgPermission(ctx, "serviceUser.sensitive");
  const rows = await listDocuments(ctx, serviceUserId, section);
  const here = `${base}?tab=documents&section=${SECTION_PARAM[section]}`;
  const current = rows.filter((r) => !r.archivedAt);
  const historical = rows.filter((r) => r.archivedAt);
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  let detail: Awaited<ReturnType<typeof getDocument>> | null = null;
  let detailError: string | null = null;
  if (selectedRow && !selectedRow.restricted) {
    try {
      detail = await getDocument(ctx, selectedRow.id);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      detailError = e.message;
    }
  }
  const versionHistory = detail ? await documentHistory(ctx, detail.doc.id) : null;
  const inForceDate = inForce && /^\d{4}-\d{2}-\d{2}$/.test(inForce) ? inForce : null;
  const inForceVersion = detail && inForceDate ? await versionInForce(ctx, detail.doc.id, inForceDate) : null;
  const compareN = compare && /^\d+$/.test(compare) ? Number(compare) : null;
  const comparison = detail && compareN && versionHistory?.versions.some((v) => v.version === compareN) ? await compareWithPrevious(ctx, detail.doc.id, compareN) : null;
  const names = await memberNames(ctx, [...rows.map((r) => r.latest?.uploadedById), ...(detail?.versions.map((v) => v.uploadedById) ?? []), ...(detail?.history.map((h) => h.actorId) ?? []), ...(versionHistory?.versions.flatMap((v) => [v.approvedById, ...v.history.map((x) => x.actorId)]) ?? [])]);
  const back = selectedRow ? `${here}&doc=${selectedRow.id}` : here;
  const required = section === "COUNCIL" ? REQUIRED_COUNCIL_CATEGORIES.map((k) => ({ key: k, label: categoryLabel("COUNCIL", k), held: current.some((r) => r.category === k) })) : [];

  return (
    <div className="space-y-3" data-testid={`documents-${SECTION_PARAM[section]}`}>
      <section className="card" aria-labelledby="docs-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="docs-h" className="text-[17px]">{DOCUMENT_SECTIONS[section]}</h2>
            <p className="mt-0.5 text-[13.5px] text-slate-600">
              {section === "COUNCIL" ? "Documents from the commissioning council or local authority." : "Consent, identification, medical letters and other supporting documents."}{" "}
              Files are private: they open only for signed-in staff allowed to see them, and every view is recorded.
            </p>
          </div>
          {canManage ? (
            <details className="w-full md:w-auto">
              <summary className="btn-primary cursor-pointer list-none">Upload Document</summary>
              <form action={uploadSuDocumentAction} className="mt-3 grid gap-2 rounded-[4px] border border-slate-200 bg-[#f8fafc] p-3 md:w-[620px] md:grid-cols-2">
                <input type="hidden" name="back" value={here} />
                <input type="hidden" name="serviceUserId" value={serviceUserId} />
                <input type="hidden" name="section" value={section} />
                <div className="md:col-span-2"><PrivateFileInput name="file" required accept={ACCEPT_DOCUMENTS} maxBytes={MAX_DOCUMENT_BYTES} label="File" hint="PDF, Word, or an image or scan (JPG, PNG, GIF, WebP, TIFF). Up to 4 MB." /></div>
                <DetailFields section={section} canSensitive={canSensitive} />
                <button className="btn-primary md:col-span-2">Upload</button>
                <p className="text-[12.5px] text-slate-500 md:col-span-2">Identity, medical and financial documents are restricted automatically: only the registered manager and administrators can open them.</p>
              </form>
            </details>
          ) : null}
        </div>
        {required.length ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]" data-testid="required-council-docs">
            <span className="font-medium">Required for every person:</span>
            {required.map((r) => <Badge key={r.key} tone={r.held ? "green" : "rose"}>{r.label}: {r.held ? "held" : "missing"}</Badge>)}
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="card" aria-label={`${DOCUMENT_SECTIONS[section]} list`}>
          {current.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-slate-600"><tr><th className="px-3 py-2">Document</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Received</th><th className="px-2 py-2">Expires</th><th className="px-2 py-2">Version</th><th className="px-2 py-2">Uploaded</th></tr></thead>
                <tbody>
                  {current.map((r) => (
                    <tr key={r.id} className={`border-t border-slate-100 ${r.id === selectedRow?.id ? "bg-[#eef4fb]" : ""}`}>
                      <td className="px-3 py-2"><Link href={`${here}&doc=${r.id}`} className="row-title" aria-current={r.id === selectedRow?.id ? "true" : undefined}>{r.name}</Link> <StatusBadges d={r} /></td>
                      <td className="px-2 py-2">{r.categoryLabel}</td>
                      <td className="whitespace-nowrap px-2 py-2">{fmtDate(r.receivedOn)}</td>
                      <td className={`whitespace-nowrap px-2 py-2 ${r.expired ? "font-medium text-[#a3242c]" : ""}`}>{fmtDate(r.expiresOn)}</td>
                      <td className="px-2 py-2">{r.restricted ? "—" : `v${r.currentVersion}`}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.latest ? <>{fmtDate(r.latest.uploadedAt)}<span className="block text-[12px]">{names.get(r.latest.uploadedById) ?? "Former member"}</span></> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No {DOCUMENT_SECTIONS[section].toLowerCase()} yet.{canManage ? " Use Upload Document to add the first one." : ""}</Empty>}
          {historical.length ? (
            <details className="mt-3 border-t border-slate-200 pt-2" open={selectedRow?.archivedAt ? true : undefined}>
              <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Historical documents ({historical.length})</summary>
              <ul className="rows mt-2">
                {historical.map((r) => (
                  <li key={r.id} className="py-2 text-[13.5px]"><Link href={`${here}&doc=${r.id}`} className="row-title">{r.name}</Link> <span className="text-slate-600">· {r.categoryLabel} · archived {fmtDate(r.archivedAt)}{r.archiveReason ? ` · ${r.archiveReason}` : ""}</span></li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <aside className="card" aria-label="Selected document" data-testid="document-detail">
          {!selectedRow ? (
            <Empty>Choose a document to preview it, see its versions and history{canManage ? ", or replace it" : ""}.</Empty>
          ) : selectedRow.restricted || detailError ? (
            <div className="px-1 py-4 text-[14px]">
              <h3 className="text-[16px] font-semibold">Restricted document</h3>
              <p className="mt-1 text-slate-600">{detailError ?? `This document (${selectedRow.categoryLabel}) is restricted. Only the registered manager and administrators can open it.`}</p>
            </div>
          ) : detail ? (
            <div className="space-y-4 text-[14px]">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-[16px] font-semibold">{detail.doc.name}</h3><StatusBadges d={selectedRow} /></div>
                <p className="text-slate-600">{detail.doc.categoryLabel}{detail.doc.issuingAuthority ? ` · ${detail.doc.issuingAuthority}` : ""}</p>
              </div>
              {(() => {
                // The version in force, never one still waiting for review.
                const v = detail.versions.find((x) => x.version === detail!.doc.currentVersion) ?? detail.versions[0];
                if (!v) return null;
                return (
                  <div>
                    {v.contentType.startsWith("image/") && previewable(v.contentType) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(detail.doc.id, { preview: true })} alt={`Preview of ${detail.doc.name}`} className="max-h-[360px] w-full rounded-[4px] border border-slate-200 object-contain" />
                    ) : (
                      <p className="rounded-[4px] border border-dashed border-slate-300 bg-[#f8fafc] px-3 py-4 text-center text-[13.5px] text-slate-600">{previewable(v.contentType) ? "PDF document. Preview opens in a new tab." : "Word and TIFF files cannot be shown in the browser. Download to open."}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {previewable(v.contentType) ? <a href={fileUrl(detail.doc.id, { preview: true })} target="_blank" rel="noopener" className="btn-secondary">Preview</a> : null}
                      <a href={fileUrl(detail.doc.id)} className="btn-secondary">Download</a>
                    </div>
                    <p className="mt-1 text-[12.5px] text-slate-500">{v.filename} · {fileSize(v.sizeBytes)} · version {v.version}</p>
                  </div>
                );
              })()}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt className="label">Date received</dt><dd>{fmtDate(detail.doc.receivedOn)}</dd></div>
                <div><dt className="label">Effective from</dt><dd>{fmtDate(detail.doc.effectiveFrom)}</dd></div>
                <div><dt className="label">Expires</dt><dd className={selectedRow.expired ? "font-medium text-[#a3242c]" : ""}>{fmtDate(detail.doc.expiresOn)}</dd></div>
                <div><dt className="label">First uploaded</dt><dd>{fmtDate(detail.doc.createdAt, true)}</dd></div>
                {detail.doc.notes ? <div className="col-span-2"><dt className="label">Notes</dt><dd className="whitespace-pre-line">{detail.doc.notes}</dd></div> : null}
                {detail.doc.archivedAt ? <div className="col-span-2"><dt className="label">Archived</dt><dd>{fmtDate(detail.doc.archivedAt, true)}{detail.doc.archiveReason ? `: ${detail.doc.archiveReason}` : ""}</dd></div> : null}
              </dl>

              {versionHistory ? (
                <div>
                  <h4 className="mb-1 text-[14px] font-semibold">Document history</h4>
                  <ul className="rows" data-testid="document-versions">
                    {versionHistory.versions.map((v) => (
                      <li key={v.id} className="py-2 text-[13.5px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{v.label}</span><Badge tone={VERSION_TONE[v.status]}>{VERSION_STATUS[v.status]}</Badge></span>
                          <span className="flex gap-3">{previewable(detail!.versions.find((x) => x.version === v.version)?.contentType ?? "") ? <a href={fileUrl(detail!.doc.id, { v: v.version, preview: true })} target="_blank" rel="noopener" className="text-[13px]">Preview</a> : null}<a href={fileUrl(detail!.doc.id, { v: v.version })} className="text-[13px]">Download</a>{v.version > 1 ? <Link href={`${back}&compare=${v.version}#compare`} className="text-[13px]">Compare previous version</Link> : null}</span>
                        </div>
                        <dl className="mt-1 grid grid-cols-2 gap-x-4 text-[12.5px] text-slate-600 sm:grid-cols-3">
                          <div><dt className="inline">On the document: </dt><dd className="inline">{v.documentDate ? fmtDate(v.documentDate) : "Not given"}</dd></div>
                          <div><dt className="inline">Received: </dt><dd className="inline">{v.receivedOn ? fmtDate(v.receivedOn) : "Not given"}</dd></div>
                          <div><dt className="inline">Uploaded: </dt><dd className="inline">{fmtDate(v.uploadedAt, true)} · {names.get(v.uploadedById) ?? "Former member"}</dd></div>
                          <div><dt className="inline">Effective from: </dt><dd className="inline">{v.effectiveFrom ? fmtDate(v.effectiveFrom) : "Not given"}</dd></div>
                          <div><dt className="inline">Approved: </dt><dd className="inline">{v.approvedAt ? `${fmtDate(v.approvedAt, true)}${v.approvedById ? ` · ${names.get(v.approvedById) ?? "Former member"}` : ""}` : "Not yet"}</dd></div>
                          {v.intakeId ? <div><dt className="inline">From: </dt><dd className="inline"><Link href={`/rota/coordinator/${v.intakeId}?step=facts`}>Care Coordinator intake</Link></dd></div> : null}
                        </dl>
                        {v.changeNote ? <p className="mt-1 text-[12.5px] text-slate-600">{v.changeNote}</p> : null}
                        {canManage && !detail!.doc.archivedAt && (v.status === "PENDING_REVIEW" || v.status === "CURRENT") ? (
                          <form action={decideSuDocumentVersionAction} className="mt-2 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="documentId" value={detail!.doc.id} />
                            <input type="hidden" name="version" value={v.version} />
                            <input name="note" className="input w-auto min-w-[220px] flex-1 py-1 text-[13px]" placeholder={v.status === "PENDING_REVIEW" ? "Note (required to reject)" : "Why it is withdrawn"} aria-label={`Note for ${v.label}`} />
                            {v.status === "PENDING_REVIEW" ? <><button name="decision" value="APPROVE" className="btn-primary py-1">Approve {v.label}</button><button name="decision" value="REJECT" className="btn-secondary py-1">Reject</button></> : null}
                            <button name="decision" value="WITHDRAW" className="btn-secondary py-1">Withdraw</button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <form method="get" className="mt-2 flex flex-wrap items-end gap-2" aria-label="Version in force on a date">
                    <input type="hidden" name="tab" value="documents" />
                    <input type="hidden" name="section" value={SECTION_PARAM[section]} />
                    <input type="hidden" name="doc" value={detail!.doc.id} />
                    <label><span className="label">Which version was in force on</span><input type="date" name="inforce" defaultValue={inForceDate ?? ""} className="input py-1" /></label>
                    <button className="btn-secondary py-1">Check</button>
                  </form>
                  {inForceDate ? <p className="mt-1 text-[13.5px]" role="status">{inForceVersion ? <>On {fmtDate(inForceVersion.effectiveFrom ?? inForceDate)}{" "}the version in force was <strong>{inForceVersion.label}</strong> ({VERSION_STATUS[inForceVersion.status].toLowerCase()} now).</> : <>No approved version was in force on {fmtDate(inForceDate)}.</>}</p> : null}
                  {comparison ? (
                    <div id="compare" className="mt-3 rounded-[4px] border border-slate-200 p-3">
                      <h5 className="text-[14px] font-semibold">{comparison.version.label} compared with {comparison.previous ? comparison.previous.label : "nothing (first version)"}</h5>
                      {comparison.fields.length ? (
                        <table className="mt-1 w-full text-left text-[13px]"><thead className="text-slate-500"><tr><th className="py-1 pr-2">Detail</th><th className="py-1 pr-2">{comparison.previous?.label}</th><th className="py-1">{comparison.version.label}</th></tr></thead>
                          <tbody>{comparison.fields.map((f) => <tr key={f.label} className={`border-t border-slate-200 ${f.changed ? "font-medium" : "text-slate-600"}`}><td className="py-1 pr-2">{f.label}{f.changed ? " (changed)" : ""}</td><td className="py-1 pr-2">{f.previous ?? "Not given"}</td><td className="py-1">{f.this ?? "Not given"}</td></tr>)}</tbody></table>
                      ) : null}
                      {comparison.version.intakeId ? <p className="mt-1 text-[13px]">The content was compared detail by detail in its <Link href={`/rota/coordinator/${comparison.version.intakeId}?step=facts`}>Care Coordinator intake</Link> (What the revised plan changes).</p> : <p className="mt-1 text-[13px] text-slate-600">This version was uploaded by hand, so its content was not compared automatically. Open both files to compare them.</p>}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {canManage ? (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  {!detail.doc.archivedAt ? (
                    <details>
                      <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Replace with a new version</summary>
                      <form action={replaceSuDocumentAction} className="mt-2 space-y-2">
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="documentId" value={detail.doc.id} />
                        <input type="hidden" name="lockVersion" value={detail.doc.lockVersion} />
                        <PrivateFileInput name="file" required accept={ACCEPT_DOCUMENTS} maxBytes={MAX_DOCUMENT_BYTES} label="New file" hint="The current file is kept as an earlier version." />
                        <label className="block"><span className="label">What changed (optional)</span><input name="changeNote" maxLength={1000} className="input" /></label>
                        <button className="btn-secondary">Save new version</button>
                      </form>
                    </details>
                  ) : null}
                  <details>
                    <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Edit details</summary>
                    <form action={updateSuDocumentAction} className="mt-2 grid gap-2 md:grid-cols-2">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="documentId" value={detail.doc.id} />
                      <input type="hidden" name="lockVersion" value={detail.doc.lockVersion} />
                      <DetailFields section={section} doc={detail.doc} canSensitive={canSensitive} />
                      <button className="btn-secondary md:col-span-2">Save details</button>
                    </form>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">{detail.doc.archivedAt ? "Restore to current documents" : "Move to historical documents"}</summary>
                    <form action={archiveSuDocumentAction} className="mt-2 space-y-2">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="documentId" value={detail.doc.id} />
                      <input type="hidden" name="lockVersion" value={detail.doc.lockVersion} />
                      <input type="hidden" name="archive" value={detail.doc.archivedAt ? "false" : "true"} />
                      {!detail.doc.archivedAt ? <label className="block"><span className="label">Why</span><input name="reason" required minLength={3} maxLength={500} className="input" placeholder="e.g. Superseded by the new support plan" /></label> : null}
                      <button className="btn-secondary">{detail.doc.archivedAt ? "Restore" : "Move to historical"}</button>
                      <p className="text-[12.5px] text-slate-500">Nothing is deleted. Historical documents stay available here.</p>
                    </form>
                  </details>
                </div>
              ) : null}

              <div>
                <h4 className="mb-1 text-[14px] font-semibold">History</h4>
                <ol className="space-y-1 text-[13px]" data-testid="document-history">
                  {detail.history.map((h) => {
                    const data = (h.data ?? {}) as { version?: number; changes?: Record<string, unknown>; reason?: string };
                    return (
                      <li key={h.id} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                        <span>{HISTORY_LABEL[h.action] ?? h.action}{data.version ? ` (version ${data.version})` : ""}{data.changes ? `: ${Object.keys(data.changes).join(", ")}` : ""}{data.reason ? `: ${data.reason}` : ""}<span className="block text-slate-500">{names.get(h.actorId ?? "") ?? "Former member"}</span></span>
                        <span className="whitespace-nowrap text-slate-500">{fmtDate(h.createdAt, true)}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
