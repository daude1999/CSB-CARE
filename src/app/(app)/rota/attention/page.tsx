import { redirect } from "next/navigation";
import { Alarm, ArrowClockwise, ChatCircleText, ClockCounterClockwise, Info, PhoneX, UserPlus } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { ATTENTION_TYPES, attentionQueue, GROUP_LABEL, groupAttention, missedFilters, TYPE_LABEL, type AbsentEntry, type AttentionItem, type AttentionQueue, type AttentionType, type CommsEntry, type MissedEntry, type ProblemEntry, type UnassignedEntry } from "@/server/rota/attention-queue";
import { STAGE_LABEL } from "@/server/rota/missed-calls";
import { SU_INFORMED } from "@/server/rota/missed-cover";
import { communicationView, telHref } from "@/server/rota/cover-communication";
import { coverWorkspaceOrMessage, RANK_LABEL } from "@/server/rota/replacement-cover";
import type { Candidate } from "@/server/rota/queries";
import { Flash } from "@/components/ui";
import { DrawerShell } from "@/components/drawer-shell";
import { AutoSubmitForm } from "@/components/auto-submit";
import { coverHref, ReplacementCoverPanel } from "@/components/replacement-cover";
import { AttentionQueueList, NarrowOnly, type QueueGroup, type QueueRow } from "@/components/attention-queue";
import { TYPE_STYLE } from "@/components/attention-style";
import { AutoStatusBadge } from "@/components/missed-auto-ui";
import { CLASSIFICATION_LABEL } from "@/server/rota/missed-auto/suggest";

export const dynamic = "force-dynamic";

const BASE = "/rota/attention";
type Filter = "now" | AttentionType;
type Keep = Record<string, string | undefined>;

const PRIMARY = "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-module bg-module px-3.5 text-[14px] font-semibold text-white no-underline hover:bg-[#4c2398] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module";
const OUTLINE = "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-module bg-white px-3.5 text-[14px] font-semibold text-module no-underline hover:bg-[#f6f2fd] hover:text-[#4c2398] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module";
const TEXT_LINK = "text-[14.5px] font-semibold text-module no-underline hover:text-[#4c2398] hover:underline";

const qs = (p: Keep) => {
  const u = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  return u.size ? `${BASE}?${u}` : BASE;
};

/**
 * Visits Needing Attention: the office's one to-do list of every visit that needs a decision (unassigned visits,
 * bookings held by a carer who is off, open missed calls, other visit problems from the Exceptions register and
 * communication still owed after cover), with the selected item's details and actions on the right. Nothing here has
 * its own rules: the rows come from the same services as the full registers, with the same permissions, and every
 * action opens that register's own workflow. The Monitor stays the live view of what is happening now.
 */
