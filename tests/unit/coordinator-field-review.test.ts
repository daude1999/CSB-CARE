import { describe,it,expect } from "vitest";
import { reviewFieldSchema, reviewMatchesManifest, expectedDestination, structuredValues } from "../../src/server/care/coordinator-field-review";
const manifest={
  serviceUser:{firstName:"Fictional",lastName:"Person",areaId:"area-demo",carerGenderPreference:"ANY"},
  contacts:[],
  carePlan:{summary:"Fictional support overview",reviewDue:"2027-03-01",sections:{about_me:{body:"Fictional preferences"}}},
  package:{startDate:"2026-11-09",endDate:"2026-12-30"},
  visits:[{label:"Morning",callTypeId:"call-demo",weekdays:[1,2,3,4,5,6,7],startMinute:540,
    durationMin:60,carersRequired:1,notes:"Fictional task",taskIds:[],medicationRequired:false}],
  riskDrafts:[],
};
function reviews(){
  return [...structuredValues(manifest).entries()].map(([fieldPath,proposedValue],i)=>({
    id:"fact-"+i,destination:expectedDestination(fieldPath)!,fieldPath,label:fieldPath,
    sourceDocument:"fictional-plan.pdf",sourcePage:8,confidence:"HIGH" as const,
    proposedValue,decision:"APPROVE" as const,reviewedBy:"Demo coordinator",
  }));
}
describe("Care Coordinator field review",()=>{
  it("accepts sourced fields mapped to exact paths",()=>{
    const rows=reviews();
    expect(rows.length).toBeGreaterThan(10);
    rows.forEach(row=>expect(reviewFieldSchema.safeParse(row).success).toBe(true));
    expect(reviewMatchesManifest(manifest,rows)).toEqual([]);
  });
  it("rejects differences between reviewed values and actual writes",()=>{
    const rows=reviews();
    rows[0]={...rows[0]!,proposedValue:"Different"};
    expect(reviewMatchesManifest(manifest,rows).join(" ")).toContain("does not match");
  });
  it("requires every structured field to be reviewed",()=>{
    expect(reviewMatchesManifest(manifest,reviews().slice(1)).join(" ")).toContain("Missing field-level approval");
  });
  it("rejects unsupported and low-confidence writes",()=>{
    const rows=reviews();
    rows[0]={...rows[0]!,decision:"REJECT",reason:"Unsupported"};
    expect(reviewMatchesManifest(manifest,rows).join(" ")).toContain("unapproved");
    const low=reviews(); low[0]={...low[0]!,confidence:"LOW"};
    expect(reviewMatchesManifest(manifest,low).join(" ")).toContain("low-confidence");
  });
  it("flags wrong destinations and duplicate reviews",()=>{
    const rows=reviews();rows[0]={...rows[0]!,destination:"care.medication"};
    expect(reviewMatchesManifest(manifest,rows).join(" ")).toContain("destination does not match");
    expect(reviewMatchesManifest(manifest,[...reviews(),reviews()[0]!]).join(" ")).toContain("Multiple reviews");
  });
  it("keeps clinical historical events review-only",()=>{
    const item={
      id:"historical-incident",destination:"health.incidents" as const,fieldPath:"historical.incident.0",
      label:"Historical incident",sourceDocument:"fictional-plan.pdf",sourcePage:3,confidence:"HIGH" as const,
      proposedValue:"Historical event",decision:"CLARIFY" as const,reason:"Verify source date and context",
    };
    expect(reviewMatchesManifest(manifest,[...reviews(),item])).toEqual([]);
  });
});
