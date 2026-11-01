"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ArrowsOut, CaretDown, CaretLeft, CaretRight, DownloadSimple, FileMagnifyingGlass, ListBullets, Minus, Plus, Printer, X } from "@phosphor-icons/react";

const ZOOMS = [50, 75, 100, 125, 150, 200] as const;
const GAP = 16;

/** Loads a PDF once with PDF.js. System fonts are never used, so a device's own "Helvetica" cannot distort the text. */
function usePdf(src: string) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const loaded: { task?: PDFDocumentLoadingTask } = {};
    setPdf(null);
    setError("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      loaded.task = pdfjs.getDocument({ url: src, useSystemFonts: false, standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" });
      const doc = await loaded.task.promise;
      if (alive) setPdf(doc);
    })().catch(() => alive && setError("This document could not be displayed. You can still download it."));
    return () => {
      alive = false;
      void loaded.task?.destroy();
    };
  }, [src]);
  return { pdf, error };
}

/**
 * Reads the policy's real CSB board-paper PDF (the same file as "Download PDF"), rendered on this origin with PDF.js.
 * Pages scroll continuously in a panel sized to the screen, and the reader opens the same document across the whole
 * window. Page text is also given to screen readers, and the full record links to the accessible HTML text.
 */
export function DocumentViewer({ src, downloadHref, title, headings }: { src: string; downloadHref: string; title: string; headings: string[] }) {
  const { pdf, error } = usePdf(src);
  const [reader, setReader] = useState(false);
  const [printing, setPrinting] = useState<string[] | null>(null);

  // Printing renders each page as a sharp image into a print-only layer: framing a PDF is blocked by the security headers.
  const print = useCallback(async () => {
    if (!pdf) return;
    const images: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const p = await pdf.getPage(n);
      const viewport = p.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas");
      c.width = Math.ceil(viewport.width);
      c.height = Math.ceil(viewport.height);
      await p.render({ canvas: c, viewport }).promise;
      images.push(c.toDataURL("image/png"));
    }
    setPrinting(images);
  }, [pdf]);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const shared = { pdf, error, downloadHref, title, headings, onPrint: () => void print() };
  return (
    <>
      <PdfPane {...shared} variant="panel" onReader={() => setReader(true)} />
      <DialogPrimitive.Root open={reader} onOpenChange={setReader}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#0b1530]/50" />
          <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-[#f2f1ef] sm:inset-4 sm:rounded-[8px] sm:shadow-2xl" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            <PdfPane {...shared} variant="reader" onReader={() => setReader(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {printing
        ? createPortal(
            <div className="pdf-print-root" aria-hidden="true">
              {printing.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- rendered page images for printing only
                <img key={i} src={url} alt="" />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type PaneProps = {
  pdf: PDFDocumentProxy | null;
  error: string;
  downloadHref: string;
  title: string;
  headings: string[];
  variant: "panel" | "reader";
  onReader: () => void;
  onPrint: () => void;
};

function PdfPane({ pdf, error, downloadHref, title, headings, variant, onReader, onPrint }: PaneProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [current, setCurrent] = useState(1);
  const [outline, setOutline] = useState(variant === "reader" && headings.length > 0);
  const [pagesOf, setPagesOf] = useState<Map<string, number> | null>(null);

  // The A4 page size sets the fit-to-width scale and the space each page holds before it is drawn.
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    void pdf.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (alive) setBase({ w: v.width, h: v.height });
    });
    return () => {
      alive = false;
    };
  }, [pdf]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The reader fits pages to a comfortable reading width rather than stretching them across a wide screen.
  // Two pixels are kept back for the page's border, so a fitted page never forces a sideways scroll bar.
  const fitWidth = variant === "reader" ? Math.min(width - 2 * GAP - 2, 920) : width - 2 * GAP - 2;
  const scale = !base ? 1 : zoom === "fit" ? Math.max(0.3, Math.min(2.5, fitWidth / base.w)) : zoom / 100;
  const total = pdf?.numPages ?? 0;

  // The page counter follows the page that fills most of the view.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !total) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 1;
        let bestRatio = -1;
        for (const [n, r] of ratios) if (r > bestRatio) [best, bestRatio] = [n, r];
        setCurrent(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    pageEls.current.slice(0, total).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [total, scale]);

  const goTo = (n: number) => {
    const el = pageEls.current[n - 1];
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - GAP, behavior: "smooth" });
  };

  // The outline jumps to the page where each section heading first appears.
  const findSections = useCallback(async () => {
    if (pagesOf || !pdf) return;
    const found = new Map<string, number>();
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const pageText = content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
      for (const h of headings) if (!found.has(h) && pageText.includes(h)) found.set(h, n);
    }
    setPagesOf(found);
  }, [pagesOf, pdf, headings]);
  useEffect(() => {
    if (outline) void findSections();
  }, [outline, findSections]);

  const zoomBy = (dir: 1 | -1) => {
    const now = Math.round(scale * 100);
    const next = dir > 0 ? ZOOMS.find((z) => z > now) : [...ZOOMS].reverse().find((z) => z < now);
    if (next) setZoom(next);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "PageDown" || (e.key === "ArrowRight" && !e.shiftKey)) {
      e.preventDefault();
      goTo(Math.min(total, current + 1));
    } else if (e.key === "PageUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(Math.max(1, current - 1));
    }
  };

  return (
    <div className={variant === "reader" ? "pl-viewer pl-viewer-reader" : "pl-viewer"} aria-label={`Document: ${title}`} role="region" data-testid={variant === "reader" ? "document-reader" : "document-viewer"}>
      <div className="pl-viewer-bar" role="toolbar" aria-label="Document controls">
        <button type="button" className="pl-tool" onClick={() => setOutline((o) => !o)} aria-pressed={outline} aria-label="Sections" title="Sections"><ListBullets size={17} /></button>
        <span className="pl-tool-sep" aria-hidden="true" />
        <button type="button" className="pl-tool" onClick={() => goTo(Math.max(1, current - 1))} disabled={current <= 1} aria-label="Previous page" title="Previous page"><CaretLeft size={15} /></button>
        <span className="pl-tool-count" aria-live="polite" data-testid="page-count">{total ? `${current} / ${total}` : "– / –"}</span>
        <button type="button" className="pl-tool" onClick={() => goTo(Math.min(total, current + 1))} disabled={!total || current >= total} aria-label="Next page" title="Next page"><CaretRight size={15} /></button>
        <span className="pl-tool-sep max-[420px]:hidden" aria-hidden="true" />
        <button type="button" className="pl-tool max-[420px]:hidden" onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out"><Minus size={15} /></button>
        <label className="relative flex items-center">
          <span className="sr-only">Zoom level</span>
          <select value={zoom === "fit" ? "fit" : String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))} className="h-[28px] cursor-pointer appearance-none rounded-[5px] border border-[#e3e0d9] bg-white pl-2.5 pr-6 text-[12.5px] text-[#1f2d42]">
            <option value="fit">{zoom === "fit" ? `${Math.round(scale * 100)}%` : "Fit width"}</option>
            {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
          </select>
          <CaretDown size={11} aria-hidden="true" className="pointer-events-none absolute right-2 text-[#3a4b5e]" />
        </label>
        <button type="button" className="pl-tool max-[420px]:hidden" onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in"><Plus size={15} /></button>
        <button type="button" className="pl-tool max-[420px]:hidden" onClick={() => setZoom("fit")} aria-label="Fit to width" title="Fit to width"><FileMagnifyingGlass size={17} /></button>
        <span className="ml-auto" />
        <a className="pl-tool" href={downloadHref} download aria-label="Download PDF" title="Download PDF"><DownloadSimple size={17} /></a>
        <button type="button" className="pl-tool" onClick={onPrint} disabled={!pdf} aria-label="Print" title="Print"><Printer size={17} /></button>
        {variant === "panel" ? (
          <button type="button" className="pl-tool" onClick={onReader} aria-label="Open full-screen reader" title="Open full-screen reader"><ArrowsOut size={17} /></button>
        ) : (
          <button type="button" className="pl-tool" onClick={onReader} aria-label="Close reader" title="Close reader (Esc)"><X size={17} /></button>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1">
        {outline ? (
          <nav aria-label="Sections" className="w-[190px] shrink-0 overflow-y-auto border-r border-[#e3e0d9] bg-white py-2 text-[12.5px] max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:z-10 max-sm:shadow-lg">
            {headings.map((h) => {
              const n = pagesOf?.get(h);
              return (
                <button key={h} type="button" disabled={!n} onClick={() => n && goTo(n)} className="block w-full px-3 py-1.5 text-left text-[#1f2d42] hover:bg-[#f4f9fc] disabled:text-[#8a94a3]">
                  {h}
                  {n ? <span className="ml-1 text-[#6b7586]">p.{n}</span> : null}
                </button>
              );
            })}
            {!pagesOf ? <p className="px-3 py-1.5 text-[#6b7586]">Finding pages…</p> : null}
          </nav>
        ) : null}
        <div ref={scroller} className="pl-viewer-page min-w-0 flex-1" tabIndex={0} onKeyDown={onKey} aria-label="Document pages">
          {error ? (
            <p role="alert" className="m-6 rounded-[6px] bg-white p-4 text-[13px] text-[#b42318]">{error} <a href={downloadHref} download>Download PDF</a></p>
          ) : !pdf || !base ? (
            <p className="pt-8 text-center text-[12.5px] text-[#6b7586]">Loading document…</p>
          ) : (
            Array.from({ length: total }, (_, i) => (
              <PdfPage key={i} pdf={pdf} n={i + 1} scale={scale} base={base} root={scroller} ref={(el) => { pageEls.current[i] = el; }} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** One page, drawn once it is near the view. Each render draws into a fresh canvas, so overlapping renders cannot mix. */
function PdfPage({ pdf, n, scale, base, root, ref }: { pdf: PDFDocumentProxy; n: number; scale: number; base: { w: number; h: number }; root: React.RefObject<HTMLDivElement | null>; ref: (el: HTMLDivElement | null) => void }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(n <= 2);
  const [rendered, setRendered] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { root: root.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near, root]);

  useEffect(() => {
    if (!near) return;
    let alive = true;
    let task: RenderTask | undefined;
    (async () => {
      const p = await pdf.getPage(n);
      if (!alive) return;
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const c = document.createElement("canvas");
      c.width = Math.ceil(viewport.width * ratio);
      c.height = Math.ceil(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      c.setAttribute("aria-hidden", "true");
      task = p.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      if (!alive) return;
      const box = holder.current?.querySelector("[data-canvas]");
      box?.replaceChildren(c);
      setRendered(true);
      const content = await p.getTextContent();
      if (alive) setText(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
    })().catch((e: Error) => {
      if (e.name !== "RenderingCancelledException") console.warn("PDF page could not be drawn", n);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, n, scale, near]);

  return (
    <div
      ref={(el) => {
        holder.current = el;
        ref(el);
      }}
      data-page={n}
      data-rendered={rendered ? "true" : "false"}
      className="pl-page"
      style={{ width: base.w * scale, minHeight: base.h * scale }}
    >
      <div data-canvas="" />
      <p className="sr-only">{`Page ${n}. ${text}`}</p>
    </div>
  );
}
