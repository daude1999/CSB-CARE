/**
 * Pure rules behind the shell's navigation feedback (src/components/navigation-progress.tsx) and the sidebar's
 * active state. Kept free of React so they can be unit tested.
 */

/** Whether a sidebar entry matches the current address: "/policies" covers every Policy Library view, "/" only the dashboard. */
export function isActiveHref(href: string, path: string, params: URLSearchParams): boolean {
  const [base, query] = href.split("?");
  if (base === "/") return path === "/";
  if (path !== base && !path.startsWith(`${base}/`)) return false;
  if (!query) return true;
  return [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v);
}

/** Of several matching entries only the most specific is lit, so "/rota" (dashboard) is not lit on "/rota/visits". */
export function mostSpecificActive(hrefs: string[], path: string, params: URLSearchParams): string | undefined {
  return hrefs.filter((h) => isActiveHref(h, path, params)).sort((a, b) => b.length - a.length)[0];
}

/** A sidebar entry that also stands for other pages: a workspace whose tabs live at their own, older addresses. */
export type NavEntry = { href: string; match?: string[] };

/**
 * The entry to light for an address. An entry matches by its own address or by any of its `match` prefixes; the most
 * specific match wins, so a workspace that owns "/changes" is lit on "/changes/abc" while "/" stays the dashboard only.
 */
export function activeEntryHref(entries: NavEntry[], path: string, params: URLSearchParams): string | undefined {
  let best: { href: string; len: number } | undefined;
  for (const e of entries) {
    for (const pattern of [e.href, ...(e.match ?? [])]) {
      if (!isActiveHref(pattern, path, params)) continue;
      if (!best || pattern.length > best.len) best = { href: e.href, len: pattern.length };
    }
  }
  return best?.href;
}

/** Addresses that are files or APIs, never pages: clicking them downloads something and the page stays put. */
const NOT_PAGES = /^\/(api|pdfjs|brand|hr\/hr-|_next)\//;

export type LinkClick = {
  href: string;
  /** The anchor's target attribute, if any. */
  target: string | null;
  /** The anchor has a download attribute or opts out with data-no-progress. */
  optOut: boolean;
  button: number;
  modified: boolean;
  defaultPrevented: boolean;
};

/**
 * The page a click is about to open in this tab, as "path?query", or null when the click will not load a page here:
 * another tab or window, a download or API call, another site, an in-page anchor or the page already open.
 * A click Next.js has already handled (defaultPrevented) still counts, because that is how client navigation starts.
 */
export function pageTarget(click: LinkClick, current: URL): string | null {
  if (click.button !== 0 || click.modified || click.optOut) return null;
  if (click.target && click.target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(click.href, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin || !/^https?:$/.test(url.protocol)) return null;
  if (NOT_PAGES.test(url.pathname) || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return url.pathname + url.search;
}

/** Splits "path?query" into its parts. */
export function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [path, query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}
