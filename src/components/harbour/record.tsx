import type { ReactNode } from "react";
import Link from "@/components/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { RecordMenu } from "@/components/harbour/record-menu";

/**
 * Harbour record pages (docs/design/harbour/screens/service-user-record-1440.png and employee-record-1440.png):
 * a context bar, the record header, the record tabs with a Menu, and the record's panels. Presentation only: every
 * link and button here is passed in by the page and goes to something that already exists.
 */

export type ContextTool = { label: string; href: string; icon: ReactNode; testId?: string };

/** The white bar above a record: back, the record's quick actions as icons, the record's name, and its main actions. */
export function RecordContextBar({ backHref, backLabel, tools = [], kind, name, actions }: {
  backHref: string;
  backLabel: string;
  tools?: ContextTool[];
  kind: string;
  name: string;
  actions?: ReactNode;
}) {
  return (
    <div className="hb-ctx" data-testid="record-context-bar">
      <Link href={backHref} className="hb-ctx-b" aria-label={backLabel} title={backLabel}><CaretLeft size={16} weight="bold" aria-hidden="true" /></Link>
      {tools.length ? <span className="hb-ctx-v" aria-hidden="true" /> : null}
      {tools.map((t) => (
        <Link key={t.label} href={t.href} className="hb-ctx-b" aria-label={t.label} title={t.label} data-testid={t.testId}>{t.icon}</Link>
      ))}
      <p className="hb-ctx-t">{kind}: <b>{name}</b></p>
      <span className="flex-1" />
      {actions ? <div className="hb-ctx-a">{actions}</div> : null}
    </div>
  );
}

export type RecordAlert = { label: string; tone: "bad" | "warn" | "info" | "prog" | "ok"; icon: ReactNode; href?: string };

