import "server-only";
import PDFDocument from "pdfkit";
import { embeddedDefaultFont, FONT, pdfText, applyEmbeddedFonts } from "@/server/documents/fonts";
import { db } from "@/lib/db";
import { fmtLondonDate } from "@/lib/london";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { marChart, OUTCOME_CODE, OUTCOME_LABEL } from "./medication";

const clean = pdfText;

/** A month's MAR chart, landscape A4: medicines down the side, days across, recorded codes in each cell. */
export async function marChartPdf(ctx: Ctx, serviceUserId: string, month: string) {
  const { days, grid } = await marChart(ctx, serviceUserId, month);
  const su = await db.serviceUser.findUniqueOrThrow({ where: { id: serviceUserId }, select: { firstName: true, lastName: true, preferredName: true, reference: true, organisationId: true } });
  const doc = new PDFDocument({ ...embeddedDefaultFont(), size: "A4", layout: "landscape", margin: 28, info: { Title: `MAR chart ${month}`, Author: "CSB Care Solution Bureau" } });
  applyEmbeddedFonts(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.font(FONT.bold).fontSize(14).text(clean(`MAR chart · ${su.preferredName ?? su.firstName} ${su.lastName} (${su.reference})`));
  doc.font(FONT.regular).fontSize(9).fillColor("#5b6577").text(clean(`${fmtLondonDate(days[0]!)} to ${fmtLondonDate(days.at(-1)!)} · codes: ${Object.entries(OUTCOME_CODE).map(([k, c]) => `${c} ${OUTCOME_LABEL[k as keyof typeof OUTCOME_LABEL]}`).join(", ")}, "-" due but not recorded`));
  const left = 28, top = 70, nameW = 170;
  const cellW = (doc.page.width - left * 2 - nameW) / days.length;
  const rowH = 30;
  doc.fillColor("#16181c").font(FONT.bold).fontSize(7);
  days.forEach((d, i) => doc.text(d.slice(8), left + nameW + i * cellW, top, { width: cellW, align: "center" }));
  let y = top + 12;
  for (const row of grid) {
    if (y + rowH > doc.page.height - 40) { doc.addPage(); y = 40; }
    doc.rect(left, y, doc.page.width - left * 2, rowH).strokeColor("#d6dae1").lineWidth(0.5).stroke();
    doc.font(FONT.bold).fontSize(8).fillColor("#16181c").text(clean(`${row.med.name}${row.med.strength ? ` ${row.med.strength}` : ""}`), left + 3, y + 3, { width: nameW - 6 });
    doc.font(FONT.regular).fontSize(7).fillColor("#5b6577").text(clean(`${row.med.dose}${row.med.asRequired ? " · as required" : ` · ${row.med.timeRanges.join(", ").toLowerCase()}`}${row.med.status === "STOPPED" ? " · stopped" : ""}`), left + 3, y + 14, { width: nameW - 6 });
    row.cells.forEach((c, i) => {
      const x = left + nameW + i * cellW;
      doc.moveTo(x, y).lineTo(x, y + rowH).strokeColor("#eef0f3").stroke();
      const text = [...c.codes, ...Array(c.missed).fill("-")].join(" ");
      doc.font(FONT.bold).fontSize(7).fillColor(c.missed ? "#a3242c" : "#16181c").text(text, x, y + 10, { width: cellW, align: "center" });
    });
    y += rowH;
  }
  if (!grid.length) doc.font(FONT.regular).fontSize(10).fillColor("#1f2937").text("No medicines in this month.", left, y + 10);
  doc.font(FONT.regular).fontSize(7).fillColor("#5b6577").text("Confidential: contains health information. Printed from CSB; the records in the platform are the source.", left, doc.page.height - 30, { lineBreak: false });
  doc.end();
  const pdf = await done;
  await audit({ organisationId: su.organisationId, actorId: ctx.userId, action: "medication.mar.printed", entityType: "ServiceUser", entityId: serviceUserId, data: { month } });
  return { pdf, filename: `mar-${su.reference}-${month}.pdf` };
}