export default async function AttentionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view") && !hasOrgPermission(ctx, "rota.monitor")) redirect(rotaHome(ctx));

  const queue = await attentionQueue(ctx, { branch: sp.branch });
  const { can, counts } = queue;
  const visible = (t: AttentionType) => can[t];
  const filter: Filter | null = sp.type === "now" || (ATTENTION_TYPES.includes(sp.type as AttentionType) && visible(sp.type as AttentionType)) ? (sp.type as Filter) : null;
  const list = queue.items.filter((i) => (filter === "now" ? i.group === "now" : filter ? i.type === filter : true));
  const groups = groupAttention(list);
  const ordered = groups.flatMap((g) => g.items);
  const picked = sp.item ? queue.items.find((i) => i.key === sp.item) ?? null : null;
  // With nothing chosen, a wide screen shows the first item's details; a narrow one shows the list only.
  const selected = picked ?? ordered[0] ?? null;
  const keep: Keep = { type: filter ?? undefined, branch: queue.branch ?? undefined, item: selected?.key };
  const listKeep: Keep = { type: filter ?? undefined, branch: queue.branch ?? undefined };

  const rows: QueueGroup[] = groups.map((g) => ({ group: g.group, label: GROUP_LABEL[g.group], rows: g.items.map((i) => toRow(i, selected?.key === i.key, listKeep, can.edit, queue.today)) }));
  const detail = selected ? await detailData(ctx, selected) : null;

  return (
    <div className="daily-rota">
      <ModuleHeader
        title="Visits Needing Attention"
        description="One queue for every visit that needs a decision, most urgent first."
        actions={
          <>
            <span className="text-[14px] tabular-nums text-white/88" data-testid="attention-updated">Updated {londonTime(queue.now)}</span>
            <Link href={qs(sp.item ? keep : listKeep)} scroll={false} className="mh-btn"><ArrowClockwise size={16} aria-hidden />Refresh</Link>
          </>
        }
      />
      <Flash searchParams={sp} />

      <nav aria-label="Filter the queue" className="mb-4 grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4">
        <Tile href={qs({ ...listKeep, type: "now" })} current={filter === "now"} tone="red" icon={<Alarm size={24} weight="bold" />} label="Act now" value={counts.now} hint={`Overdue or due within 4 hours`} testId="attention-now" />
        {can.unassigned ? <Tile href={qs({ ...listKeep, type: "unassigned" })} current={filter === "unassigned"} tone="amber" icon={<UserPlus size={24} weight="bold" />} label="Unassigned" value={counts.unassigned} hint="Visits short of a carer this week" testId="attention-unassigned" /> : null}
        {can.missed ? <Tile href={qs({ ...listKeep, type: "missed" })} current={filter === "missed"} tone="red" icon={<PhoneX size={24} weight="bold" />} label="Missed calls" value={counts.missed} hint={`Open cases still to investigate`} testId="attention-missed" /> : null}
        {can.comms ? <Tile href={qs({ ...listKeep, type: "comms" })} current={filter === "comms"} tone="blue" icon={<ChatCircleText size={24} weight="bold" />} label="Communication" value={counts.comms} hint="People to tell about cover" testId="attention-comms" /> : null}
      </nav>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <AttentionQueueList
          groups={rows}
          empty="Nothing needs attention here."
          toolbar={<Toolbar queue={queue} filter={filter} listKeep={listKeep} />}
          filters={<BranchFilter queue={queue} listKeep={listKeep} />}
          footer={<QueueFooter queue={queue} />}
        />
        <aside aria-label="Selected item" className="hidden xl:sticky xl:top-4 xl:block">
          <div aria-live="polite">
            {selected && detail ? <Detail item={selected} data={detail} keep={keep} can={can} today={queue.today} idPrefix="attn-d" /> : <div className="rounded-[14px] border border-[#eaecf0] bg-white px-5 py-10 text-center text-[15px] text-[#475467]">Nothing needs attention here.</div>}
          </div>
        </aside>
      </div>

      {picked && detail && !sp.cover ? (
        <NarrowOnly>
          <DrawerShell closeHref={qs(listKeep)} labelledBy="attn-m-title" step={picked.key}>
            <div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-3">
              <span className="text-[14px] font-semibold text-[#475467]">Selected item</span>
              <Link href={qs(listKeep)} scroll={false} aria-label="Close details" className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-[20px] leading-none text-slate-600 no-underline hover:bg-slate-100">×</Link>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" data-scroll aria-live="polite">
              <Detail item={picked} data={detail} keep={keep} can={can} today={queue.today} idPrefix="attn-m" bare />
            </div>
          </DrawerShell>
        </NarrowOnly>
      ) : null}

      {sp.cover && can.edit ? <ReplacementCoverPanel ctx={ctx} sp={sp} basePath={BASE} keep={keep} /> : null}
    </div>
  );
}

// ── Tiles and toolbar ───────────────────────────────────────────────────