/** The light blue record header: avatar, name line, status, a few facts on the left; identifiers and alert icons on the right. */
export function RecordHeader({ initials, title, status, meta, ids, alerts = [], testId = "record-header" }: {
  initials: string;
  /** The record's name line; rendered as the page's h1. */
  title: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  ids?: ReactNode;
  alerts?: RecordAlert[];
  testId?: string;
}) {
  return (
    <header className="hb-pid" data-testid={testId}>
      <span className="hb-pid-av" aria-hidden="true">{initials}</span>
      <div className="min-w-0 flex-1 basis-[18rem]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="hb-pid-n">{title}</h1>
          {status}
        </div>
        {meta ? <div className="hb-pid-m">{meta}</div> : null}
      </div>
      {ids || alerts.length ? (
        <div className="hb-pid-r">
          {ids ? <div className="hb-pid-ids">{ids}</div> : null}
          {alerts.length ? (
            <ul className="hb-pid-al" aria-label="Alerts">
              {alerts.map((a) => (
                <li key={a.label}>
                  {a.href ? (
                    <Link href={a.href} className="hb-ai" data-tone={a.tone} aria-label={a.label} title={a.label}>{a.icon}</Link>
                  ) : (
                    <span className="hb-ai" data-tone={a.tone} role="img" aria-label={a.label} title={a.label}>{a.icon}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

export type RecordTab = { key: string; label: string; href: string; count?: number; countTone?: "bad"; current?: boolean };
export type RecordMenuItem = { label: string; href: string; testId?: string; icon?: ReactNode };

/** The record's tab row with a Menu button on the left (the record's other actions), and a pill row for a tab group. */
export function RecordTabs({ label, tabs, menu = [], subTabs = [], subLabel }: { label: string; tabs: RecordTab[]; menu?: RecordMenuItem[]; subTabs?: RecordTab[]; subLabel?: string }) {
  return (
    <div className="hb-rt-wrap">
      <div className="hb-rt">
        {menu.length ? (
          <RecordMenu>
            {menu.map((m) => (
              <li key={m.label}><Link href={m.href} className="hb-rt-pi" data-testid={m.testId}>{m.icon}{m.label}</Link></li>
            ))}
          </RecordMenu>
        ) : null}
        <nav aria-label={label} className="hb-rt-tabs">
          {tabs.map((t) => (
            <Link key={t.key} href={t.href} className="hb-rt-tab" aria-current={t.current ? "page" : undefined} data-testid={`record-tab-${t.key}`}>
              {t.label}
              {t.count !== undefined ? <span className="hb-rt-n" data-tone={t.countTone}>{t.count}</span> : null}
            </Link>
          ))}
        </nav>
      </div>
      {subTabs.length > 1 ? (
        <nav aria-label={subLabel ?? `${label} sections`} className="hb-rt-sub">
          {subTabs.map((t) => <Link key={t.key} href={t.href} className="hb-stab" aria-current={t.current ? "page" : undefined}>{t.label}</Link>)}
        </nav>
      ) : null}
    </div>
  );
}

export type QuickLink = { label: string; href: string; icon: ReactNode; colour: string; count?: number; urgent?: boolean };

/** The record's quick links: every section of the record, with a count where the page already has one. */
export function QuickLinks({ items, label = "Quick links" }: { items: QuickLink[]; label?: string }) {
  return (
    <nav aria-label={label} className="hb-qm" data-testid="quick-links">
      <ul>
        {items.map((q) => (
          <li key={q.label}>
            <Link href={q.href} className="hb-qm-a">
              <span className="hb-qm-i" style={{ background: q.colour }} aria-hidden="true">{q.icon}</span>
              <span className="min-w-0 flex-1 truncate">{q.label}</span>
              {q.count !== undefined && q.count > 0 ? <span className="hb-qm-n" data-urgent={q.urgent ? "" : undefined}>{q.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Label: value" lines, as in the reference's Person details. */
export function KeyValueList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="hb-kv">
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}:</dt> <dd>{v}</dd></div>
      ))}
    </dl>
  );
}

export type TimelineEntry = { id: string; icon: ReactNode; title: string; href?: string; when: string; text?: ReactNode; by?: string; at?: string };
export type TimelineFilter = { label: string; href: string; current?: boolean };

/** The record's timeline: newest first, grouped by month, with filter chips that link to the filtered view. */
export function Timeline({ title = "Timeline", filters = [], groups, empty, testId = "record-timeline" }: { title?: string; filters?: TimelineFilter[]; groups: { label: string; entries: TimelineEntry[] }[]; empty: ReactNode; testId?: string }) {
  return (
    <section className="hb-tl" aria-labelledby={`${testId}-h`} data-testid={testId}>
      <div className="hb-tl-h">
        <h2 id={`${testId}-h`}>{title}</h2>
        <span className="flex-1" />
        {filters.map((f) => <Link key={f.label} href={f.href} className="hb-chip" aria-current={f.current ? "true" : undefined}>{f.label}</Link>)}
      </div>
      {groups.length ? groups.map((g) => (
        <div key={g.label}>
          <p className="hb-tl-m">{g.label}</p>
          <ol>
            {g.entries.map((e) => (
              <li key={e.id} className="hb-tle">
                <span className="hb-tle-ic" aria-hidden="true">{e.icon}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    {e.href ? <Link href={e.href} className="hb-tle-t">{e.title}</Link> : <span className="hb-tle-t" data-plain="">{e.title}</span>}
                    <span className="hb-tle-w">{e.when}</span>
                  </div>
                  {e.text ? <p className="hb-tle-p">{e.text}</p> : null}
                  {e.by || e.at ? (
                    <dl className="hb-tm">
                      <div><dt>Completed by:</dt><dd>{e.by ?? "—"}</dd></div>
                      <div><dt>Date and time:</dt><dd>{e.at ?? "—"}</dd></div>
                    </dl>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )) : <p className="px-4 py-8 text-center text-[13.5px] text-[var(--hb-ink-3)]">{empty}</p>}
    </section>
  );
}

/** A masked sensitive value with a Show link. The real value is only in the page when `shown` is true. */
export function Masked({ shown, value, mask, showHref, hideHref, label }: { shown: boolean; value: ReactNode; mask: ReactNode; showHref: string; hideHref: string; label: string }) {
  return shown ? (
    <span>{value} <Link href={hideHref} className="hb-show" aria-label={`Hide ${label}`}>Hide</Link></span>
  ) : (
    <span><span aria-label={`${label} hidden`}>{mask}</span> <Link href={showHref} className="hb-show" aria-label={`Show ${label}`}>Show</Link></span>
  );
}
