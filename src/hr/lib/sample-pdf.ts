export function samplePdf(name: string, category: string) {
  const text = [
    "CSB HR HUB",
    "DEMO - NOT A REAL CERTIFICATE",
    "Fictional evidence for product demonstration only.",
    `Employee: ${name}`,
    `Category: ${category}`,
    "No official check or identity verification is represented.",
    "This sample must never be used for employment decisions.",
  ];
  const esc = (s: string) => s.replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 20 Tf 55 770 Td (${esc(text[0])}) Tj /F1 14 Tf ${text
    .slice(1)
    .map((t) => `0 -44 Td (${esc(t)}) Tj`)
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
