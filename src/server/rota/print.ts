import "server-only";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, dbDate, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonTime } from "@/lib/london";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { decryptKeySafe } from "@/server/care/keysafe";
import { rotaScope, serviceUserWhere, staffDirectoryWhere, visitWhere } from "./scope";

/**
 * Printable rotas (OnePlan's paper rota per team member or per service user), built on the server as a PDF. Defaults
 * share the least personal data: no surnames option, and key safe codes only when asked for by someone allowed to see
 * them, which is recorded. Each print is audited.
 */

export const printSchema = z.object({
  kind: z.enum(["CARER", "SERVICE_USER"]),
  ids: z.array(z.string().min(1)).min(1, "Choose at least one person").max(60, "Print at most 60 people at a time"),
  from: z.string().refine(isIsoDate, "Choose the start date"),
  to: z.string().refine(isIsoDate, "Choose the end date"),
  fontSize: z.coerce.number().int().min(8).max(14).default(10),
  includeCancelled: z.boolean().default(false),
  includeShadow: z.boolean().default(true),
  address: z.boolean().default(true),
  medication: z.boolean().default(false),
  keySafe: z.boolean().default(false),
  excludeSurname: z.boolean().default(false),
  separatePages: z.boolean().default(true),
});
export type PrintInput = z.input<typeof printSchema>;

const sanitise = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "");

export async function printableRota(ctx: Ctx, input: PrintInput): Promise<{ pdf: Buffer; filename: string }> {
  const p = printSchema.safeParse(input);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the print options");
  const o = p.data;
  if (o.from > o.to) throw new ValidationError("The start date is after the end date");
  if (o.to > addDays(o.from, 30)) throw new ValidationError("Print at most 31 days at a time");
  if (o.keySafe && !hasOrgPermission(ctx, "serviceUser.keysafe")) throw new ForbiddenError("You cannot print key safe codes");
  const scope = await rotaScope(ctx, "rota.view");
  const people = o.kind === "CARER"
    ? (await db.staffMember.findMany({ where: { ...staffDirectoryWhere(scope, {}), id: { in: o.ids } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } })).map((s) => ({ id: s.id, name: s.displayName }))
    : (await db.serviceUser.findMany({ where: { ...serviceUserWhere(scope), id: { in: o.ids } }, select: { id: true, firstName: true, lastName: true, preferredName: true }, orderBy: { lastName: "asc" } })).map((s) => ({ id: s.id, name: `${s.preferredName ?? s.firstName}${o.excludeSurname ? "" : ` ${s.lastName}`}` }));
  if (people.length !== new Set(o.ids).size) throw new ForbiddenError("Some of those people are not in your areas");

  const visits = await db.visit.findMany({
    where: {
      ...visitWhere(scope),
      publishedAt: { not: null },
      date: { gte: dbDate(o.from), lte: dbDate(o.to) },
      ...(o.includeCancelled ? {} : { status: { not: "CANCELLED" } }),
      ...(o.kind === "CARER" ? { assignments: { some: { staffId: { in: o.ids }, removedAt: null } } } : { serviceUserId: { in: o.ids } }),
    },
    include: {
      serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true, addressLine1: true, town: true, postcode: true, keySafeCipher: true } },
      callType: { select: { name: true } },
      assignments: { where: { removedAt: null }, select: { staffId: true, slot: true, staff: { select: { displayName: true } } } },
      runRoute: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { routeOrder: { sort: "asc", nulls: "last" } }, { scheduledStart: "asc" }],
  });

  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: "Printable rota", Author: "CSB Care Solution Bureau" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const size = o.fontSize;
  const suName = (s: { firstName: string; lastName: string; preferredName: string | null }) => `${s.preferredName ?? s.firstName}${o.excludeSurname ? "" : ` ${s.lastName}`}`;
  let keySafesShown = 0;
  let first = true;
  for (const person of people) {
    const mine = visits.filter((v) => (o.kind === "CARER" ? v.assignments.some((a) => a.staffId === person.id && (o.includeShadow || a.slot !== "SHADOW")) : v.serviceUser.id === person.id));
    if (!first && o.separatePages) doc.addPage();
    first = false;
    doc.font("Helvetica-Bold").fontSize(size + 6).fillColor("#16181c").text(sanitise(person.name));
    doc.font("Helvetica").fontSize(size).fillColor("#5b6577").text(sanitise(`${o.kind === "CARER" ? "Rota" : "Visits"} from ${fmtLondonDate(o.from)} to ${fmtLondonDate(o.to)} · printed ${fmtLondonDate(londonDate())}`));
    doc.moveDown(0.6);
    if (!mine.length) {
      doc.fillColor("#1f2937").text("No visits in these dates.");
      doc.moveDown();
      continue;
    }
    let day = "";
    for (const v of mine) {
      const d = fromDbDate(v.date);
      if (d !== day) {
        day = d;
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.moveDown(0.4).font("Helvetica-Bold").fontSize(size + 1).fillColor("#16181c").text(sanitise(fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })));
      }
      if (doc.y > doc.page.height - 80) doc.addPage();
      const other = o.kind === "CARER" ? suName(v.serviceUser) : v.assignments.filter((a) => o.includeShadow || a.slot !== "SHADOW").map((a) => a.staff.displayName).join(" and ") || "Not yet assigned";
      const line = `${londonTime(v.scheduledStart)}-${londonTime(v.scheduledEnd)}  ${other} · ${v.callType.name}${v.status === "CANCELLED" ? " · CANCELLED" : ""}${v.runRoute ? ` · route ${v.runRoute.name}` : ""}${o.kind === "CARER" && v.assignments.find((a) => a.staffId === person.id)?.slot === "SHADOW" ? " · shadowing" : ""}`;
      doc.font("Helvetica").fontSize(size).fillColor("#1f2937").text(sanitise(line));
      const extra: string[] = [];
      if (o.address && o.kind === "CARER") extra.push([v.serviceUser.addressLine1, v.serviceUser.town, v.serviceUser.postcode].filter(Boolean).join(", "));
      if (o.medication && v.medicationRequired) extra.push("Medication prompt: follow the paper MAR chart");
      if (o.keySafe && o.kind === "CARER" && v.serviceUser.keySafeCipher) {
        extra.push(`Key safe: ${decryptKeySafe(v.serviceUser.keySafeCipher)}`);
        keySafesShown++;
      }
      if (extra.length) doc.fillColor("#5b6577").fontSize(size - 1).text(sanitise(extra.filter(Boolean).join(" · ")), { indent: 12 });
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor("#5b6577").text(`Confidential: contains personal information. Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, { lineBreak: false });
  }
  doc.end();
  const pdf = await done;
  await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "rota.print", entityType: "Organisation", entityId: scope.organisationId, data: { kind: o.kind, people: people.length, from: o.from, to: o.to, keySafes: keySafesShown, surnames: !o.excludeSurname } });
  return { pdf, filename: `rota-${o.kind === "CARER" ? "team" : "service-users"}-${o.from}-to-${o.to}.pdf` };
}