const TILE_TONE = {
  red: { icon: "bg-[#fdecec] text-[#b42318]", value: "text-[#b42318]", on: "border-[#f2b8b5] bg-[#fef6f5]" },
  amber: { icon: "bg-[#fdf3d8] text-[#8a5a00]", value: "text-[#8a5a00]", on: "border-[#ecd28b] bg-[#fffaeb]" },
  blue: { icon: "bg-[#eef4ff] text-[#1d4f91]", value: "text-[#1d4f91]", on: "border-[#b2ccf2] bg-[#f5f8ff]" },
} as const;

function Tile({ href, current, tone, icon, label, value, hint, testId }: { href: string; current: boolean; tone: keyof typeof TILE_TONE; icon: React.ReactNode; label: string; value: number; hint: string; testId: string }) {
  const t = TILE_TONE[tone];
  return (
    <Link href={href} scroll={false} aria-current={current ? "true" : undefined} data-testid={testId} className={`flex items-center gap-3.5 rounded-[14px] border px-4 py-4 text-inherit no-underline hover:border-[#c7b8ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module ${current ? t.on : "border-[#eaecf0] bg-white"}`}>
      <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] ${t.icon}`}>{icon}</span>
      <span className="shrink-0">
        <span className="block whitespace-nowrap text-[15px] font-semibold text-[#101828]">{label}</span>
        <span className={`block text-[28px] font-bold leading-8 tabular-nums ${value ? t.value : "text-[#101828]"}`} data-testid={`${testId}-count`}>{value}</span>
      </span>
      <span className="ml-auto min-w-0 max-w-[140px] text-right text-[13px] leading-snug text-[#475467]">{hint}</span>
    </Link>
  );
}

function Toolbar({ queue, filter, listKeep }: { queue: AttentionQueue; filter: Filter | null; listKeep: Keep }) {
  const { can, counts } = queue;
  const tabs: { key: Filter | null; label: string; n: number }[] = [
    { key: null, label: "All", n: counts.all },
    ...(can.unassigned ? [{ key: "unassigned" as const, label: "Unassigned", n: counts.unassigned }] : []),
    ...(can.absent ? [{ key: "absent" as const, label: "Carer off", n: counts.absent }] : []),
    ...(can.missed ? [{ key: "missed" as const, label: "Missed calls", n: counts.missed }] : []),
    ...(can.problem ? [{ key: "problem" as const, label: "Visit problems", n: counts.problem }] : []),
    ...(can.comms ? [{ key: "comms" as const, label: "Communication", n: counts.comms }] : []),
  ];
  return (
      <nav aria-label="Kind of work" className="flex flex-wrap gap-0.5 rounded-[10px] bg-[#f2f4f7] p-1">
        {tabs.map((t) => {
          const on = filter === t.key;
          return (
            <Link key={t.label} href={qs({ ...listKeep, type: t.key ?? undefined })} scroll={false} aria-current={on ? "page" : undefined} className={`rounded-[8px] px-3 py-1.5 text-[14.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-module ${on ? "bg-white text-[#101828] shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "text-[#475467] hover:text-[#101828]"}`}>
              {t.label} <span className="font-normal tabular-nums text-[#667085]">{t.n}</span>
            </Link>
          );
        })}
      </nav>
  );
}

