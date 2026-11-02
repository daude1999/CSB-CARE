import Link from "@/components/link";
import { dbDate, londonDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { memberNames } from "@/server/rota/queries";
import { INCIDENT_CATEGORIES } from "@/server/care/incidents";
import { BODY_MAP_VIEWS, BODY_REGIONS, OBSERVATION_CATEGORIES, PAIN_LEVELS, linkableIncidents, listObservations, painLabel } from "@/server/care/body-map";
import { MAX_DOCUMENT_BYTES } from "@/server/care/su-documents";
import { bodyMapIncidentAction, bodyMapPhotoAction, recordBodyMapAction, reviewBodyMapAction } from "@/app/su-record-actions";
import { BodyMapFigure, type Marker } from "@/components/body-map-figure";
import { PrivateFileInput } from "@/components/private-file-input";
import { Badge, Empty, fmtDate } from "@/components/ui";

const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.tif,.tiff";

type Obs = Awaited<ReturnType<typeof listObservations>>[number];

function followUpState(o: Obs, today: Date) {
  if (o.status === "RESOLVED") return { label: "Resolved", tone: "green" as const };
  if (!o.followUpOn) return { label: "No follow-up set", tone: "slate" as const };
  if (o.followUpOn < today) return { label: `Follow-up overdue (${fmtDate(o.followUpOn)})`, tone: "rose" as const };
  return { label: `Follow-up ${fmtDate(o.followUpOn)}`, tone: "amber" as const };
}

function decisionBadge(o: Obs) {
  if (o.incidentDecision === "LINKED" && o.incident) return <Badge tone="violet">Incident {o.incident.reference}</Badge>;
  if (o.incidentDecision === "NOT_REQUIRED") return <Badge>No incident needed</Badge>;
  return <Badge tone="amber">Awaiting manager review</Badge>;
}

/**
 * The Digital Body Map section of a service user's profile: the outline with every observation marked, the list of
 * observations, and either the selected observation (follow-ups, photos, incident decision, comparison over time) or
 * the form to record a new one.
 */
export async function BodyMapSection({ ctx, serviceUserId, base, selectedId, recording }: { ctx: Ctx; serviceUserId: string; base: string; selectedId?: string; recording: boolean }) {
  const canRecord = hasOrgPermission(ctx, "bodyMap.record");
  const canPhotos = hasOrgPermission(ctx, "bodyMap.photos");
  const canDecide = hasOrgPermission(ctx, "incident.manage");
  const [obs, incidents] = await Promise.all([listObservations(ctx, serviceUserId), canDecide ? linkableIncidents(ctx, serviceUserId) : Promise.resolve([])]);
  const here = `${base}?tab=bodymap`;
  const numbered = [...obs].reverse().map((o, i) => ({ o, n: i + 1 }));
  const numberOf = new Map(numbered.map(({ o, n }) => [o.id, n]));
  const selected = obs.find((o) => o.id === selectedId) ?? null;
  const today = dbDate(londonDate());
  const names = await memberNames(ctx, [...obs.map((o) => o.recordedById), ...obs.flatMap((o) => o.reviews.map((r) => r.reviewedById)), ...obs.map((o) => o.incidentDecidedById)]);
  const markers: Marker[] = numbered.map(({ o, n }) => ({ id: o.id, n, view: o.view, x: o.x, y: o.y, open: o.status === "OPEN", label: `${o.category}, ${o.region}, ${fmtDate(o.observedAt)}`, href: `${here}&obs=${o.id}`, selected: o.id === selected?.id }));
  const outstanding = obs.filter((o) => o.status === "OPEN" && o.followUpOn);
  const overdue = outstanding.filter((o) => o.followUpOn! < today).length;
  const awaiting = obs.filter((o) => !o.incidentDecision).length;
  const compare = selected ? obs.filter((o) => o.view === selected.view && o.region === selected.region).sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime()) : [];
  const back = selected ? `${here}&obs=${selected.id}` : here;
  const nowDate = londonDate();
  const nowTime = londonTime(new Date());

  return (
    <div className="space-y-3" data-testid="body-map">
      <section className="card" aria-labelledby="bm-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="bm-h" className="text-[17px]">Digital Body Map</h2>
            <p className="mt-0.5 text-[13.5px] text-slate-600">Record what was seen on the body, where, and what was done. Describe it; do not diagnose. A manager decides whether an incident report is needed.</p>
          </div>
          {canRecord && !recording ? <Link href={`${here}&record=1`} className="btn-primary">Record observation</Link> : null}
        </div>
        <p className="mt-3 flex flex-wrap gap-2 text-[13px]" data-testid="body-map-counts">
          <Badge tone={outstanding.length ? "amber" : "slate"}>{outstanding.length} outstanding follow-up{outstanding.length === 1 ? "" : "s"}</Badge>
          {overdue ? <Badge tone="rose">{overdue} overdue</Badge> : null}
          <Badge tone={awaiting ? "amber" : "slate"}>{awaiting} awaiting manager review</Badge>
          <Badge>{obs.filter((o) => o.status === "RESOLVED").length} resolved</Badge>
        </p>
      </section>

      {recording && canRecord ? (
        <section className="card" aria-labelledby="bm-new">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 id="bm-new" className="text-[16px] font-semibold">Record an observation</h3><Link href={here} className="text-[13.5px]">Cancel</Link></div>
          <form action={recordBodyMapAction}>
            <input type="hidden" name="back" value={`${here}&record=1`} />
            <input type="hidden" name="serviceUserId" value={serviceUserId} />
            <BodyMapFigure markers={markers} regions={BODY_REGIONS} recordable>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="md:col-span-2"><span className="label">Exact location (optional)</span><input name="locationDetail" maxLength={200} className="input" placeholder="e.g. 3 cm above the wrist, outer side" /></label>
                <label><span className="label">What was observed</span><select name="category" required className="input" defaultValue=""><option value="">Choose…</option>{OBSERVATION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Date observed</span><input type="date" name="date" required defaultValue={nowDate} max={nowDate} className="input" /></label>
                  <label><span className="label">Time</span><input type="time" name="time" required defaultValue={nowTime} className="input" /></label>
                </div>
                <label className="md:col-span-2"><span className="label">Description</span><textarea name="description" required minLength={10} maxLength={4000} rows={3} className="input" placeholder="What you saw, in plain words. For example: purple bruise, roughly oval, skin not broken." /></label>
                <label><span className="label">Size (where appropriate)</span><input name="size" maxLength={120} className="input" placeholder="e.g. 4 cm × 2 cm" /></label>
                <label><span className="label">Colour and appearance</span><input name="appearance" maxLength={300} className="input" placeholder="e.g. purple, raised, dry" /></label>
                <label><span className="label">Pain or discomfort reported</span><select name="pain" required className="input" defaultValue=""><option value="">Choose…</option>{Object.entries(PAIN_LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label><span className="label">Follow-up date</span><input type="date" name="followUpOn" min={nowDate} className="input" /></label>
                <label className="md:col-span-2"><span className="label">Immediate action taken</span><textarea name="actionTaken" maxLength={2000} rows={2} className="input" /></label>
                <label className="md:col-span-2"><span className="label">Person notified</span><input name="personNotified" maxLength={300} className="input" placeholder="e.g. Daughter (next of kin) by phone; district nurse" /></label>
                {canPhotos ? (
                  <>
                    <div><PrivateFileInput name="photo" accept={PHOTO_ACCEPT} maxBytes={MAX_DOCUMENT_BYTES} label="Photograph (optional)" hint="Only with the person's consent. Kept privately; up to 4 MB." /></div>
                    <label><span className="label">Photo caption</span><input name="caption" maxLength={200} className="input" /></label>
                  </>
                ) : null}
                <button className="btn-primary md:col-span-2">Save observation</button>
                <p className="text-[12.5px] text-slate-500 md:col-span-2">The observation is saved exactly as entered and cannot be edited afterwards; later findings are added as follow-ups. Managers are alerted in the app to review it.</p>
              </div>
            </BodyMapFigure>
          </form>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
          <section className="card" aria-label="Observations">
            <BodyMapFigure markers={markers} regions={BODY_REGIONS} initialView={selected?.view ?? "FRONT"}>
              {obs.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13.5px]" data-testid="body-map-list">
                    <thead className="text-left text-[12.5px] text-slate-600"><tr><th className="px-2 py-2">#</th><th className="px-2 py-2">Observed</th><th className="px-2 py-2">Where and what</th><th className="px-2 py-2">Follow-up</th><th className="px-2 py-2">Incident</th></tr></thead>
                    <tbody>
                      {obs.map((o) => {
                        const f = followUpState(o, today);
                        return (
                          <tr key={o.id} className={`border-t border-slate-100 align-top ${o.id === selected?.id ? "bg-[#eef4fb]" : ""}`}>
                            <td className="px-2 py-2 font-medium">{numberOf.get(o.id)}</td>
                            <td className="whitespace-nowrap px-2 py-2">{fmtDate(o.observedAt)}<span className="block text-[12px] text-slate-500">{londonTime(o.observedAt)}</span></td>
                            <td className="px-2 py-2"><Link href={`${here}&obs=${o.id}`} className="row-title">{o.category}</Link><span className="block text-[12.5px] text-slate-600">{o.region} · {BODY_MAP_VIEWS[o.view].toLowerCase()}{o.photos.length ? ` · ${o.photos.length} photo${o.photos.length === 1 ? "" : "s"}` : ""}</span></td>
                            <td className="px-2 py-2"><Badge tone={f.tone}>{f.label}</Badge></td>
                            <td className="px-2 py-2">{decisionBadge(o)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No body map observations recorded.{canRecord ? " Use Record observation to add one." : ""}</Empty>}
            </BodyMapFigure>
          </section>

          <aside className="card" aria-label="Selected observation" data-testid="body-map-detail">
            {!selected ? (
              <Empty>Choose an observation on the outline or in the list to see its details, follow-ups and photos.</Empty>
            ) : (
              <div className="space-y-4 text-[14px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-[16px] font-semibold">{numberOf.get(selected.id)}. {selected.category}</h3><Badge tone={followUpState(selected, today).tone}>{followUpState(selected, today).label}</Badge></div>
                  <p className="text-slate-600">{selected.region} ({BODY_MAP_VIEWS[selected.view].toLowerCase()}){selected.locationDetail ? ` · ${selected.locationDetail}` : ""}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><dt className="label">Observed</dt><dd>{fmtDate(selected.observedAt, true)}</dd></div>
                  <div><dt className="label">Recorded by</dt><dd>{names.get(selected.recordedById) ?? "Former member"}<span className="block text-[12px] text-slate-500">{fmtDate(selected.recordedAt, true)}</span></dd></div>
                  <div className="col-span-2"><dt className="label">Description</dt><dd className="whitespace-pre-line">{selected.description}</dd></div>
                  <div><dt className="label">Size</dt><dd>{selected.size ?? "—"}</dd></div>
                  <div><dt className="label">Colour and appearance</dt><dd>{selected.appearance ?? "—"}</dd></div>
                  <div><dt className="label">Pain or discomfort</dt><dd>{painLabel(selected.pain)}</dd></div>
                  <div><dt className="label">Person notified</dt><dd>{selected.personNotified ?? "—"}</dd></div>
                  <div className="col-span-2"><dt className="label">Immediate action</dt><dd className="whitespace-pre-line">{selected.actionTaken ?? "—"}</dd></div>
                </dl>

                <div>
                  <h4 className="mb-1 text-[14px] font-semibold">Photographs</h4>
                  {!canPhotos ? <p className="text-[13px] text-slate-600">{selected.photos.length ? `${selected.photos.length} photo(s). Your role cannot view body map photographs.` : "None."}</p> : selected.photos.length ? (
                    <ul className="grid grid-cols-2 gap-2" data-testid="body-map-photos">
                      {selected.photos.map((p) => (
                        <li key={p.id} className="text-[12.5px] text-slate-600">
                          <a href={`/api/service-users/body-map/photos/${p.id}`} target="_blank" rel="noopener">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/service-users/body-map/photos/${p.id}`} alt={p.caption ?? `Photo of ${selected.category.toLowerCase()}`} className="h-28 w-full rounded-[4px] border border-slate-200 bg-slate-50 object-cover" />
                          </a>
                          {fmtDate(p.uploadedAt, true)}{p.caption ? ` · ${p.caption}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-[13px] text-slate-600">None.</p>}
                  {canRecord && canPhotos ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">Add a photograph</summary>
                      <form action={bodyMapPhotoAction} className="mt-2 space-y-2">
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="observationId" value={selected.id} />
                        <PrivateFileInput name="photo" required accept={PHOTO_ACCEPT} maxBytes={MAX_DOCUMENT_BYTES} label="Photograph" hint="Only with the person's consent. Up to 4 MB." />
                        <label className="block"><span className="label">Caption</span><input name="caption" maxLength={200} className="input" /></label>
                        <button className="btn-secondary">Add photo</button>
                      </form>
                    </details>
                  ) : null}
                </div>

                <div>
                  <h4 className="mb-1 text-[14px] font-semibold">Follow-ups</h4>
                  {selected.reviews.length ? (
                    <ol className="space-y-1.5 text-[13.5px]" data-testid="body-map-reviews">
                      {selected.reviews.map((r) => (
                        <li key={r.id} className="border-b border-slate-100 pb-1.5">
                          <span className="whitespace-pre-line">{r.outcome}</span>
                          <span className="block text-[12px] text-slate-500">{fmtDate(r.reviewedAt, true)} · {names.get(r.reviewedById) ?? "Former member"}{r.resolved ? " · resolved" : r.nextFollowUpOn ? ` · next follow-up ${fmtDate(r.nextFollowUpOn)}` : ""}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-[13px] text-slate-600">No follow-ups yet.</p>}
                  {canRecord ? (
                    <form action={reviewBodyMapAction} className="mt-2 space-y-2 rounded-[4px] border border-slate-200 bg-[#f8fafc] p-3">
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="observationId" value={selected.id} />
                      <input type="hidden" name="version" value={selected.version} />
                      <label className="block"><span className="label">{selected.status === "RESOLVED" ? "Reopen with a new finding" : "Follow-up outcome"}</span><textarea name="outcome" required minLength={5} rows={2} maxLength={4000} className="input" placeholder="What was seen at the follow-up, and any change" /></label>
                      <div className="grid grid-cols-2 items-end gap-2">
                        <label><span className="label">Next follow-up</span><input type="date" name="nextFollowUpOn" min={nowDate} className="input" /></label>
                        <label className="flex items-center gap-2 pb-2 text-[14px]"><input type="checkbox" name="resolved" className="h-4 w-4" /> Resolved, no more follow-up</label>
                      </div>
                      <button className="btn-secondary">Save follow-up</button>
                    </form>
                  ) : null}
                </div>

                <div>
                  <h4 className="mb-1 text-[14px] font-semibold">Incident report</h4>
                  <p className="text-[13.5px]">{decisionBadge(selected)}{selected.incidentDecidedAt ? <span className="ml-1 text-[12.5px] text-slate-600">by {names.get(selected.incidentDecidedById ?? "") ?? "Former member"}, {fmtDate(selected.incidentDecidedAt, true)}{selected.incidentDecisionNote ? `: ${selected.incidentDecisionNote}` : ""}</span> : null}</p>
                  {selected.incident ? <p className="mt-1 text-[13.5px]"><Link href={`/rota/incidents/${selected.incident.id}`}>Open incident {selected.incident.reference}</Link> <span className="text-slate-600">· {selected.incident.category} · {selected.incident.status.toLowerCase()}</span></p> : null}
                  {canDecide ? (
                    <details className="mt-2" open={!selected.incidentDecision ? true : undefined}>
                      <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">{selected.incidentDecision ? "Change the decision" : "Decide whether an incident report is needed"}</summary>
                      <div className="mt-2 space-y-3">
                        <form action={bodyMapIncidentAction} className="space-y-2 rounded-[4px] border border-slate-200 p-3">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="observationId" value={selected.id} />
                          <input type="hidden" name="version" value={selected.version} />
                          <input type="hidden" name="decision" value="NEW" />
                          <p className="text-[13.5px] font-medium">Report a new incident from this observation</p>
                          <div className="grid grid-cols-2 gap-2">
                            <label><span className="label">Category</span><select name="category" defaultValue="Injury" className="input">{INCIDENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                            <label><span className="label">Severity</span><select name="severity" defaultValue="LOW" className="input"><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></label>
                          </div>
                          <label className="block"><span className="label">What happened</span><textarea name="description" required minLength={20} rows={3} className="input" defaultValue={`Body map: ${selected.category.toLowerCase()} observed on ${selected.region.toLowerCase()}. ${selected.description}`} /></label>
                          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="safeguarding" className="h-4 w-4" /> This is a safeguarding concern</label>
                          <button className="btn-secondary">Report and link incident</button>
                        </form>
                        {incidents.length ? (
                          <form action={bodyMapIncidentAction} className="space-y-2 rounded-[4px] border border-slate-200 p-3">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="observationId" value={selected.id} />
                            <input type="hidden" name="version" value={selected.version} />
                            <input type="hidden" name="decision" value="LINK" />
                            <label className="block"><span className="label">Link to an existing incident about this person</span><select name="incidentId" required className="input" defaultValue=""><option value="">Choose…</option>{incidents.map((i) => <option key={i.id} value={i.id}>{i.reference} · {i.category} · {fmtDate(i.occurredAt)}</option>)}</select></label>
                            <label className="block"><span className="label">Note (optional)</span><input name="note" maxLength={1000} className="input" /></label>
                            <button className="btn-secondary">Link incident</button>
                          </form>
                        ) : null}
                        <form action={bodyMapIncidentAction} className="space-y-2 rounded-[4px] border border-slate-200 p-3">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="observationId" value={selected.id} />
                          <input type="hidden" name="version" value={selected.version} />
                          <input type="hidden" name="decision" value="NOT_REQUIRED" />
                          <label className="block"><span className="label">No incident report needed, because</span><input name="note" required minLength={5} maxLength={1000} className="input" placeholder="e.g. Known cause, recorded in care plan" /></label>
                          <button className="btn-secondary">Record decision</button>
                        </form>
                      </div>
                    </details>
                  ) : !selected.incidentDecision ? <p className="mt-1 text-[12.5px] text-slate-500">A manager will review this observation.</p> : null}
                </div>

                {compare.length > 1 ? (
                  <div>
                    <h4 className="mb-1 text-[14px] font-semibold">Over time: {selected.region}</h4>
                    <ol className="space-y-2" data-testid="body-map-compare">
                      {compare.map((c) => (
                        <li key={c.id} className={`flex gap-3 rounded-[4px] border p-2 text-[13px] ${c.id === selected.id ? "border-navy-700 bg-[#eef4fb]" : "border-slate-200"}`}>
                          {canPhotos && c.photos[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/service-users/body-map/photos/${c.photos[0].id}`} alt={`Photo from ${fmtDate(c.observedAt)}`} className="h-16 w-16 shrink-0 rounded-[3px] object-cover" />
                          ) : null}
                          <span><Link href={`${here}&obs=${c.id}`} className="font-medium">{fmtDate(c.observedAt)}: {c.category}</Link><span className="block text-slate-600">{c.size ? `${c.size} · ` : ""}{c.appearance ?? c.description.slice(0, 80)}</span></span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
