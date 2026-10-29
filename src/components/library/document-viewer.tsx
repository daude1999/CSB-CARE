"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ArrowsOut, CaretDown, CaretLeft, CaretRight, DownloadSimple, FileMagnifyingGlass, ListBullets, Minus, Plus, Printer } from "@phosphor-icons/react";

const ZOOMS = [50, 75, 100, 125, 150, 200] as const;

/**
 * Reads the policy's real CSB board-paper PDF (the same file as "Download PDF"), rendered on this origin with PDF.js.
 * The page text is also given to screen readers, and the full record links to the accessible HTML text.
 */
export function DocumentViewer({ src, downloadHref, title, headings }: { src: string; downloadHref: string; title: string; headings: string[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [shownZoom, setShownZoom] = useState(100);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [outline, setOutline] = useState(false);
  const [pagesOf, setPagesOf] = useState<Map<string, number> | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let alive = true;
    const loaded: { task?: PDFDocumentLoadingTask } = {};
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      loaded.task = pdfjs.getDocument({ url: src, standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/pdfjs/wasm/" });
      const doc = await loaded.task.promise;
      if (alive) setPdf(doc);
    })().catch(() => alive && setError("This document could not be displayed. You can still download it."));
    return () => {
      alive = false;
      void loaded.task?.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (!pdf || !canvas.current || !scroller.current) return;
    let alive = true;
    let task: RenderTask | undefined;
    setRendered(false);
    (async () => {
      const p = await pdf.getPage(page);
      const natural = p.getViewport({ scale: 1 });
      const scale = zoom === "fit" ? Math.max(0.3, (scroller.current!.clientWidth - 40) / natural.width) : zoom / 100;
      const viewport = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.ceil(viewport.width * ratio);
      c.height = Math.ceil(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      task = p.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      const content = await p.getTextContent();
      if (!alive) return;
      setShownZoom(Math.round(scale * 100));
      setText(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
      setRendered(true);
    })().catch((e: Error) => alive && e.name !== "RenderingCancelledException" && setError("This page could not be displayed. You can still download the document."));
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [pdf, page, zoom]);

  // The outline jumps to the page where each section heading first appears.
  const openOutline = useCallback(async () => {
    setOutline((o) => !o);
    if (pagesOf || !pdf) return;
    const found = new Map<string, number>();
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const pageText = content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
      for (const h of headings) if (!found.has(h) && pageText.includes(h)) found.set(h, n);
    }
    setPagesOf(found);
  }, [pagesOf, pdf, headings]);

  const print = async () => {
    const blob = await (await fetch(src)).blob();
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = URL.createObjectURL(blob);
    iframe.onload = () => iframe.contentWindow?.print();
    document.body.appendChild(iframe);
  };

  const total = pdf?.numPages ?? 0;
  const zoomBy = (dir: 1 | -1) => {
    const current = zoom === "fit" ? shownZoom : zoom;
    const next = dir > 0 ? ZOOMS.find((z) => z > current) : [...ZOOMS].reverse().find((z) => z < current);
    if (next) setZoom(next);
  };

  return (
    <div ref={frame} className="pl-viewer" aria-label={`Document: ${title}`} role="region">
      <div className="pl-viewer-bar" role="toolbar" aria-label="Document controls">
        <button type="button" className="pl-tool" onClick={openOutline} aria-pressed={outline} aria-label="Sections" title="Sections"><ListBullets size={17} /></button>
        <span className="pl-tool-sep" aria-hidden="true" />
        <button type="button" className="pl-tool" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page" title="Previous page"><CaretLeft size={15} /></button>
        <span className="pl-tool-count" aria-live="polite">{total ? `${page} / ${total}` : "– / –"}</span>
        <button type="button" className="pl-tool" onClick={() => setPage((p) => Math.min(total, p + 1))} disabled={!total || page >= total} aria-label="Next page" title="Next page"><CaretRight size={15} /></button>
        <span className="pl-tool-sep" aria-hidden="true" />
        <button type="button" className="pl-tool" onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out"><Minus size={15} /></button>
        <label className="relative flex items-center">
          <span className="sr-only">Zoom</span>
          <select value={zoom === "fit" ? "fit" : String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))} className="h-[28px] cursor-pointer appearance-none rounded-[5px] border border-[#e3e0d9] bg-white pl-2.5 pr-6 text-[12.5px] text-[#1f2d42]">
            <option value="fit">{zoom === "fit" ? `${shownZoom}%` : "Fit width"}</option>
            {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
          </select>
          <CaretDown size={11} aria-hidden="true" className="pointer-events-none absolute right-2 text-[#3a4b5e]" />
        </label>
        <button type="button" className="pl-tool" onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in"><Plus size={15} /></button>
        <button type="button" className="pl-tool" onClick={() => setZoom("fit")} aria-label="Fit to width" title="Fit to width"><FileMagnifyingGlass size={17} /></button>
        <span className="ml-auto" />
        <a className="pl-tool" href={downloadHref} download aria-label="Download PDF" title="Download PDF"><DownloadSimple size={17} /></a>
        <button type="button" className="pl-tool" onClick={() => void print()} disabled={!pdf} aria-label="Print" title="Print"><Printer size={17} /></button>
        <button type="button" className="pl-tool" onClick={() => void frame.current?.requestFullscreen?.()} aria-label="Full screen" title="Full screen"><ArrowsOut size={17} /></button>
      </div>
      <div className="relative flex min-h-0 flex-1">
        {outline ? (
          <nav aria-label="Sections" className="w-[170px] shrink-0 overflow-y-auto border-r border-[#e3e0d9] bg-white py-2 text-[12.5px]">
            {headings.map((h) => {
              const n = pagesOf?.get(h);
              return (
                <button key={h} type="button" disabled={!n} onClick={() => n && setPage(n)} className="block w-full px-3 py-1.5 text-left text-[#1f2d42] hover:bg-[#f4f9fc] disabled:text-[#8a94a3]">
                  {h}
                  {n ? <span className="ml-1 text-[#6b7586]">p.{n}</span> : null}
                </button>
              );
            })}
            {!pagesOf ? <p className="px-3 py-1.5 text-[#6b7586]">Finding pages…</p> : null}
          </nav>
        ) : null}
        <div ref={scroller} className="pl-viewer-page min-w-0 flex-1" tabIndex={0} aria-label="Document page">
          {error ? (
            <p role="alert" className="m-6 rounded-[6px] bg-white p-4 text-[13px] text-[#b42318]">{error} <a href={downloadHref} download>Download PDF</a></p>
          ) : (
            <>
              {!rendered ? <p className="absolute inset-x-0 top-8 text-center text-[12.5px] text-[#6b7586]">Loading document…</p> : null}
              <canvas ref={canvas} aria-hidden="true" data-rendered={rendered ? "true" : "false"} className="mx-auto block bg-white shadow-[0_1px_4px_rgb(0_0_0/0.12)]" />
              <p className="sr-only" aria-live="off">{text}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
