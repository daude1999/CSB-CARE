import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { financeReference } from "@/server/finance/rates";
import { pounds } from "@/server/finance/pricing";
import { suName } from "@/server/rota/queries";
import { fmtLondonDate, fromDbDate, hhmm, londonDate, WEEKDAYS } from "@/lib/london";
import { addBandAction, addBankHolidayAction, createRateCardAction, financeSettingsAction, packageFunderAction, removeBandAction, removeBankHolidayAction, saveFunderAction, staffPayCardAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader, SegmentNav } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const TABS = [["funders", "Funders"], ["cards", "Rate cards"], ["holidays", "Bank holidays"], ["packages", "Who funds each person"], ["staff", "Carers’ pay"], ["settings", "Settings"]] as const;
const KIND: Record<string, string> = { LOCAL_AUTHORITY: "Local authority", NHS: "NHS", PRIVATE: "Private", OTHER: "Other" };

export default async function RatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("finance.view");
  const ref = await financeReference(ctx);
  const can = hasOrgPermission(ctx, "finance.manage");
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "funders";
  const back = `/rota/finance/rates?tab=${tab}`;
  const chargeCards = ref.cards.filter((c) => c.kind === "CHARGE");
  const payCards = ref.cards.filter((c) => c.kind === "PAY");

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="finance" active={sp.tab === "holidays" ? "holidays" : "rates"} />} title="Funders & Rates" back="/rota/finance" subtitle="Who pays for care, what they are charged and what carers are paid. A rate card that has been used in a run cannot be changed; start a new card from a new date instead, so past runs can always be explained." />
      <Flash searchParams={sp} />
      <div className="min-w-0 max-w-full"><SegmentNav label="Finance set-up" items={TABS.map(([k, label]) => ({ href: `/rota/finance/rates?tab=${k}`, label, active: tab === k }))} /></div>

      {tab === "funders" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            {ref.funders.length ? (
              <div className="relative min-w-0 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Funder</th><th>Type</th><th>Charge rate card</th><th>Charged on</th><th>Short-notice cancellations</th><th>Terms</th><th>People</th></tr></thead>
                  <tbody>
                    {ref.funders.map((f) => (
                      <tr key={f.id}>
                        <td>{can ? <Link href={`${back}&edit=${f.id}`}>{f.name}</Link> : f.name}{f.reference ? <div className="text-[12.5px] text-slate-500">{f.reference}</div> : null}</td>
                        <td>{KIND[f.kind]}</td>
                        <td>{f.chargeRateCard?.name ?? <Badge tone="rose">None</Badge>}</td>
                        <td>{f.chargeBasis === "ACTUAL" ? "Actual time" : "Planned time"}</td>
                        <td>{f.shortNoticeCancelHours === null ? "Not charged" : `Charged within ${f.shortNoticeCancelHours} h`}</td>
                        <td className="tabular-nums">{f.paymentTermsDays} days</td>
                        <td className="tabular-nums">{f._count.packages}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No funders yet.</Empty>}
          </Card>
          {can ? (() => {
            const f = ref.funders.find((x) => x.id === sp.edit);
            return (
              <Card title={f ? `Edit ${f.name}` : "Add a funder"}>
                <form action={saveFunderAction} className="space-y-2" key={f?.id ?? "new"}>
                  <input type="hidden" name="back" value={f ? `${back}&edit=${f.id}` : back} />
                  {f ? <input type="hidden" name="funderId" value={f.id} /> : null}
                  <label className="block"><span className="label">Name</span><input name="name" required defaultValue={f?.name ?? ""} className="input" /></label>
                  <div className="grid grid-cols-2 gap-2">
                    <label><span className="label">Type</span><select name="kind" defaultValue={f?.kind ?? "LOCAL_AUTHORITY"} className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label><span className="label">Their reference</span><input name="reference" defaultValue={f?.reference ?? ""} className="input" /></label>
                  </div>
                  <label className="block"><span className="label">Billing email</span><input name="billingEmail" type="email" defaultValue={f?.billingEmail ?? ""} className="input" /></label>
                  <label className="block"><span className="label">Charge rate card</span><select name="chargeRateCardId" defaultValue={f?.chargeRateCardId ?? ""} className="input"><option value="">None yet</option>{chargeCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <div className="grid grid-cols-3 gap-2">
                    <label><span className="label">Charge on</span><select name="chargeBasis" defaultValue={f?.chargeBasis ?? "SCHEDULED"} className="input"><option value="SCHEDULED">Planned</option><option value="ACTUAL">Actual</option></select></label>
                    <label><span className="label">Terms (days)</span><input name="paymentTermsDays" type="number" min={0} max={120} defaultValue={f?.paymentTermsDays ?? 30} className="input" /></label>
                    <label><span className="label">Cancel charge (h)</span><input name="shortNoticeCancelHours" type="number" min={0} max={168} defaultValue={f?.shortNoticeCancelHours ?? ""} placeholder="Never" className="input" /></label>
                  </div>
                  <div className="flex gap-2"><button className="btn-primary">{f ? "Save changes" : "Add funder"}</button>{f ? <Link href={back} className="btn-secondary">Cancel</Link> : null}</div>
                </form>
              </Card>
            );
          })() : null}
        </div>
      ) : null}

      {tab === "cards" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            {ref.cards.length ? ref.cards.map((c) => (
              <section key={c.id} id={`card-${c.id}`}>
                <Card title={c.name} actions={<span className="flex gap-1"><Badge tone={c.kind === "CHARGE" ? "teal" : "violet"}>{c.kind === "CHARGE" ? "Charge" : "Pay"}</Badge><Badge>from {fmtLondonDate(fromDbDate(c.effectiveFrom))}</Badge></span>}>
                  {c.bands.length ? (
                    <div className="relative min-w-0 overflow-x-auto">
                      <table className="table">
                        <thead><tr><th>Band</th><th>Days</th><th>Times</th><th>Rate</th><th>Minimum</th>{can ? <th><span className="sr-only">Remove</span></th> : null}</tr></thead>
                        <tbody>
                          {c.bands.map((b) => (
                            <tr key={b.id}>
                              <td>{b.label}</td>
                              <td>{b.bankHoliday ? "Bank holidays" : b.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 3)).join(", ")}</td>
                              <td className="tabular-nums">{b.bankHoliday ? "All day" : `${hhmm(b.fromMinute)}–${b.toMinute === 1440 ? "24:00" : hhmm(b.toMinute)}`}</td>
                              <td className="tabular-nums">{pounds(b.ratePence)} {b.unit === "PER_HOUR" ? "an hour" : "a visit"}</td>
                              <td className="tabular-nums">{b.minimumMinutes ? `${b.minimumMinutes} min` : "—"}</td>
                              {can ? <td className="text-right"><form action={removeBandAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="bandId" value={b.id} /><button className="btn-secondary py-1" aria-label={`Remove ${b.label}`}>Remove</button></form></td> : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <Empty>No bands yet. Visits cannot be priced on this card until it has some.</Empty>}
                  {can ? (
                    <details className="mt-3" open={sp.card === c.id}>
                      <summary className="cursor-pointer text-[14px] font-medium">Add a band</summary>
                      <form action={addBandAction} className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
                        <input type="hidden" name="back" value={`${back}&card=${c.id}#card-${c.id}`} />
                        <input type="hidden" name="rateCardId" value={c.id} />
                        <label className="col-span-2"><span className="label">Label</span><input name="label" required className="input" placeholder="Weekday daytime" /></label>
                        <label><span className="label">From</span><input name="from" type="time" defaultValue="07:00" className="input" /></label>
                        <label><span className="label">To</span><input name="to" defaultValue="22:00" pattern="[0-2][0-9]:[0-5][0-9]" className="input" /></label>
                        <label><span className="label">Rate (£)</span><input name="rate" required inputMode="decimal" className="input" placeholder="24.50" /></label>
                        <label><span className="label">Per</span><select name="unit" className="input"><option value="PER_HOUR">Hour</option><option value="PER_VISIT">Visit</option></select></label>
                        <fieldset className="col-span-2 md:col-span-4"><legend className="label">Days</legend><div className="flex flex-wrap gap-3">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-[14px]"><input type="checkbox" name="weekdays" value={i + 1} defaultChecked={i < 5} className="h-4 w-4" />{d.slice(0, 3)}</label>)}</div></fieldset>
                        <label><span className="label">Minimum (min)</span><input name="minimumMinutes" type="number" min={0} max={240} className="input" /></label>
                        <label className="flex items-end gap-2 pb-2 text-[14px]"><input type="checkbox" name="bankHoliday" className="h-4 w-4" /> Bank holiday band</label>
                        <div className="col-span-2 md:col-span-6"><button className="btn-secondary">Add band</button></div>
                      </form>
                    </details>
                  ) : null}
                </Card>
              </section>
            )) : <Card><Empty>No rate cards yet.</Empty></Card>}
          </div>
          {can ? (
            <Card title="New rate card">
              <form action={createRateCardAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <label className="block"><span className="label">For</span><select name="kind" className="input"><option value="CHARGE">Charging funders</option><option value="PAY">Paying carers</option></select></label>
                <label className="block"><span className="label">Name</span><input name="name" required className="input" placeholder="Council framework 2027" /></label>
                <label className="block"><span className="label">Applies from</span><input name="effectiveFrom" type="date" required defaultValue={londonDate()} className="input" /></label>
                <button className="btn-primary">Create card</button>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "holidays" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            {ref.holidays.length ? (
              <ul className="rows text-[14px]">
                {ref.holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between py-2">
                    <span><span className="tabular-nums">{fmtLondonDate(fromDbDate(h.date))}</span> · {h.name}</span>
                    {can ? <form action={removeBankHolidayAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="holidayId" value={h.id} /><button className="btn-secondary py-1">Remove</button></form> : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>No bank holidays recorded. Bank holiday bands only apply on dates listed here.</Empty>}
          </Card>
          {can ? (
            <Card title="Add a bank holiday">
              <form action={addBankHolidayAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <label className="block"><span className="label">Date</span><input name="date" type="date" required className="input" /></label>
                <label className="block"><span className="label">Name</span><input name="name" required className="input" /></label>
                <button className="btn-primary">Add</button>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "packages" ? (
        <Card>
          {ref.packages.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Person</th><th>Package</th><th>Hours a week</th><th>Funder</th></tr></thead>
                <tbody>
                  {ref.packages.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/rota/service-users/${p.serviceUser.id}`}>{suName(p.serviceUser)}</Link></td>
                      <td>{p.reference ?? "—"}<div className="text-[12.5px] text-slate-500">from {fmtLondonDate(fromDbDate(p.startDate))}</div></td>
                      <td className="tabular-nums">{p.commissionedMinutesPerWeek ? (p.commissionedMinutesPerWeek / 60).toFixed(1) : "—"}</td>
                      <td>
                        {can ? (
                          <form action={packageFunderAction} className="flex gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="packageId" value={p.id} />
                            <label className="sr-only" htmlFor={`f-${p.id}`}>Funder for {suName(p.serviceUser)}</label>
                            <select id={`f-${p.id}`} name="funderId" defaultValue={p.funderId ?? ""} className="input w-56 py-1.5"><option value="">Not funded yet</option>{ref.funders.filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                            <button className="btn-secondary py-1">Save</button>
                          </form>
                        ) : p.funder?.name ?? <Badge tone="rose">Not funded</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No active care packages.</Empty>}
        </Card>
      ) : null}

      {tab === "staff" ? (
        <Card>
          <p className="mb-2 text-[13.5px] text-slate-600">Carers without their own card are paid on the default pay card ({payCards.find((c) => c.id === ref.settings.defaultPayRateCardId)?.name ?? "none set"}).</p>
          {ref.staff.length ? (
            <div className="relative min-w-0 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Carer</th><th>Pay card</th>{can ? <th>Change from a date</th> : null}</tr></thead>
                <tbody>
                  {ref.staff.map((s) => (
                    <tr key={s.id}>
                      <td>{s.displayName}</td>
                      <td>{s.payRates[0] ? <>{s.payRates[0].rateCard.name}<div className="text-[12.5px] text-slate-500">from {fmtLondonDate(fromDbDate(s.payRates[0].effectiveFrom))}</div></> : <span className="text-slate-500">Default</span>}</td>
                      {can ? (
                        <td>
                          <form action={staffPayCardAction} className="flex flex-wrap gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="staffId" value={s.id} />
                            <label className="sr-only" htmlFor={`pc-${s.id}`}>Pay card for {s.displayName}</label>
                            <select id={`pc-${s.id}`} name="rateCardId" required defaultValue="" className="input w-48 py-1.5"><option value="" disabled>Choose…</option>{payCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            <label className="sr-only" htmlFor={`pf-${s.id}`}>From</label>
                            <input id={`pf-${s.id}`} name="from" type="date" required defaultValue={londonDate()} className="input w-40 py-1.5" />
                            <button className="btn-secondary py-1">Set</button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No carers on the rota yet.</Empty>}
        </Card>
      ) : null}

      {tab === "settings" ? (
        <Card title="Finance settings">
          <form action={financeSettingsAction} className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <label><span className="label">Default pay rate card</span><select name="defaultPayRateCardId" defaultValue={ref.settings.defaultPayRateCardId ?? ""} disabled={!can} className="input"><option value="">None</option>{payCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label><span className="label">Pay carers on</span><select name="payBasis" defaultValue={ref.settings.payBasis} disabled={!can} className="input"><option value="ACTUAL">Actual clocked time</option><option value="SCHEDULED">Planned time (when clocked in and out)</option></select></label>
            <label><span className="label">Mileage rate (£ a mile)</span><input name="mileage" defaultValue={(ref.settings.mileagePencePerMile / 100).toFixed(2)} disabled={!can} className="input" /></label>
            <label><span className="label">Invoice number prefix</span><input name="invoicePrefix" defaultValue={ref.settings.invoicePrefix} disabled={!can} className="input" /><span className="mt-1 block text-[12.5px] text-slate-500">Next number: {ref.settings.invoicePrefix}-{String(ref.settings.nextInvoiceNumber).padStart(5, "0")}</span></label>
            <label><span className="label">Employer on-costs for estimates (%)</span><input type="number" name="estimateOnCostPercent" min={0} max={100} step={1} defaultValue={ref.settings.estimateOnCostPercent} disabled={!can} className="input" /><span className="mt-1 block text-[12.5px] text-slate-500">Added to pay in the rota&rsquo;s cost and margin estimates only (employer National Insurance, pension, holiday accrual). Never used for payroll. 0 means pay rates only.</span></label>
            {can ? <div className="md:col-span-2"><button className="btn-primary">Save settings</button></div> : null}
          </form>
          <p className="mt-3 text-[13px] text-slate-600">Mileage claims are not built yet, so pay runs contain visit time only. The rate above is stored for when they are.</p>
        </Card>
      ) : null}
    </>
  );
}
