"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
/** All parsing, fonts and workers stay on this origin. No public preview service. */
export default function PdfPreview({
  url,
  zoom,
  name,
}: {
  url: string;
  zoom: number;
  name: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    let rendering: RenderTask | undefined;
    async function render() {
      const pdfjs = await import("pdfjs-dist");
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      loading = pdfjs.getDocument({
        url,
        // Never draw with the device's own fonts: a local "Helvetica" can distort documents that do not embed fonts.
        useSystemFonts: false,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        wasmUrl: "/pdfjs/wasm/",
      });
      const pdf = await loading.promise;
      if (!active) return;
      setPages(pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      if (!active || !canvas.current) return;
      const viewport = page.getViewport({ scale: zoom / 100 });
      const target = canvas.current;
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.ceil(viewport.width * ratio);
      target.height = Math.ceil(viewport.height * ratio);
      target.style.width = viewport.width + "px";
      target.style.height = viewport.height + "px";
      rendering = page.render({
        canvas: target,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await rendering.promise;
      const content = await page.getTextContent();
      if (active) {
        setText(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" "),
        );
        setRendered(`${url}:${pageNumber}:${zoom}`);
      }
    }
    render().catch((e) => {
      if (active && e.name !== "RenderingCancelledException")
        setError(
          "Could not render this PDF. You can still use authorised download.",
        );
    });
    return () => {
      active = false;
      rendering?.cancel();
      void loading?.destroy();
    };
  }, [url, zoom, pageNumber]);
  return (
    <div className="pdf-viewer" title={`Preview ${name}`}>
      <div className="pdf-pages">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous PDF page"
          disabled={pageNumber === 1}
          onClick={() => setPageNumber((p) => p - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {pageNumber} of {pages}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next PDF page"
          disabled={pageNumber === pages}
          onClick={() => setPageNumber((p) => p + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-page">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Document page ${pageNumber}`}
          data-rendered={
            rendered === `${url}:${pageNumber}:${zoom}` ? "true" : "false"
          }
        />
        <p className="sr-only">{text}</p>
      </div>
    </div>
  );
}
