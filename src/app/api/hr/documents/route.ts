import { z } from "zod/v4";
import { limitedRequest, rateLimit } from "@/hr/lib/request-security";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { currentUser, sameOrigin, HttpError } from "@/hr/lib/auth";
import { read, transaction } from "@/hr/lib/store";
import { permits, canEdit, sensitive } from "@/hr/lib/domain";
import { samplePdf } from "@/hr/lib/sample-pdf";
export async function GET(request: Request) {
  try {
    const u = await currentUser();
    const s = await read(u.workspace);
    const url = new URL(request.url);
    const d = s.documents.find((d) => d.id === url.searchParams.get("id"));
    const e = d && s.employees.find((e) => e.id === d.employee);
    if (
      !d ||
      !e ||
      !permits(u, e) ||
      (sensitive(d.category, s.settings[u.org]) && !u.sensitive)
    )
      throw new HttpError(404, "Document not available");
    if (d.state !== "Sample")
      throw new HttpError(
        423,
        "Quarantined: malware scanning is not configured",
      );
    await transaction(u.workspace, (s) =>
      s.events.push({
        id: randomUUID(),
        org: u.org,
        employee: e.id,
        actor: u.name,
        action: `${url.searchParams.has("download") ? "Downloaded" : "Previewed"} ${d.category} document v${d.version}`,
        at: new Date().toISOString(),
      }),
    );
    return new Response(samplePdf(e.name, d.category), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="demo-evidence.pdf"`,
        "Cache-Control": "no-store, private",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unavailable" },
      { status: e instanceof HttpError ? e.status : 400 },
    );
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await currentUser();
    if (!canEdit(u)) throw new HttpError(403, "Uploads not permitted");
    if (Number(request.headers.get("content-length") || 0) > 11 * 1024 * 1024)
      throw new HttpError(413, "Maximum file size is 10 MB");
    await rateLimit(u.id, 60);
    const data = await (
      await limitedRequest(request, 11 * 1024 * 1024)
    ).formData();
    const dateField = (name: string) =>
      data.get(name) ? z.iso.date().parse(data.get(name)) : null;
    const metadata = {
      issueDate: dateField("issueDate"),
      reviewDate: dateField("reviewDate"),
      expiryDate: dateField("expiryDate"),
      retentionDate: dateField("retentionDate"),
    };
    const employee = String(data.get("employee"));
    const category = String(data.get("category"));
    if (category === "DBS" && metadata.expiryDate)
      throw new HttpError(
        400,
        "DBS has no official expiry date. Use the organisational review date.",
      );
    const file = data.get("file");
    if (
      !(file instanceof File) ||
      file.size > 10 * 1024 * 1024 ||
      file.size < 8
    )
      throw new HttpError(400, "Choose a PDF, JPG or PNG under 10 MB");
    if (data.get("fictional") !== "true")
      throw new HttpError(400, "Only fictional test files may enter the pilot");
    const s = await read(u.workspace);
    const e = s.employees.find((e) => e.id === employee);
    if (
      !e ||
      !permits(u, e) ||
      !s.settings[u.org].documentTypes.some((t) => t.name === category) ||
      (sensitive(category, s.settings[u.org]) && !u.sensitive)
    )
      throw new HttpError(403, "Upload not permitted");
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime =
      bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? "image/jpeg"
          : bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : null;
    if (!mime)
      throw new HttpError(
        400,
        "The file content is not a supported PDF or image",
      );
    const id = randomUUID();
    // The file is stored first; if the record change below is refused, the stored file is removed again.
    await db.hrFile.create({ data: { key: id, organisationId: u.workspace, mime, bytes } });
    const result = await transaction(u.workspace, (s) => {
      const current = s.users.find((x) => x.id === u.id)!;
      const e = s.employees.find((e) => e.id === employee)!;
      if (
        !permits(current, e) ||
        !canEdit(current) ||
        (sensitive(category, s.settings[u.org]) && !current.sensitive)
      )
        throw new HttpError(403, "Access changed");
      const previous = data.get("previous")
        ? s.documents.find(
            (d) =>
              d.id === data.get("previous") &&
              d.employee === e.id &&
              d.category === category,
          )
        : undefined;
      if (data.get("previous") && !previous)
        throw new HttpError(400, "Replacement does not match");
      if (previous && s.documents.some((d) => d.previous === previous.id))
        throw new HttpError(
          409,
          "A replacement already exists. Refresh and replace the latest version.",
        );
      s.documents.push({
        id,
        org: u.org,
        employee,
        category,
        filename: path.basename(file.name).slice(0, 180),
        mime,
        version: previous ? previous.version + 1 : 1,
        previous: previous?.id || null,
        uploaded: new Date().toISOString(),
        uploader: u.name,
        state: "Quarantined",
        key: id,
        ...metadata,
        source: "Fictional pilot upload",
      });
      s.events.push({
        id: randomUUID(),
        org: u.org,
        employee,
        actor: u.name,
        action: `${previous ? "Replacement" : "Upload"} ${category} evidence quarantined; scanning required`,
        at: new Date().toISOString(),
      });
      return { id, state: "Quarantined" };
    }).catch(async (error) => {
      await db.hrFile.delete({ where: { key: id } }).catch(() => undefined);
      throw error;
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: e instanceof HttpError ? e.status : 400 },
    );
  }
}
