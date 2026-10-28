import { type Doc, type Check } from "./domain";
export const documentGroups = [
  "DBS & Safeguarding",
  "Right to Work & ID",
  "Training & Qualifications",
  "Employment",
  "References",
  "Supervisions & Appraisals",
  "Other HR",
] as const;
export function documentGroup(category: string, name = "") {
  const text = (category + " " + name).toLowerCase();
  if (/dbs|safeguard/.test(text)) return documentGroups[0];
  if (/right to work|identity|passport/.test(text)) return documentGroups[1];
  if (/supervision|appraisal/.test(text)) return documentGroups[5];
  if (/training|qualification|first aid|manual handling|driving/.test(text))
    return documentGroups[2];
  if (/reference/.test(text)) return documentGroups[4];
  if (/contract|employment/.test(text)) return documentGroups[3];
  return documentGroups[6];
}
export function documentTitle(d: Doc, checks: Check[] = []) {
  const linked = checks.find((c) => c.evidence === d.id);
  if (linked)
    return linked.name === "DBS review" ? "DBS certificate" : linked.name;
  if (d.category === "DBS") return "DBS certificate";
  if (d.category === "Right to work") return "Right to Work evidence";
  return d.category + " document";
}