function BranchFilter({ queue, listKeep }: { queue: AttentionQueue; listKeep: Keep }) {
  if (queue.branches.length < 2) return null;
  return (
        <AutoSubmitForm label="Branch" className="shrink-0">
          {listKeep.type ? <input type="hidden" name="type" value={listKeep.type} /> : null}
          <label>
            <span className="sr-only">Branch</span>
            <select name="branch" defaultValue={queue.branch ?? ""} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14.5px] text-[#344054] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module">
              <option value="">All branches</option>
              {queue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </AutoSubmitForm>
  );
}

function QueueFooter({ queue }: { queue: AttentionQueue }) {
  const { can } = queue;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#eaecf0] px-4 py-3 text-[14px]">
      <span className="mr-auto text-[#475467]">Unassigned visits and carer-off bookings for the next 7 days; open missed calls from the last 30 days; open visit problems.</span>
      {can.unassigned ? <Link href="/rota/unassigned?when=week" className="font-semibold">Open Unassigned Visits</Link> : null}
      {can.absent ? <Link href="/rota/cover" className="font-semibold">Open Sickness &amp; Holiday Cover</Link> : null}
      {can.missed ? <Link href={`/rota/missed?${new URLSearchParams(missedFilters(queue.today, queue.branch ?? undefined))}`} className="font-semibold">Open Missed Calls</Link> : null}
      {can.problem ? <Link href="/rota/exceptions" className="font-semibold">Open Exceptions</Link> : null}
      {can.unassigned ? <Link href="/rota/unassigned?tab=history" className="inline-flex items-center gap-1 font-semibold"><ClockCounterClockwise size={16} aria-hidden />Coverage History</Link> : null}
    </div>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────

function dayLabel(date: string, today: string) {
  return date === today ? "Today" : fmtLondonDate(date, { weekday: "short", day: "numeric", month: "short" });
}

function toRow(i: AttentionItem, selected: boolean, listKeep: Keep, canEdit: boolean, today: string): QueueRow {
  const time = londonTime(i.start);
  const base = { key: i.key, type: i.type, time, day: dayLabel(i.date, today), serviceUser: i.serviceUser, callType: i.callType, reason: i.reason, selected };
  const name = `${i.serviceUser}, ${i.callType ? `${i.callType.toLowerCase()} ` : ""}${time}, ${TYPE_LABEL[i.type].toLowerCase()}`;
  const search = `${i.serviceUser} ${i.type === "missed" || i.type === "absent" ? i.carerName ?? "" : ""} ${i.reason} ${i.reference}`.toLowerCase();
  const selectHref = qs({ ...listKeep, item: i.key });
  const rowKeep = { ...listKeep, item: i.key };
  let action: QueueRow["action"] = null;
  if (i.type === "unassigned") action = canEdit ? { label: "Find cover", href: coverHref(BASE, rowKeep, { id: i.id }), aria: `Find cover for ${i.serviceUser} at ${time}: recommended carers` } : { label: "View", href: `/rota/visits?date=${i.date}&visit=${i.visitId}`, aria: `View ${i.serviceUser}'s visit at ${time}` };
  else if (i.type === "absent") action = canEdit ? { label: "Find cover", href: coverHref(BASE, rowKeep, { id: i.visitId, mode: "replace", slot: i.slot }), aria: `Find replacement cover for ${i.carerName} on ${i.serviceUser}'s visit at ${time}` } : { label: "View", href: `/rota/visits?date=${i.date}&visit=${i.visitId}`, aria: `View ${i.serviceUser}'s visit at ${time}` };
  else if (i.type === "missed") action = { label: "Investigate", href: `/rota/missed/${i.id}`, aria: `Investigate ${i.reference}` };
  else if (i.type === "problem") action = { label: "Resolve", href: problemHref(i), aria: `Resolve ${i.kindLabel.toLowerCase()} for ${i.serviceUser}, ${i.reference}` };
  else action = { label: "Contact", href: coverHref(BASE, rowKeep, i.caseId ? { id: i.caseId, mode: "recovery", tab: "comms" } : { id: i.visitId, tab: "comms" }), aria: `Record communication for ${i.serviceUser}, ${i.reference}` };
  return { ...base, name, search, selectHref, action };
}

/** The exception in the Exceptions register, where it is given an owner and resolved. */
const problemHref = (i: ProblemEntry) => `/rota/exceptions?kind=${encodeURIComponent(i.kind)}#exception-${i.id}`;

// ── Detail panel ────────────────────────────────────────────────────────

type DetailData =
  | { type: "unassigned"; recommended: (Candidate & { areas?: string[] })[]; blocked: string | null }
  | { type: "missed" }
  | { type: "absent" }
  | { type: "problem" }
  | { type: "comms"; arrangement: string | null; phone: string | null; phoneName: string | null };

async function detailData(ctx: Ctx, item: AttentionItem): Promise<DetailData> {
  if (item.type === "unassigned") {
    if (!hasOrgPermission(ctx, "rota.edit")) return { type: "unassigned", recommended: [], blocked: null };
    const ws = await coverWorkspaceOrMessage(ctx, { id: item.id, mode: "fill" });
    if ("error" in ws) return { type: "unassigned", recommended: [], blocked: ws.error };
    return { type: "unassigned", recommended: ws.recommended, blocked: ws.blocked };
  }
  if (item.type === "missed" || item.type === "absent" || item.type === "problem") return { type: item.type };
  const view = await communicationView(ctx, { visitId: item.visitId, caseId: item.caseId }).catch(() => null);
  const su = view?.contacts?.serviceUser;
  const contact = view?.contacts?.contacts.find((c) => c.isPrimary && c.phone);
  const phone = su?.phone ?? contact?.phone ?? null;
  return { type: "comms", arrangement: view?.arrangementText ?? null, phone, phoneName: su?.phone ? su.name : contact ? `${contact.name}${contact.relationship ? ` (${contact.relationship})` : ""}` : null };
}

const WHY_TONE = { unassigned: "bg-[#fdf6e3] text-[#7a5200]", absent: "bg-[#f6f2fd] text-[#4c2398]", missed: "bg-[#fef3f2] text-[#912018]", problem: "bg-[#fff6ed] text-[#9a3412]", comms: "bg-[#f0f5ff] text-[#1d4f91]" } as const;
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function Detail({ item, data, keep, can, today, idPrefix, bare = false }: { item: AttentionItem; data: DetailData; keep: Keep; can: AttentionQueue["can"]; today: string; idPrefix: string; bare?: boolean }) {
  const s = TYPE_STYLE[item.type];
  const why = item.type === "absent" ? `${sentence(item.reason)}. The visit keeps its booking until someone chooses a replacement.` : item.type === "problem" ? `${sentence(item.message.replace(/[.\s]+$/, ""))}. ${item.owner ? `Owner: ${item.owner}.` : "No owner yet."}` : item.type === "unassigned" ? `${item.why}. ${sentence(item.reason)}${item.required > 1 ? ` (${item.filled} of ${item.required} carers booked)` : ""}.` : item.type === "missed" ? (item.warnings.length ? `${sentence(item.warnings.join(", "))}. ${item.carerName ? `${item.carerName} was booked.` : "No carer was booked."}` : `${STAGE_LABEL[item.stage]}. ${item.carerName ? `${item.carerName} was booked.` : "No carer was booked."}`) : `${item.stateLabel}. Responsible: ${item.owner}.`;
  return (
    <section aria-labelledby={`${idPrefix}-title`} className={bare ? "" : "overflow-hidden rounded-[14px] border border-[#eaecf0] bg-white"} data-testid="attention-detail" data-item={item.key}>
      <div className="border-b border-[#eaecf0] px-5 pb-4 pt-4">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium ${s.chip}`}>{s.label}</span>
          <span className="text-[13.5px] font-semibold tracking-[0.02em] text-[#475467]">{item.reference}</span>
        </p>
        <h2 id={`${idPrefix}-title`} className="mt-2 text-[22px] font-bold leading-tight text-[#1b1340]">{item.serviceUser}</h2>
        <p className="mt-1 text-[14.5px] text-[#475467]">{[dayLabel(item.date, today), londonTime(item.start), item.callType, item.area].filter(Boolean).join(" · ")}</p>
        <p className={`mt-3 flex gap-2 rounded-[10px] px-3.5 py-2.5 text-[14px] leading-snug ${WHY_TONE[item.type]}`}><Info size={18} aria-hidden className="mt-px shrink-0" /><span>{why}</span></p>
      </div>
      {item.type === "unassigned" && data.type === "unassigned" ? <UnassignedDetail item={item} data={data} keep={keep} canEdit={can.edit} /> : null}
      {item.type === "absent" ? <AbsentDetail item={item} keep={keep} canEdit={can.edit} /> : null}
      {item.type === "missed" ? <MissedDetail item={item} keep={keep} canEdit={can.edit} /> : null}
      {item.type === "problem" ? <ProblemDetail item={item} /> : null}
      {item.type === "comms" && data.type === "comms" ? <CommsDetail item={item} data={data} keep={keep} /> : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[#eaecf0] px-5 py-3.5">
        <Link href={`/rota/visits?date=${item.date}&visit=${item.visitId}`} className={TEXT_LINK}>Open visit</Link>
        <Link href={`/rota/service-users/${item.serviceUserId}`} className={TEXT_LINK}>Care plan</Link>
      </div>
    </section>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function UnassignedDetail({ item, data, keep, canEdit }: { item: UnassignedEntry; data: Extract<DetailData, { type: "unassigned" }>; keep: Keep; canEdit: boolean }) {
  if (!canEdit) return <p className="px-5 py-4 text-[14px] text-[#475467]">You can see this visit, but booking a carer needs rota editing access.</p>;
  const cover = coverHref(BASE, keep, { id: item.id });
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-bold text-[#1b1340]">Recommended carers</h3>
        <span className="text-[13.5px] text-[#475467]">Eligible, best match first</span>
      </div>
      {data.blocked ? <p role="status" className="rounded-[8px] bg-[#f2f4f7] px-3 py-2 text-[14px] text-[#344054]">{data.blocked}</p> : data.recommended.length ? (
        <ul className="space-y-2.5" aria-label="Recommended carers">
          {data.recommended.map((c, rank) => {
            const area = c.explain.some((e) => e.text === "works in this area");
            const facts = [c.state === "REQUIRES_REVIEW" ? "Check warnings first" : "Free at this time", area ? "works in this area" : null, c.continuity ? `knows ${item.serviceUser.split(" ")[0]}` : null, `${c.weekHours} h this week`].filter(Boolean).join(" · ");
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-[12px] border border-[#eaecf0] px-3.5 py-3" data-testid="attention-carer">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efeafc] text-[13.5px] font-bold text-module">{initials(c.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-[#3b1f99]">{c.name}</span>
                  <span className="block text-[13px] leading-snug text-[#475467]">{facts}</span>
                </span>
                {c.score !== null ? <span title={`${RANK_LABEL[rank] ?? "Suitable"}: match score from the eligibility ranking`} className="rounded-full bg-[#e3f6ea] px-2 py-0.5 text-[13px] font-semibold tabular-nums text-[#1e6b2c]">{c.score}%<span className="sr-only"> match</span></span> : null}
                <Link href={`${cover}&fcStep=review&fcStaff=${c.id}&fcSrc=RECOMMENDED`} scroll={false} className={`${OUTLINE} h-8 px-3`} aria-label={`Assign ${c.name} to ${item.serviceUser} at ${londonTime(item.start)}: review and confirm`}>Assign</Link>
              </li>
            );
          })}
        </ul>
      ) : <p className="rounded-[8px] bg-[#f2f4f7] px-3 py-2 text-[14px] text-[#344054]">No eligible carer is free at this time. Choose a carer by hand to see everyone and why.</p>}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href={`${cover}&fcStep=manual`} scroll={false} className={TEXT_LINK} aria-label={`Choose a carer by hand for ${item.serviceUser} at ${londonTime(item.start)}`}>Choose a carer by hand</Link>
        <Link href={cover} scroll={false} className={TEXT_LINK}>Open Find Cover</Link>
      </div>
    </div>
  );
}

function MissedDetail({ item, keep, canEdit }: { item: MissedEntry; keep: Keep; canEdit: boolean }) {
  const c = item.checks;
  const told = c.informed === "INFORMED" || c.informed === "REPRESENTATIVE_INFORMED" || c.informed === "RECORDED";
  const steps = [
    { done: true, label: "Missed call confirmed", meta: `Found ${fmtLondonDate(londonDate(c.detectedAt), { day: "numeric", month: "short" })} ${londonTime(c.detectedAt)}` },
    { done: told, label: "Service user safe and contacted", meta: c.informed && c.informed !== "RECORDED" ? SU_INFORMED[c.informed] ?? c.informed : told ? "Recorded on the case" : "Not recorded yet" },
    { done: c.reasonRecorded, label: "Reason recorded", meta: c.reasonRecorded ? "Recorded" : item.overdue ? "Past the investigation deadline" : "Not recorded yet" },
    { done: c.signedOff, label: "Manager sign-off", meta: c.signedOff ? "Signed off" : c.submitted ? "Waiting for sign-off" : "Not submitted yet" },
  ];
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-bold text-[#1b1340]">Investigation</h3>
        <span className="text-[13.5px] text-[#475467]">{STAGE_LABEL[item.stage]}</span>
      </div>
      <ol className="space-y-2" aria-label="Investigation stages">
        {steps.map((st) => (
          <li key={st.label} className="flex items-start gap-2.5 text-[14px]">
            <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${st.done ? "bg-[#e3f6ea] text-[#1e6b2c]" : "border border-[#d0d5dd] bg-white text-transparent"}`}>✓</span>
            <span><span className="sr-only">{st.done ? "Done: " : "To do: "}</span><b className="font-semibold text-[#101828]">{st.label}</b><span className="block text-[13px] text-[#475467]">{st.meta}</span></span>
          </li>
        ))}
      </ol>
      {item.auto ? <AutoBlock item={item} /> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/rota/missed/${item.id}`} className={PRIMARY} aria-label={`${c.reasonRecorded ? "Open the case" : "Record reason"} for ${item.reference}`}>{c.reasonRecorded ? "Open the case" : "Record reason"}</Link>
        {item.cover?.canFind && canEdit ? <Link href={coverHref(BASE, keep, { id: item.id, mode: "recovery" })} scroll={false} className={OUTLINE} aria-label={`Find recovery cover for ${item.reference}`}><UserPlus size={16} aria-hidden />Find recovery cover</Link> : null}
        {item.cover?.kind === "booked" ? <span className="rounded-full bg-[#e3f6ea] px-2.5 py-0.5 text-[13px] font-semibold text-[#1e6b2c]">Cover booked</span> : null}
      </div>
      {item.cover && !item.cover.canFind && item.cover.kind !== "booked" ? <p className="mt-2 text-[13px] text-[#475467]">{item.cover.text}</p> : null}
    </div>
  );
}

/** The automated investigation's progress for the selected missed call. Its own status, never the case's stage. */
function AutoBlock({ item }: { item: MissedEntry }) {
  const a = item.auto!;
  return (
    <section className="mt-4 rounded-[10px] border border-[#e4e7ec] bg-[#fcfcfd] px-3.5 py-3" aria-labelledby={`auto-${item.id}`} data-testid="attention-auto">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 id={`auto-${item.id}`} className="mr-auto text-[14.5px] font-bold text-[#1b1340]">Automated investigation</h4>
        <AutoStatusBadge status={a.status} label={a.label} />
      </div>
      <dl className="grid grid-cols-[minmax(0,9.5rem)_1fr] gap-x-3 gap-y-1 text-[13.5px]">
        <dt className="text-[#475467]">Carer confirmation</dt><dd className="text-[#101828]">{a.carer}</dd>
        <dt className="text-[#475467]">Suggested reason</dt><dd className="text-[#101828]">{a.suggestion ? CLASSIFICATION_LABEL[a.suggestion] : "None yet"}</dd>
        <dt className="text-[#475467]">Missing information</dt><dd className="text-[#101828]">{a.missing ? `${a.missing} item${a.missing === 1 ? "" : "s"} to check` : "None listed"}</dd>
        <dt className="text-[#475467]">Last updated</dt><dd className="text-[#101828]">{a.updatedAt ? `${londonTime(a.updatedAt)}, ${fmtLondonDate(londonDate(a.updatedAt), { day: "numeric", month: "short" })}` : "Not yet"}</dd>
      </dl>
      <Link href={`/rota/missed/${item.id}#auto-heading`} className={`${TEXT_LINK} mt-2 inline-block`} aria-label={`View the automated investigation for ${item.reference}`}>View investigation</Link>
    </section>
  );
}

