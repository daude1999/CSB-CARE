// Copies the locked PDF.js renderer files into public/pdfjs for the HR Hub document preview (ignored by git).
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const source = path.join(root, "node_modules", "pdfjs-dist");
const destination = path.join(root, "public", "pdfjs");
mkdirSync(destination, { recursive: true });
cpSync(
  path.join(source, "build", "pdf.worker.min.mjs"),
  path.join(destination, "pdf.worker.min.mjs"),
);
for (const folder of ["standard_fonts", "cmaps", "wasm"])
  cpSync(path.join(source, folder), path.join(destination, folder), {
    recursive: true,
  });
cpSync(path.join(source, "LICENSE"), path.join(destination, "LICENSE"));
