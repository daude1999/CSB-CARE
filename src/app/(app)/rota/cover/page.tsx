import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { COVER_KINDS, KIND_LABEL, coverBoard, type CoverItem } from "@/server/rota/cover";
import { rotaLookups, suName, visitCandidatesMany, type Candidate } from "@/server/rota/queries";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { AreaDot, CarerSlots, TimeSpan } from "@/components/rota-ui";
import { CarerRecommendations, SCORE_NOTE } from "@/components/rota-match";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

/** Replacements are ranked for this many bookings per page; the rest link to the visit page. */
const SUGGEST = 30;
const SLOT_LABEL = { PRIMARY: "Lead carer", SECOND: "Second carer", SHADOW: "Shadow" } as const;

function when(start: Date, end: Date) {
  const a = londonDate(start);
  const b = londonDate(new Date(end.getTime() - 1));
  const day = (d: string) => fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" });
  return a === b ? `${day(a)} ${londonTime(start)}–${londonTime(end)}` : `${day(a)} to ${day(b)}`;
}

export default async function CoverPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const [board, lk] = await Promise.all([coverBoard(ctx, { from: sp.from, days: Number(sp.days) || 14, kind: sp.kind, area: sp.area }), rotaLookups(ctx)]);
  const canEdit = hasOrgPermission(ctx, "rota.edit");

  // Visits are keyed by id in the ranking, so lead and second slots are ranked in separate passes.
  const wanted = canEdit ? board.items.slice(0, SUGGEST) : [];
  const [lead, second] = await Promise.all(
    (["PRIMARY", "SECOND"] as const).map((slot) => visitCandidatesMany(ctx, wanted.filter((i) => i.slot === slot).map((i) => ({ visit: i.visit, slot })))),
  );
  const ranked = (i: CoverItem): Candidate[] | undefined => (i.slot === "SECOND" ? second : lead)?.get(i.visit.id)?.filter((c) => c.id !== i.staffId);
  const params = new URLSearchParams(Object.entries({ from: board.from, days: String(board.days), kind: board.kind ?? "", area: board.area ?? "" }).filter(([, v]) => v));
  const back = `/rota/cover?${params}`;
  const c = board.counts;

  const Row = ({ item }: { item: CoverItem }) => {
    const v = item.visit;
    const list = ranked(item);
    return (
      <li className="py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
          <TimeSpan start={v.scheduledStart} end={v.scheduledEnd} />
          <span className="text-slate-600">{fmtLondonDate(londonDate(v.scheduledStart), { weekday: "short", day: "numeric", month: "short" })}</span>
          <Link href={`/rota/visits/${v.id}`} className="row-title">{suName(v.serviceUser)}</Link>
          <span className="text-slate-600">{v.callType.name}{v.carersRequired > 1 ? " · double-up" : ""}</span>
          <AreaDot area={v.area} />
          <CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} />
        </div>
        <p className="mt-1 text-[13px] text-[#8a5a00]">{SLOT_LABEL[item.slot]}: {item.reason}</p>
        {list ? (
          list.some((x) => x.score !== null) ? (
            <CarerRecommendations list={list} visitId={v.id} slot={item.slot} lockVersion={v.lockVersion} back={back} replacing />
          ) : <p className="mt-1 text-[13px] text-[#a3242c]">No one is free and eligible for this time. <Link href={`/rota/visits/${v.id}`} className="underline">Open the visit</Link> to move it or see every carer&rsquo;s reasons.</p>
        ) : canEdit ? <p className="mt-1 text-[13px]"><Link href={`/rota/visits/${v.id}`} className="underline">Choose a replacement on the visit page</Link></p> : null}
      </li>
    );
  };

  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="daily" active="cover" />}
        title="Sickness & Holiday Cover"
        back="/rota"
        subtitle="Bookings held by someone who is absent, or flagged after an HR change. Absences never move visits by themselves: pick a replacement here and the full eligibility check runs again."
        actions={<Link href="/rota/unassigned" className="btn-secondary">Unassigned Visits</Link>}
      />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">From</span><input type="date" name="from" defaultValue={board.from} className="input" /></label>
          <label><span className="label">Days</span><select name="days" defaultValue={String(board.days)} className="input"><option value="7">7</option><option value="14">14</option><option value="28">28</option></select></label>
          <label><span className="label">Absence type</span><select name="kind" defaultValue={board.kind ?? ""} className="input"><option value="">All, and HR flags</option>{COVER_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={board.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className="btn-primary">Show</button>
          <p className="ml-auto pb-2 text-[13.5px] text-slate-600" aria-live="polite">
            <span className="tabular-nums">{c.absences}</span> absence{c.absences === 1 ? "" : "s"} · <span className="tabular-nums">{c.bookings}</span> booking{c.bookings === 1 ? "" : "s"} to cover on <span className="tabular-nums">{c.visits}</span> visit{c.visits === 1 ? "" : "s"}
            {c.doubleUps ? <> · <span className="tabular-nums">{c.doubleUps}</span> double-up{c.doubleUps === 1 ? "" : "s"}</> : null}
            {" "}· {fmtLondonDate(board.from, { day: "numeric", month: "short" })} to {fmtLondonDate(board.to, { day: "numeric", month: "short" })}
          </p>
        </form>
      </section>

      {board.absences.length || board.flagged.length ? (
        <>
          {board.absences.map((a) => (
            <Card
              key={a.id}
              className="mb-3"
              title={<span className="flex flex-wrap items-center gap-2">{a.staffName} <Badge tone={a.kind === "SICKNESS" ? "rose" : "amber"}>{KIND_LABEL[a.kind]}</Badge>{a.status === "REQUESTED" ? <Badge tone="slate">Requested</Badge> : null}<span className="text-[13px] font-normal text-slate-600">{when(a.startsAt, a.endsAt)}</span></span>}
              actions={<Link href={`/rota/staff/${a.staffId}`} className="text-[13px] underline">Team member</Link>}
            >
              {a.items.length ? <ul className="rows">{a.items.map((i) => <Row key={`${i.visit.id}:${i.slot}`} item={i} />)}</ul> : <p className="text-[13.5px] text-slate-600">No bookings to cover in these dates.</p>}
            </Card>
          ))}
          {board.flagged.length ? (
            <Card title="Flagged after an HR change" className="mb-3">
              <ul className="rows">{board.flagged.map((i) => <Row key={`${i.visit.id}:${i.slot}`} item={i} />)}</ul>
            </Card>
          ) : null}
          {canEdit ? <p className="text-[12.5px] text-slate-500">{SCORE_NOTE}{board.items.length > SUGGEST ? ` Replacements are suggested for the first ${SUGGEST} bookings; open a visit for the rest.` : ""}</p> : null}
        </>
      ) : (
        <Card><Empty>No absences or flagged bookings in these dates.</Empty></Card>
      )}
    </>
  );
}