function AbsentDetail({ item, keep, canEdit }: { item: AbsentEntry; keep: Keep; canEdit: boolean }) {
  if (!canEdit) return <p className="px-5 py-4 text-[14px] text-[#475467]">You can see this booking, but choosing a replacement needs rota editing access.</p>;
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-[16px] font-bold text-[#1b1340]">Replacement</h3>
      <p className="text-[14px] text-[#344054]">{item.carerName} is booked{item.doubleUp ? " on this double-up" : ""}. Nothing moves by itself: choose a replacement and the full eligibility check runs again.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={coverHref(BASE, keep, { id: item.visitId, mode: "replace", slot: item.slot })} scroll={false} className={PRIMARY} aria-label={`Find replacement cover for ${item.carerName} on ${item.serviceUser}'s visit at ${londonTime(item.start)}`}><UserPlus size={16} aria-hidden />Find replacement</Link>
        <Link href={`/rota/staff/${item.staffId}`} className={TEXT_LINK}>{item.carerName}&apos;s rota record</Link>
      </div>
    </div>
  );
}

function ProblemDetail({ item }: { item: ProblemEntry }) {
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-bold text-[#1b1340]">{item.kindLabel}</h3>
        <span className="text-[13.5px] text-[#475467]">{item.deadline ? `Deadline ${fmtLondonDate(londonDate(item.deadline), { day: "numeric", month: "short" })} ${londonTime(item.deadline)}${item.overdue ? " (passed)" : ""}` : "No deadline"}</span>
      </div>
      <p className="text-[14px] text-[#344054]">Give it an owner and record how it was resolved in the Exceptions register. Anything past its deadline goes to the care managers inside the platform.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={problemHref(item)} className={PRIMARY} aria-label={`Resolve ${item.kindLabel.toLowerCase()} for ${item.serviceUser}, ${item.reference}`}>Resolve</Link>
      </div>
    </div>
  );
}

