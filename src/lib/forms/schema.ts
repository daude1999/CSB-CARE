import { z } from "zod";

/**
 * The field schema of an on-screen form (Forms PR 2). A form version stores a list of fields as JSON; this module
 * validates that list and validates answers against it. It is pure data: no field carries code, so nothing in a form
 * definition can run in the browser or on the server.
 */

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Field keys are short lower-case words");
const Text = z.string().trim().min(1).max(600);

const ShowIf = z.object({ field: Key, equals: z.union([z.string().max(80), z.boolean()]) }).strict();

const base = {
  key: Key,
  label: Text,
  help: z.string().max(600).optional(),
  showIf: ShowIf.optional(),
  /** Answers to a sensitive field are shown only to the author and the form's reviewers (the default for every record). */
  sensitive: z.boolean().optional(),
};
const answerable = { ...base, required: z.boolean().default(false) };

export const FormField = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), ...base }).strict(),
  z.object({ type: z.literal("instructions"), ...base }).strict(),
  z.object({ type: z.literal("text"), ...answerable, maxLength: z.number().int().min(1).max(500).default(200) }).strict(),
  z.object({ type: z.literal("longtext"), ...answerable, maxLength: z.number().int().min(1).max(5000).default(2000) }).strict(),
  z.object({ type: z.literal("date"), ...answerable, notInFuture: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("time"), ...answerable }).strict(),
  z.object({ type: z.literal("number"), ...answerable, min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({ type: z.literal("yesno"), ...answerable }).strict(),
  z.object({ type: z.literal("select"), ...answerable, options: z.array(z.string().min(1).max(80)).min(2).max(30) }).strict(),
  z.object({ type: z.literal("multiselect"), ...answerable, options: z.array(z.string().min(1).max(80)).min(2).max(30) }).strict(),
  /** "I confirm…" statement the person ticks; recorded with their name and the time of submission. */
  z.object({ type: z.literal("attestation"), ...answerable }).strict(),
]);
export type FormField = z.infer<typeof FormField>;
export type FieldType = FormField["type"];

export const FormSchema = z
  .array(FormField)
  .min(1)
  .max(120)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const [i, f] of fields.entries()) {
      if (seen.has(f.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field key ${f.key}`, path: [i, "key"] });
      if (f.showIf && !seen.has(f.showIf.field)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${f.key} depends on a later or unknown field`, path: [i, "showIf"] });
      seen.add(f.key);
    }
  });
export type FormSchema = z.infer<typeof FormSchema>;

export const StoredAnswers = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]));
export type Answers = z.infer<typeof StoredAnswers>;
export type AnswerValue = Answers[string];

export const isAnswerable = (f: FormField): f is Extract<FormField, { required: boolean }> => f.type !== "heading" && f.type !== "instructions";

/** Whether a field is shown, given the answers so far (fields hidden by a condition are not asked or stored). */
export function isVisible(f: FormField, answers: Answers): boolean {
  if (!f.showIf) return true;
  return answers[f.showIf.field] === f.showIf.equals;
}

const blank = (v: AnswerValue | undefined) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Reads raw values (from a form post: strings, or string lists for multi-select) into typed answers for the schema's
 * visible fields, and checks them. `final` (submission) also requires every required visible field. Unknown keys are
 * dropped. Returns field-level errors in plain words.
 */
export function readAnswers(schema: FormSchema, raw: Record<string, string | string[] | undefined>, opts: { final: boolean; today?: string }) {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const f of schema) {
    if (!isAnswerable(f)) continue;
    if (!isVisible(f, answers)) continue;
    const r = raw[f.key];
    const one = (Array.isArray(r) ? r[0] : r)?.trim() ?? "";
    switch (f.type) {
      case "text":
      case "longtext":
        if (one.length > f.maxLength) errors[f.key] = `Keep this to ${f.maxLength} characters`;
        else if (one) answers[f.key] = one;
        break;
      case "date":
        if (one && !/^\d{4}-\d{2}-\d{2}$/.test(one)) errors[f.key] = "Enter a date";
        else if (one && f.notInFuture && opts.today && one > opts.today) errors[f.key] = "This date cannot be in the future";
        else if (one) answers[f.key] = one;
        break;
      case "time":
        if (one && !/^([01]\d|2[0-3]):[0-5]\d$/.test(one)) errors[f.key] = "Enter a time, for example 14:30";
        else if (one) answers[f.key] = one;
        break;
      case "number": {
        if (!one) break;
        const n = Number(one);
        if (!Number.isFinite(n)) errors[f.key] = "Enter a number";
        else if (f.min !== undefined && n < f.min) errors[f.key] = `Enter ${f.min} or more`;
        else if (f.max !== undefined && n > f.max) errors[f.key] = `Enter ${f.max} or less`;
        else answers[f.key] = n;
        break;
      }
      case "yesno":
        if (one === "yes") answers[f.key] = true;
        else if (one === "no") answers[f.key] = false;
        else if (one) errors[f.key] = "Choose yes or no";
        break;
      case "select":
        if (one && !f.options.includes(one)) errors[f.key] = "Choose one of the options";
        else if (one) answers[f.key] = one;
        break;
      case "multiselect": {
        const list = (Array.isArray(r) ? r : r ? [r] : []).map((x) => x.trim()).filter(Boolean);
        if (list.some((x) => !f.options.includes(x))) errors[f.key] = "Choose from the options";
        else if (list.length) answers[f.key] = [...new Set(list)];
        break;
      }
      case "attestation":
        if (one === "on" || one === "true") answers[f.key] = true;
        break;
    }
    if (opts.final && f.required && !errors[f.key] && blank(answers[f.key])) {
      errors[f.key] = f.type === "attestation" ? "Tick to confirm before submitting" : "Answer this question before submitting";
    }
  }
  return { answers, errors };
}

/** A stored answer as plain text, for the record view and print. */
export function answerText(f: FormField, v: AnswerValue | undefined): string {
  if (v === undefined || v === "") return "Not answered";
  if (f.type === "yesno") return v === true ? "Yes" : "No";
  if (f.type === "attestation") return v === true ? "Confirmed" : "Not confirmed";
  if (Array.isArray(v)) return v.join(", ");
  if (f.type === "date" && typeof v === "string") return new Date(v + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return String(v);
}
