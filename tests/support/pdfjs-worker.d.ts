// PDF.js ships no types for its worker build. The test helper only hands the module to PDF.js itself.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
