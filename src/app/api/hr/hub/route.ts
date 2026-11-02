import { CSV_BOM } from "@/lib/csv";
import { applyRequirements } from "@/hr/lib/requirements";
import { limitedRequest, rateLimit } from "@/hr/lib/request-security";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { currentUser, HttpError, sameOrigin, today } from "@/hr/lib/auth";
import { read, transaction } from "@/hr/lib/store";
import {
  canEdit,
  checkCategory,
  permits,
  sensitive,
  csvCell,
  type State,
  type User,
  type Employee,
  type ImportRow,
  permittedEmployee,
  privateEmployeeFields,
} from "@/hr/lib/domain";
import { runReminders } from "@/hr/lib/reminders";
const employeeSchema = z.object({
  staffId: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\w-]+$/),
  name: z.string().trim().min(2).max(100),
  branch: z.string().min(1),
  job: z.string().trim().min(2).max(100),
  status: z.enum(["Active", "Onboarding", "Suspended", "Archived"]),
  start: z.iso.date(),
  email: z.union([z.literal(""), z.email()]).default(""),
  phone: z.string().max(30).default(""),
  preferredName: z.string().trim().max(100).optional(),
  dateOfBirth: z.union([z.literal(""), z.iso.date()]).optional(),
  emergencyName: z.string().trim().max(100).optional(),
  emergencyRelationship: z.string().trim().max(100).optional(),
  emergencyPhone: z.string().trim().max(40).optional(),
  identificationType: z.string().trim().max(100).optional(),
  identificationLastFour: z.string().trim().max(4).optional(),
  department: z.string().trim().max(100).optional(),
  lineManager: z.string().trim().max(100).optional(),
  employmentType: z.string().trim().max(100).optional(),
  leavingDate: z.union([z.literal(""), z.iso.date()]).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  county: z.string().trim().max(100).optional(),
  postcode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
});
function fail(message: string, status = 400): never {
  throw new HttpError(status, message);
}
function target(s: State, u: User, id: string) {
  const e = s.employees.find((e) => e.id === id);
  if (!e || !permits(u, e)) fail("Record not available", 404);
  return e;
}
function audit(
  s: State,
  u: User,
  action: string,
  employee: string | null = null,
) {
  s.events.push({
    id: randomUUID(),
    org: u.org,
    employee,
    actor: u.name,
    action,
    at: new Date().toISOString(),
  });
}
function branchAllowed(s: State, u: User, branch: string) {
  if (
    !u.branches.includes(branch) ||
    !s.branches.some((b) => b.id === branch && b.org === u.org)
  )
    fail("Branch not permitted", 403);
}
function checkImport(s: State, u: User, rows: ImportRow[]) {
  const seen = new Set<string>();
  return rows.map((row) => {
    let error = "";
    const parsed = employeeSchema.safeParse({ ...row, phone: "" });
    if (!parsed.success)
      error = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    if (!u.branches.includes(row.branch)) error = "Branch not permitted";
    if (
      seen.has(row.staffId.toLowerCase()) ||
      s.employees.some(
        (e) =>
          e.org === u.org &&
          e.staffId.toLowerCase() === row.staffId.toLowerCase(),
      )
    )
      error = "Duplicate staff ID — resolve before approval";
    seen.add(row.staffId.toLowerCase());
    return { ...row, error };
  });
}
export async function GET(request: Request) {
  try {
    const u = await currentUser();
    const s = await read(u.workspace);
    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || "all";
    if (branch !== "all") branchAllowed(s, u, branch);
    const employees = s.employees.filter(
      (e) => permits(u, e) && (branch === "all" || e.branch === branch),
    );
    const ids = new Set(employees.map((e) => e.id));
    if (url.searchParams.get("export") === "csv") {
      if (!canEdit(u)) fail("Export not permitted", 403);
      const selected = (url.searchParams.get("ids") || "").split(",");
      const rows = employees.filter((e) => selected.includes(e.id));
      await transaction(u.workspace, (s) =>
        audit(s, u, `Exported ${rows.length} employee summaries`),
      );
      return new Response(
        // A byte-order mark so Excel reads names such as "Zoë" as UTF-8 (src/lib/csv.ts does the same).
        CSV_BOM +
          [
            "Name,Branch,Job role,Employment status",
            ...rows.map((e) =>
              [
                e.name,
                s.branches.find((b) => b.id === e.branch)!.name,
                e.job,
                e.status,
              ]
                .map(csvCell)
                .join(","),
            ),
          ].join("\r\n") +
          "\r\n",
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="csb-people.csv"',
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const docs = s.documents.filter(
      (d) =>
        ids.has(d.employee) &&
        (!sensitive(d.category, s.settings[u.org]) || u.sensitive),
    );
    const docIds = new Set(docs.map((d) => d.id));
    return NextResponse.json(
      {
        user: u,
        allBranches: s.branches
          .filter((b) => b.org === u.org)
          .every((b) => u.branches.includes(b.id)),
        today: today(),
        branches: s.branches.filter(
          (b) => b.org === u.org && u.branches.includes(b.id),
        ),
        employees: employees.map((e) => permittedEmployee(e, u)),
        tasks: (s.tasks || [])
          .filter((t) => t.org === u.org && ids.has(t.employee))
          .map((t) => ({
            ...t,
            branch: employees.find((e) => e.id === t.employee)!.branch,
            document: t.document && docIds.has(t.document) ? t.document : null,
          })),
        checks: s.checks
          .filter((c) => ids.has(c.employee))
          .map((c) => ({
            ...c,
            certificateRef: c.certificateRef ? "•••• DEMO" : undefined,
            evidence: c.evidence
              ? docIds.has(c.evidence)
                ? c.evidence
                : "restricted"
              : null,
            restrictedEvidence: !!c.evidence && !docIds.has(c.evidence),
          })),
        documents: docs.map((d) => ({ ...d, key: undefined })),
        events: s.events
          .filter(
            (e) =>
              e.org === u.org &&
              (e.employee
                ? ids.has(e.employee)
                : u.role === "Organisation Admin"),
          )
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 150),
        notes: s.notes.filter(
          (n) =>
            ids.has(n.employee) &&
            canEdit(u) &&
            (!n.document || docIds.has(n.document)),
        ),
        notices: s.notices.filter(
          (n) =>
            n.recipient === u.id &&
            ids.has(n.employee) &&
            n.state === "Delivered",
        ),
        views: s.views.filter((v) => v.user === u.id && v.org === u.org),
        imports: s.imports.filter(
          (i) =>
            u.role === "Organisation Admin" &&
            i.actor === u.id &&
            i.org === u.org &&
            i.rows.every((r) => u.branches.includes(r.branch)),
        ),
        users:
          u.role === "Organisation Admin"
            ? s.users.filter((x) => x.org === u.org)
            : s.users
                .filter(
                  (x) =>
                    x.org === u.org &&
                    x.branches.some((b) => u.branches.includes(b)),
                )
                .map((x) => ({ ...x, sensitive: false })),
        settings: s.settings[u.org],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return error(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await currentUser();
    if (Number(request.headers.get("content-length") || 0) > 1_000_000)
      fail("Request too large", 413);
    await rateLimit(u.id);
    const body = await (await limitedRequest(request, 1_000_000)).json();
    const result = await transaction(u.workspace, (s) => {
      if (body.action === "read-alert") {
        const n = s.notices.find(
          (n) => n.id === body.id && n.recipient === u.id,
        );
        if (!n) fail("Alert not available", 404);
        target(s, u, n.employee);
        n.read = true;
        return { ok: true };
      }
      if (body.action === "save-view") {
        const name = z.string().trim().min(1).max(50).parse(body.name);
        const filters = z.record(z.string(), z.string()).parse(body.filters);
        if (filters.branch && filters.branch !== "all")
          branchAllowed(s, u, filters.branch);
        s.views.push({
          id: randomUUID(),
          org: u.org,
          user: u.id,
          name,
          filters,
          columns: z.array(z.string()).parse(body.columns || []),
        });
        return { ok: true };
      }
      if (!canEdit(u)) fail("Your account is read-only", 403);
      if (body.action === "task") {
        const input = z
          .object({
            employee: z.string(),
            type: z.string().trim().min(2).max(120),
            assignedTo: z.string().default(""),
            due: z.iso.date(),
            priority: z.enum(["Low", "Normal", "High"]),
            status: z.enum([
              "Not started",
              "Waiting on employee",
              "Waiting on HR",
              "Complete",
            ]),
            requirement: z.string().nullable().default(null),
            document: z.string().nullable().default(null),
          })
          .parse(body.task);
        const employee = target(s, u, input.employee);
        if (
          input.assignedTo &&
          !s.users.some(
            (x) =>
              x.id === input.assignedTo &&
              x.org === u.org &&
              x.active &&
              canEdit(x) &&
              x.branches.includes(employee.branch),
          )
        )
          fail("Assignee must be an active HR user with access to this branch");
        if (
          input.requirement &&
          !s.checks.some(
            (c) =>
              c.id === input.requirement &&
              c.employee === employee.id &&
              c.org === u.org,
          )
        )
          fail("Requirement not available", 404);
        if (
          input.document &&
          !s.documents.some(
            (d) =>
              d.id === input.document &&
              d.employee === employee.id &&
              d.org === u.org &&
              (!sensitive(d.category, s.settings[u.org]) || u.sensitive),
          )
        )
          fail("Document not available", 404);
        const now = new Date().toISOString();
        s.tasks ??= [];
        if (body.id) {
          const task = s.tasks.find((t) => t.id === body.id && t.org === u.org);
          if (!task) fail("Task not available", 404);
          target(s, u, task.employee);
          if (task.employee !== employee.id)
            fail("A task cannot move between employees");
          if (task.version !== body.version)
            fail("Task changed. Refresh before saving.", 409);
          Object.assign(task, input, {
            branch: employee.branch,
            updated: now,
            version: task.version + 1,
          });
        } else {
          if (
            s.tasks.some(
              (t) =>
                t.employee === employee.id &&
                t.type === input.type &&
                t.requirement === input.requirement &&
                t.document === input.document &&
                t.status !== "Complete",
            )
          )
            fail("An open task already exists for this action", 409);
          s.tasks.push({
            ...input,
            id: randomUUID(),
            org: u.org,
            branch: employee.branch,
            version: 1,
            created: now,
            updated: now,
            createdBy: u.id,
          });
        }
        audit(
          s,
          u,
          body.id ? "HR task updated" : "HR task created",
          employee.id,
        );
        return { ok: true };
      }
      if (body.action === "employee") {
        const input = employeeSchema.parse(body.employee);
        if (
          !u.sensitive &&
          privateEmployeeFields.some((key) => Object.hasOwn(input, key))
        )
          fail("Sensitive personal details require explicit permission", 403);
        if (input.leavingDate && input.leavingDate < input.start)
          fail("Leaving date cannot be before start date");
        if (
          input.status === "Archived" &&
          (!body.id ||
            s.employees.find((e) => e.id === body.id)?.status !== "Archived") &&
          body.confirmArchive !== true
        )
          fail("Confirm employee archiving");
        branchAllowed(s, u, input.branch);
        if (
          s.employees.some(
            (e) =>
              e.org === u.org &&
              e.staffId.toLowerCase() === input.staffId.toLowerCase() &&
              e.id !== body.id,
          )
        )
          fail("This staff ID already exists");
        let e: Employee;
        if (body.id) {
          e = target(s, u, body.id);
          if (e.version !== body.version)
            fail("This record changed. Refresh before saving.", 409);
          if (e.branch !== input.branch) {
            if (
              u.role !== "Organisation Admin" ||
              body.confirmTransfer !== true
            )
              fail("An administrator must confirm branch transfers", 403);
            audit(
              s,
              u,
              `Branch transferred from ${e.branch} to ${input.branch}`,
              e.id,
            );
          }
          const changes = (
            [
              "job",
              "branch",
              "department",
              "lineManager",
              "employmentType",
              "status",
              "start",
              "leavingDate",
            ] as const
          )
            .filter((key) => input[key] !== undefined && input[key] !== e[key])
            .map(
              (key) =>
                `${key}: ${e[key] || "Not recorded"} → ${input[key] || "Not recorded"}`,
            );
          if (changes.length)
            (e.employmentHistory ??= []).push({
              at: new Date().toISOString(),
              actor: u.name,
              changes,
            });
          if (e.branch !== input.branch)
            for (const task of s.tasks || []) {
              if (task.employee !== e.id) continue;
              task.branch = input.branch;
              const assignee = s.users.find((x) => x.id === task.assignedTo);
              if (!assignee?.branches.includes(input.branch))
                task.assignedTo = "";
              task.version++;
              task.updated = new Date().toISOString();
            }
          Object.assign(e, input, {
            updated: new Date().toISOString(),
            version: e.version + 1,
          });
          audit(s, u, "Employee details updated", e.id);
        } else {
          e = {
            ...input,
            id: randomUUID(),
            org: u.org,
            version: 1,
            updated: new Date().toISOString(),
          };
          s.employees.push(e);
          for (const name of [
            "DBS review",
            "Right to work",
            "Safeguarding training",
          ])
            s.checks.push({
              id: randomUUID(),
              org: u.org,
              employee: e.id,
              name,
              required: true,
              recurring: name !== "Right to work",
              due: null,
              verified: false,
              evidence: null,
              reviewer: null,
              checkedAt: null,
              version: 1,
            });
          audit(s, u, "Employee record created", e.id);
        }
        applyRequirements(s, e);
        runReminders(s, today(), u.org);
        return { id: e.id };
      }
      if (body.action === "note") {
        const e = target(s, u, body.employee);
        const text = z.string().trim().min(1).max(3000).parse(body.text);
        const document = body.document
          ? z.string().parse(body.document)
          : undefined;
        if (
          document &&
          !s.documents.some(
            (d) =>
              d.id === document &&
              d.org === u.org &&
              d.employee === e.id &&
              (!sensitive(d.category, s.settings[u.org]) || u.sensitive),
          )
        )
          fail("Document not available", 404);
        s.notes.push({
          id: randomUUID(),
          org: u.org,
          employee: e.id,
          author: u.name,
          document,
          text,
          at: new Date().toISOString(),
        });
        audit(s, u, "HR note added", e.id);
        return { ok: true };
      }
      if (body.action === "review") {
        const c = s.checks.find((c) => c.id === body.id);
        if (!c) fail("Check not available", 404);
        const e = target(s, u, c.employee);
        if (c.name === "DBS review" && !u.sensitive)
          fail("Sensitive review capability required", 403);
        if (c.version !== body.version)
          fail("Check changed. Refresh before recording.", 409);
        const evidence = s.documents.find(
          (d) =>
            d.id === body.evidence &&
            d.employee === e.id &&
            d.org === u.org &&
            d.state === "Sample",
        );
        if (
          !evidence ||
          (sensitive(evidence.category, s.settings[u.org]) && !u.sensitive)
        )
          fail("Select accessible, released evidence");
        if (evidence.category !== checkCategory(c))
          fail("Evidence category does not match this requirement");
        const due = body.due ? z.iso.date().parse(body.due) : null;
        if (c.recurring && !due)
          fail("A next organisational review date is required");
        if (due && due <= today())
          fail("The next review date must be after today");
        if (body.confirm !== true)
          fail("Confirm that you have reviewed the evidence");
        Object.assign(c, {
          evidence: evidence.id,
          verified: true,
          due,
          checkedAt: new Date().toISOString(),
          reviewer: u.name,
          version: c.version + 1,
        });
        e.updated = new Date().toISOString();
        audit(
          s,
          u,
          `${c.name} verified; next review ${due || "not recurring"}`,
          e.id,
        );
        runReminders(s, today(), u.org);
        return { ok: true };
      }
      if (body.action === "reminders") {
        const count = runReminders(s, today(), u.org);
        audit(
          s,
          u,
          `Reminder job completed: ${count} in-app deliveries created`,
        );
        return { count };
      }
      if (body.action === "stage-import") {
        if (u.role !== "Organisation Admin")
          fail("Administrator approval required", 403);
        const rows = z
          .array(
            z.object({
              staffId: z.string(),
              name: z.string(),
              branch: z.string(),
              job: z.string(),
              status: z.string(),
              start: z.string(),
              email: z.string(),
            }),
          )
          .max(500)
          .min(1)
          .parse(body.rows);
        const id = randomUUID();
        s.imports.push({
          id,
          org: u.org,
          actor: u.id,
          rows: checkImport(s, u, rows),
          state: "Staged",
          at: new Date().toISOString(),
          count: 0,
        });
        audit(s, u, "CSV import staged for validation");
        return { id };
      }
      if (body.action === "approve-import") {
        if (u.role !== "Organisation Admin")
          fail("Administrator approval required", 403);
        const batch = s.imports.find(
          (i) => i.id === body.id && i.org === u.org && i.actor === u.id,
        );
        if (!batch) fail("Import unavailable", 404);
        if (batch.state === "Imported") return { count: batch.count };
        batch.rows = checkImport(s, u, batch.rows);
        if (batch.rows.some((r) => r.error))
          fail("Resolve errors and stage a corrected CSV");
        for (const row of batch.rows) {
          const input = employeeSchema.parse({ ...row, phone: "" });
          const id = randomUUID();
          s.employees.push({
            ...input,
            id,
            org: u.org,
            version: 1,
            updated: new Date().toISOString(),
          });
          for (const name of [
            "DBS review",
            "Right to work",
            "Safeguarding training",
          ])
            s.checks.push({
              id: randomUUID(),
              org: u.org,
              employee: id,
              name,
              required: true,
              recurring: name !== "Right to work",
              due: null,
              verified: false,
              evidence: null,
              reviewer: null,
              checkedAt: null,
              version: 1,
            });
          audit(s, u, "Employee created from approved CSV import", id);
        }
        for (const row of batch.rows) {
          const e = s.employees.find(
            (e) => e.org === u.org && e.staffId === row.staffId,
          )!;
          applyRequirements(s, e);
        }
        batch.state = "Imported";
        batch.count = batch.rows.length;
        audit(
          s,
          u,
          `Approved CSV import: ${batch.count} employees; no accounts or invitations created`,
        );
        return { count: batch.count };
      }
      if (body.action === "settings") {
        if (u.role !== "Organisation Admin")
          fail("Administrator required", 403);
        s.settings[u.org] = {
          ...s.settings[u.org],
          thresholds: z
            .array(z.number().int().min(0).max(365))
            .min(1)
            .max(10)
            .parse(body.thresholds),
          dbsPolicy: z.string().min(10).max(2000).parse(body.dbsPolicy),
          retention: z.string().min(10).max(2000).parse(body.retention),
        };
        audit(s, u, "Review and reminder policy updated");
        return { ok: true };
      }
      if (body.action === "category") {
        if (u.role !== "Organisation Admin")
          fail("Administrator required", 403);
        const name = z.string().trim().min(2).max(60).parse(body.name);
        const restricted = z.boolean().parse(body.sensitive);
        if (["DBS", "Identity", "Right to work"].includes(name) && !restricted)
          fail("Protected categories must remain sensitive");
        const types = s.settings[u.org].documentTypes;
        const existing = types.find((t) => t.name === name);
        if (existing) existing.sensitive = restricted;
        else types.push({ name, sensitive: restricted });
        audit(s, u, `Document category policy updated: ${name}`);
        return { ok: true };
      }
      if (body.action === "requirement") {
        if (u.role !== "Organisation Admin")
          fail("Administrator required", 403);
        const rule = z
          .object({
            id: z.string(),
            name: z.string().trim().min(2).max(80),
            category: z.string(),
            job: z.string().max(100),
            branch: z.string(),
            recurring: z.boolean(),
            enabled: z.boolean(),
          })
          .parse(body.rule);
        if (rule.branch) branchAllowed(s, u, rule.branch);
        if (
          !s.settings[u.org].documentTypes.some((t) => t.name === rule.category)
        )
          fail("Unknown document category");
        const rules = s.settings[u.org].requirements;
        const existing = rules.find((r) => r.id === rule.id);
        if (rules.some((r) => r.name === rule.name && r.id !== rule.id))
          fail("Requirement name already exists");
        if (existing) Object.assign(existing, rule);
        else rules.push({ ...rule, id: randomUUID() });
        for (const e of s.employees.filter((e) => e.org === u.org))
          applyRequirements(s, e);
        audit(s, u, `Review requirement updated: ${rule.name}`);
        runReminders(s, today(), u.org);
        return { ok: true };
      }
      if (body.action === "branch") {
        if (u.role !== "Organisation Admin")
          fail("Administrator required", 403);
        const name = z.string().trim().min(2).max(80).parse(body.name);
        if (
          s.branches.some(
            (b) =>
              b.org === u.org && b.name.toLowerCase() === name.toLowerCase(),
          )
        )
          fail("Branch already exists");
        const id = randomUUID();
        s.branches.push({ id, org: u.org, name });
        for (const account of s.users.filter(
          (a) =>
            a.org === u.org &&
            ["Organisation Admin", "Group HR"].includes(a.role),
        ))
          account.branches.push(id);
        audit(s, u, `Branch created: ${name}`);
        return { id };
      }
      if (body.action === "account") {
        if (u.role !== "Organisation Admin")
          fail("Administrator required", 403);
        const account = s.users.find(
          (x) => x.id === body.id && x.org === u.org,
        );
        if (!account || account.id === u.id)
          fail("You cannot change your own access");
        const branches = z.array(z.string()).min(1).parse(body.branches);
        branches.forEach((b) => branchAllowed(s, u, b));
        account.branches = branches;
        account.role = z
          .enum([
            "Organisation Admin",
            "Group HR",
            "Branch HR",
            "Branch Viewer",
          ])
          .parse(body.role);
        account.sensitive = z.boolean().parse(body.sensitive);
        account.active = z.boolean().parse(body.active);
        audit(s, u, `Authorised account access updated: ${account.name}`);
        runReminders(s, today(), u.org);
        return { ok: true };
      }
      fail("Unknown operation");
    });
    return NextResponse.json(result);
  } catch (e) {
    return error(e);
  }
}
function error(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : "Request failed",
    },
    { status: e instanceof HttpError ? e.status : 400 },
  );
}
