import type { ReactNode } from "react";
import Link from "@/components/link";
import { ArrowsOut, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { PortalId } from "@/lib/portals";

/**
 * Harbour's shared building blocks (docs/design/harbour, owner's decision of 13 Nov 2026). Class names and values follow
 * docs/design/harbour/prototype/clearcare.css; the styles are in src/app/harbour.css. These are presentation only:
 * every button they draw is passed in by the page and maps to an action that already exists. Nothing here fetches data.
 */

/** Panel title-bar colours, picked by meaning (all take white text at WCAG AA). */
export type PanelColour = "module" | "blue" | "rose" | "red" | "amber" | "teal" | "green" | "navy" | "cyan" | "orange" | "purple";

/* ---------- SubTabs ---------- */

export type SubTab = { label: string; href: string; current?: boolean };

/** The pill strip under the top bar for grouped pages. The shell draws Care & Rostering's; other pages can draw their own. */
export function SubTabs({ label, tabs, module, testId }: { label: string; tabs: SubTab[]; module?: PortalId; testId?: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={`${label} pages`} className="hb-stabs" data-hb-module={module} data-testid={testId}>
      <span className="hb-stabs-t" aria-hidden="true">{label}</span>
      {tabs.map((t) => <Link key={t.href} href={t.href} className="hb-stab" aria-current={t.current ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}

/* ---------- PageHeader ---------- */

/** The light blue band at the top of a module page: module icon, module name, a 20px title and one plain-English line. */
export function PageHeader({ module, moduleName, icon, title, description, actions, titleId }: {
  module: PortalId;
  moduleName: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions on the right; give the main one `hb-btn hb-btn-p`. */
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="hb-fh" data-hb-module={module} data-testid="page-header">
      <span className="hb-fh-ic" aria-hidden="true">{icon}</span>
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="hb-fh-c">{moduleName}</p>
        <h1 id={titleId}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="hb-fh-a">{actions}</div> : null}
    </header>
  );
}

/* ---------- StatTiles ---------- */

export type StatTile = {
  key: string;
  label: string;
  /** From an existing query; never a made-up figure. */
  value: number | string;
  icon: ReactNode;
  /** The tile's colour (icon square, and the number for warning colours). */
  colour: string;
  /** Number colour, when it should carry the tile's meaning (red for a problem). */
  numberColour?: string;
  /** Clicking a tile filters the main table to these rows. */
  href: string;
  active?: boolean;
};

/** A row of clickable count tiles; clicking one filters the table, and "Show all" clears the filter. */
export function StatTiles({ tiles, showAllHref, label = "Filter by count" }: { tiles: StatTile[]; showAllHref?: string; label?: string }) {
  if (!tiles.length) return null;
  const filtered = tiles.some((t) => t.active);
  return (
    <div>
      <ul className="hb-tiles" aria-label={label}>
        {tiles.map((t, n) => (
          <li key={t.key} className="contents">
            <Link href={t.href} className="hb-tile" aria-current={t.active ? "true" : undefined} style={{ "--t": t.colour, "--tn": t.numberColour, "--hb-i": n } as React.CSSProperties} data-testid={`stat-${t.key}`}>
              <span className="hb-tile-ic" aria-hidden="true">{t.icon}</span>
              <span className="min-w-0"><b>{t.value}</b><span>{t.label}</span></span>
            </Link>
          </li>
        ))}
      </ul>
      {filtered && showAllHref ? <p className="mt-1.5 text-right text-[13px]"><Link href={showAllHref} className="text-[var(--hb-link)] underline underline-offset-2">Show all</Link></p> : null}
    </div>
  );
}

/* ---------- Panel ---------- */

export type PanelTool = {
  /** Add, Export, Edit selected, Remove selected, Pin or More: only those with a real action behind them. */
  label: string;
  icon: ReactNode;
  href?: string;
  /** A submit button for a form on the page (bulk actions), by the form's id. */
  form?: string;
  name?: string;
  value?: string;
  /** "More" sits at the far right. */
  more?: boolean;
};

/**
 * A white panel with a solid coloured 34px title bar: icon, title, an optional count, an optional text action, and
 * an "Open full screen" button that opens the panel's existing full page. Under the bar: optional tools, an optional
 * filter row, the body and an optional footer.
 */
export function Panel({ title, icon, colour = "module", count, action, fullHref, tools, filters, footer, flush = false, index = 0, children, id, className = "", testId }: {
  title: ReactNode;
  icon?: ReactNode;
  colour?: PanelColour;
  count?: number;
  /** A text action in the title bar (an existing link or button). */
  action?: ReactNode;
  /** The panel's existing full page, or a larger view of the same data. UI only. */
  fullHref?: string;
  tools?: PanelTool[];
  filters?: ReactNode;
  footer?: ReactNode;
  /** No padding round the body (tables). */
  flush?: boolean;
  /** Position among its siblings, for the staggered entrance (capped at 8). */
  index?: number;
  children: ReactNode;
  id?: string;
  className?: string;
  testId?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`hb-pn ${colour === "module" ? "" : `hb-c-${colour}`} ${className}`} style={{ "--hb-i": index } as React.CSSProperties} data-testid={testId}>
      <div className="hb-pn-h">
        {icon ? <span aria-hidden="true" className="flex">{icon}</span> : null}
        <h2 id={headingId}>{title}</h2>
        {count !== undefined ? <span className="hb-pn-cnt" aria-label={`${count} ${count === 1 ? "item" : "items"}`}>{count}</span> : null}
        <span className="hb-sp" />
        {action}
        {fullHref ? (
          <Link href={fullHref} className="hb-pn-x" aria-label={`Open ${typeof title === "string" ? title : "this panel"} full screen`} title="Open full screen">
            <ArrowsOut size={12} weight="bold" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {tools?.length ? <PanelTools tools={tools} /> : null}
      {filters ? <div className="hb-pn-tb">{filters}</div> : null}
      <div className="hb-pn-b" data-flush={flush ? "" : undefined}>{children}</div>
      {footer ? <div className="hb-pn-f">{footer}</div> : null}
    </section>
  );
}

/** A text action in a panel's title bar. */
export function PanelAction({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="hb-pn-act">{children}</Link>;
}

/** The icon tool row under a panel's title bar. Every tool has a tooltip and an accessible name. */
export function PanelTools({ tools }: { tools: PanelTool[] }) {
  const main = tools.filter((t) => !t.more);
  const more = tools.filter((t) => t.more);
  return (
    <div className="hb-pn-tools" role="toolbar" aria-label="Panel tools">
      {[...main, ...more].map((t, n) => {
        const props = { "aria-label": t.label, title: t.label, "data-more": t.more && n === main.length ? "" : undefined };
        if (t.href) return <Link key={t.label} href={t.href} {...props}>{t.icon}</Link>;
        return <button key={t.label} type="submit" form={t.form} name={t.name} value={t.value} {...props}>{t.icon}</button>;
      })}
    </div>
  );
}

/* ---------- StatusPill ---------- */

export type StatusTone = "ok" | "warn" | "bad" | "progress" | "neutral";

/** A tinted status pill. ok, warn and bad carry a ✓ or ! glyph, so colour is never the only signal. */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className="hb-pill" data-tone={tone}>{children}</span>;
}

/* ---------- DataTable ---------- */

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** The column's sort link, where the page already supports sorting. */
  sortHref?: string;
  sorted?: "asc" | "desc";
  className?: string;
};

/**
 * A Harbour table: a 30px header row with underlined labels (links where the page already sorts), 34-38px rows,
 * a leading tick box only where bulk actions exist, and "Showing X of Y" with Previous and Next.
 */
export function DataTable<Row>({ rows, columns, rowKey, caption, select, pager, empty }: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  caption: string;
  /** Bulk selection, only where bulk actions already exist: the tick boxes submit with this form. */
  select?: { form: string; name: string; label: (row: Row) => string };
  pager?: { shown: number; total: number; prevHref?: string; nextHref?: string };
  empty?: ReactNode;
}) {
  return (
    <div>
      <div className="min-w-0 overflow-x-auto">
        <table className="hb-tbl">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {select ? <th scope="col" className="hb-cbc"><span className="sr-only">Select</span></th> : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.className} aria-sort={c.sorted === "asc" ? "ascending" : c.sorted === "desc" ? "descending" : undefined}>
                  {c.sortHref ? <Link href={c.sortHref}>{c.header}</Link> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {select ? <td className="hb-cbc"><input type="checkbox" form={select.form} name={select.name} value={rowKey(r)} aria-label={select.label(r)} /></td> : null}
                {columns.map((c) => <td key={c.key} className={c.className}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && empty ? <div className="px-4 py-8 text-center text-[13.5px] text-[var(--hb-ink-3)]">{empty}</div> : null}
      </div>
      {pager ? (
        <nav className="hb-pager" aria-label="Pages">
          <span>Showing {pager.shown} of {pager.total}</span>
          <span className="flex gap-1.5">
            {pager.prevHref ? <Link href={pager.prevHref} className="hb-btn"><CaretLeft size={14} aria-hidden="true" />Previous</Link> : <span className="hb-btn opacity-50" aria-disabled="true"><CaretLeft size={14} aria-hidden="true" />Previous</span>}
            {pager.nextHref ? <Link href={pager.nextHref} className="hb-btn">Next<CaretRight size={14} aria-hidden="true" /></Link> : <span className="hb-btn opacity-50" aria-disabled="true">Next<CaretRight size={14} aria-hidden="true" /></span>}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
