import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, Panel, PanelTools, StatTiles, StatusPill, SubTabs } from "@/components/harbour/ui";
import { tipKey } from "@/components/harbour/how-this-works";
import { readFileSync } from "node:fs";

/** The Harbour shared components (docs/design/harbour): presentation only, every button passed in by the page. */
describe("Harbour shared components", () => {
  it("StatusPill carries its tone so ok, warn and bad get a ✓ or ! glyph, never colour alone", () => {
    for (const tone of ["ok", "warn", "bad", "progress", "neutral"] as const) {
      expect(renderToStaticMarkup(h(StatusPill, { tone, children: "Label" }))).toBe(`<span class="hb-pill" data-tone="${tone}">Label</span>`);
    }
    const css = readFileSync("src/app/harbour.css", "utf8");
    expect(css).toMatch(/\.hb-pill\[data-tone="ok"\]::before \{ content: "\\2713"/);
    expect(css).toMatch(/\.hb-pill\[data-tone="warn"\]::before \{ content: "!"/);
    expect(css).toMatch(/\.hb-pill\[data-tone="bad"\]::before \{ content: "!"/);
  });

  it("Panel draws a coloured title bar with the count and a labelled full-screen link, and only the tools it is given", () => {
    const html = renderToStaticMarkup(h(Panel, { title: "Risk Assessments", colour: "red", count: 4, fullHref: "/rota/risks", id: "risks", tools: [{ label: "Add", icon: "+", href: "/rota/risks/new" }], children: "body" }));
    expect(html).toContain('class="hb-pn hb-c-red');
    expect(html).toContain('aria-labelledby="risks-title"');
    expect(html).toContain('<h2 id="risks-title">Risk Assessments</h2>');
    expect(html).toContain(">4</span>");
    expect(html).toContain('aria-label="Open Risk Assessments full screen"');
    expect(html).toContain('title="Open full screen"');
    expect(html).toContain('href="/rota/risks/new"');
    expect(html).not.toMatch(/Remove selected|Export|Pin/);
    // No tools, no tool row.
    expect(renderToStaticMarkup(h(Panel, { title: "Plain", children: "x" }))).not.toContain("hb-pn-tools");
  });

  it("PanelTools gives every icon button an accessible name and a tooltip, with More at the far right", () => {
    const html = renderToStaticMarkup(h(PanelTools, { tools: [{ label: "More", icon: "…", more: true, href: "/m" }, { label: "Export", icon: "e", href: "/x.csv" }] }));
    expect(html.indexOf('aria-label="Export"')).toBeLessThan(html.indexOf('aria-label="More"'));
    expect(html).toContain('title="Export"');
    expect(html).toMatch(/aria-label="More" title="More" data-more=""/);
  });

  it("DataTable shows tick boxes only where bulk actions exist, and Showing X of Y with Previous and Next", () => {
    const rows = [{ id: "a", name: "Falls" }, { id: "b", name: "Choking" }];
    const columns = [{ key: "n", header: "Assessment", cell: (r: { name: string }) => r.name, sortHref: "?sort=name", sorted: "asc" as const }];
    const plain = renderToStaticMarkup(h(DataTable<{ id: string; name: string }>, { rows, columns, rowKey: (r) => r.id, caption: "Risks" }));
    expect(plain).not.toContain('type="checkbox"');
    expect(plain).toContain('aria-sort="ascending"');
    expect(plain).toContain('href="?sort=name"');
    const bulk = renderToStaticMarkup(h(DataTable<{ id: string; name: string }>, { rows, columns, rowKey: (r) => r.id, caption: "Risks", select: { form: "bulk", name: "ids", label: (r) => `Select ${r.name}` }, pager: { shown: 2, total: 9, nextHref: "?page=2" } }));
    expect(bulk.match(/type="checkbox"/g)).toHaveLength(2);
    expect(bulk).toContain('aria-label="Select Falls"');
    expect(bulk).toContain("Showing 2 of 9");
    expect(bulk).toContain('aria-disabled="true"');
    expect(bulk).toContain('href="?page=2"');
  });

  it("StatTiles are links that filter, with Show all only while a filter is on", () => {
    const tiles = [{ key: "high", label: "High risk", value: 3, icon: "!", colour: "#d14336", href: "?level=HIGH" }];
    expect(renderToStaticMarkup(h(StatTiles, { tiles, showAllHref: "?" }))).not.toContain("Show all");
    const on = renderToStaticMarkup(h(StatTiles, { tiles: [{ ...tiles[0]!, active: true }], showAllHref: "?" }));
    expect(on).toContain("Show all");
    expect(on).toContain('aria-current="true"');
  });

  it("SubTabs mark the current page and are not drawn for a single page", () => {
    expect(renderToStaticMarkup(h(SubTabs, { label: "Daily Rota", tabs: [{ label: "Daily Rota", href: "/rota/visits" }] }))).toBe("");
    const html = renderToStaticMarkup(h(SubTabs, { label: "Rota Home", tabs: [{ label: "Today", href: "/rota", current: true }, { label: "The Monitor", href: "/rota/monitor" }] }));
    expect(html).toContain('aria-label="Rota Home pages"');
    expect(html).toContain(`aria-current="page" href="/rota">Today`);
  });

  it("remembers a dismissed tip per person and per page", () => {
    expect(tipKey("u1", "/rota")).not.toBe(tipKey("u2", "/rota"));
    expect(tipKey("u1", "/rota")).not.toBe(tipKey("u1", "/rota/visits"));
  });

  it("switches every Harbour animation off for people who ask for reduced motion", () => {
    const css = readFileSync("src/app/harbour.css", "utf8");
    expect(css).toContain("@keyframes pnIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const cls of [".hb-in", ".hb-pn", ".hb-tile", ".hb-fly"]) expect(reduced).toContain(cls);
  });
});