function CommsDetail({ item, data, keep }: { item: CommsEntry; data: Extract<DetailData, { type: "comms" }>; keep: Keep }) {
  const tel = telHref(data.phone);
  const sms = tel ? tel.replace(/^tel:/, "sms:") : null;
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-[16px] font-bold text-[#1b1340]">Replacement</h3>
      <p className="text-[14px] text-[#344054]">{data.arrangement ?? "The arrangements could not be loaded."}</p>
      <p className="mt-1 text-[13.5px] text-[#475467]">{item.followUp ? "Follow-up due" : "Due"} {fmtLondonDate(londonDate(item.dueAt), { day: "numeric", month: "short" })} {londonTime(item.dueAt)}{item.overdue ? " (overdue)" : ""}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tel ? <a href={tel} className={OUTLINE} aria-label={`Call ${data.phoneName}`}>Call</a> : null}
        {sms ? <a href={sms} className={OUTLINE} aria-label={`Text ${data.phoneName}`}>Text</a> : null}
        <Link href={coverHref(BASE, keep, item.caseId ? { id: item.caseId, mode: "recovery", tab: "comms" } : { id: item.visitId, tab: "comms" })} scroll={false} className={PRIMARY} aria-label={`Record communication for ${item.serviceUser}, ${item.reference}`}>Record communication</Link>
      </div>
      <p className="mt-2 text-[13px] text-[#475467]">{tel ? `Calling or texting ${data.phoneName} happens on your phone; record what was said here.` : "No dialable phone number is recorded for the service user or their main contact."}</p>
    </div>
  );
}
