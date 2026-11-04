import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, dbDate, isIsoDate, londonDate } from "@/lib/london";
import { ValidationError } from "@/lib/errors";
import { requireOrgPermission, hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";
import { createServiceUser, addContact, setServiceUserStatus } from "@/server/care/service-users";
import { PLAN_SECTIONS, startDraft, saveDraft, draftFingerprint } from "@/server/care/care-plans";
import { createPackage } from "@/server/care/packages";
import { createTemplate } from "@/server/rota/templates";
import { createVisit } from "@/server/rota/visits";
import { uploadDocument, type UploadedFile } from "@/server/care/su-documents";
import { createRiskDraft } from "@/server/care/risks";

/**
 * Explicit human-approved, tenant-scoped intake.
 * No LLM content is executed as code. The data is validated against this bounded schema,
 * then passed to existing authorised domain services and audited by those services.
 * This is NOT an autonomous clinical approval or rota publishing interface.
 */
const date = z.string().refine(isIsoDate, "Use an ISO date (YYYY-MM-DD)");
const contact = z.object({
  kind: z.enum(["NEXT_OF_KIN", "FAMILY", "GP", "PHARMACY", "SOCIAL_WORKER", "DISTRICT_NURSE", "OTHER"]),
  name: z.string().min(2).max(200),
  relationship: z.string().max(500).optional(),
  phone: z.string().max(500).optional(),
  altPhone: z.string().max(500).optional(),
  isEmergency: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
  canReceiveUpdates: z.boolean().default(false),
});
const visit = z.object({
  label: z.string().min(2).max(80),
  callTypeId: z.string().min(1),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  durationMin: z.number().int().min(5).max(1440),
  carersRequired: z.number().int().min(1).max(20),
  notes: z.string().max(2000),
  medicationRequired: z.boolean().default(false),
});
export const intakeSchema = z.object({
  serviceUser: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    dateOfBirth: date.optional(),
    gender: z.string().max(500).optional(),
    areaId: z.string().min(1),
    addressLine1: z.string().max(500).optional(),
    addressLine2: z.string().max(500).optional(),
    town: z.string().max(500).optional(),
    postcode: z.string().max(10).optional(),
    phone: z.string().max(500).optional(),
    firstLanguage: z.string().max(500).optional(),
    communicationNeeds: z.string().max(2000).optional(),
    carePreferences: z.string().max(2000).optional(),
    carerGenderPreference: z.enum(["ANY","FEMALE","MALE"]).default("ANY"),
  }),
  contacts: z.array(contact).max(20).default([]),
  carePlan: z.object({
    summary: z.string().min(3).max(2000),
    reviewDue: date,
    sections: z.record(z.string(), z.object({
      body: z.string().max(10000),
      outcomes: z.string().max(4000).optional(),
    })),
  }),
  package: z.object({
    startDate: date,
    endDate: date,
    commissionedMinutesPerWeek: z.number().int().min(0).max(20160).optional(),
    requirements: z.string().max(2000).optional(),
  }),
  visits: z.array(visit).min(1).max(30),
  riskDrafts: z.array(z.object({
    type: z.enum(["ENVIRONMENT","MOVING_HANDLING","FALLS","PRESSURE_SKIN","MEDICATION_SUPPORT","NUTRITION","LONE_WORKING","OTHER"]),
    title: z.string().min(3).max(160),
    hazards: z.string().min(10).max(4000),
    controls: z.string().min(10).max(4000),
    level: z.enum(["LOW","MEDIUM","HIGH"]),
    reviewDue: date,
    requiredActions: z.string().max(4000).optional(),
    responsiblePerson: z.string().max(160).optional(),
  })).max(25).default([]),
  // Optional future week to create actual unpublished visits, otherwise only recurring templates.
  draftWeekStart: date.optional(),
  // Operator approval is separate from document extraction and is required on execution.
  approvalPhrase: z.literal("I APPROVE DRAFT RECORD CREATION").optional(),
  clinicalReviewNotes: z.array(z.string().max(500)).max(50).default([]),
  riskReviewNotes: z.array(z.string().max(500)).max(50).default([]),
}).strict().superRefine((data, ctx) => {
  if (data.package.endDate < data.package.startDate) ctx.addIssue({code:"custom",path:["package","endDate"],message:"End date is before start date"});
  const used = new Set<number>();
  for (const v of data.visits) for (const d of v.weekdays) {
    const key = d * 1440 + v.startMinute;
    if (used.has(key)) ctx.addIssue({code:"custom",path:["visits"],message:"Two proposed visits have the same day and start time"});
    used.add(key);
  }
  if (data.contacts.filter(c => c.isPrimary).length > 1) ctx.addIssue({code:"custom",path:["contacts"],message:"Only one primary contact permitted"});
});
export type Intake = z.infer<typeof intakeSchema>;

function monday(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0,10);
}
function weekday(iso: string) {
  return new Date(iso + "T12:00:00Z").getUTCDay() || 7;
}

export async function previewIntake(ctx: Ctx, raw: unknown) {
  const scope = await rotaScope(ctx,"serviceUser.edit");
  requireOrgPermission(ctx,"care.plan.edit");
  requireOrgPermission(ctx,"rota.edit");
  const parsed = intakeSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i=>i.path.join(".")+": "+i.message).slice(0,5).join("; "));
  const d = parsed.data;
  const area = await db.area.findFirst({where:{organisationId:scope.organisationId,id:d.serviceUser.areaId,active:true}});
  if (!area || (scope.areaIds && !scope.areaIds.includes(area.id))) throw new ValidationError("Choose an authorised active area");
  const callTypes = await db.callType.findMany({where:{organisationId:scope.organisationId,id:{in:d.visits.map(v=>v.callTypeId)},active:true},select:{id:true}});
  if (new Set(callTypes.map(c=>c.id)).size!==new Set(d.visits.map(v=>v.callTypeId)).size) throw new ValidationError("One or more call types do not belong to your organisation");
  const existing = await db.serviceUser.findMany({where:{
    ...serviceUserWhere(scope),firstName:{equals:d.serviceUser.firstName,mode:"insensitive"},
    lastName:{equals:d.serviceUser.lastName,mode:"insensitive"},
    postcode:{equals:d.serviceUser.postcode || "",mode:"insensitive"}
  },select:{id:true},take:2});
  if (existing.length) throw new ValidationError("A possible matching service user already exists. Review the existing record before importing to avoid duplication.");
  const templateMinutes = d.visits.reduce((n,v)=>n+v.durationMin*v.weekdays.length,0);
  const weeklyMinutes = d.package.commissionedMinutesPerWeek;
  if (weeklyMinutes !== undefined && weeklyMinutes !== templateMinutes)
    throw new ValidationError("Commissioned minutes and proposed weekly rota do not match. Resolve council/family-care differences before saving.");
  if (d.carePlan.reviewDue <= londonDate()) throw new ValidationError("The care plan review date must be in the future");
  if (d.draftWeekStart && (monday(d.draftWeekStart)!==d.draftWeekStart || d.draftWeekStart<londonDate()))
    throw new ValidationError("Draft week must begin on a future or current Monday; past weeks cannot be imported");
  if (d.draftWeekStart && d.draftWeekStart>d.package.endDate) throw new ValidationError("Draft week starts after package end");
  const invalidSections=Object.keys(d.carePlan.sections).filter(k=>!PLAN_SECTIONS.some(s=>s.key===k));
  if(invalidSections.length) throw new ValidationError("Unexpected care-plan section: "+invalidSections.join(", "));
  if(PLAN_SECTIONS.some(s=>!(d.carePlan.sections[s.key]?.body.trim())))
    throw new ValidationError("Provide all nine care plan sections, stating 'not documented — needs review' where applicable");
  return {data:d,weeklyMinutes:templateMinutes,visitTemplates:d.visits.length,contacts:d.contacts.length,riskDrafts:d.riskDrafts.length,requiresClinicalReview:true};
}

export async function executeIntake(ctx: Ctx, raw: unknown, files?: {supportPlan?:UploadedFile;discharge?:UploadedFile}) {
  const preview = await previewIntake(ctx,raw);
  const d=preview.data;
  if(d.approvalPhrase!=="I APPROVE DRAFT RECORD CREATION") throw new ValidationError("Explicit approval is required before creating records");
  requireOrgPermission(ctx,"serviceUser.documents");
  if(files?.discharge && !hasOrgPermission(ctx,"serviceUser.sensitive"))
    throw new ValidationError("Sensitive document upload requires manager permission");
  // Fail closed on unsupported file sizes before creating the user.
  for(const f of [files?.supportPlan,files?.discharge].filter((v):v is UploadedFile=>!!v)) {
    if(f.bytes.length>4*1024*1024) throw new ValidationError("Document exceeds the 4 MB CRM limit");
  }
  const steps:string[]=[];
  // Domain services have their own transactions and audit records. Failure returns
  // the created service user id for a coordinator to resume MANUALLY, not resubmit.
  let serviceUserId:string|null=null;
  try {
    const su=await createServiceUser(ctx,d.serviceUser);
    serviceUserId=su.id;
    steps.push("Service user created in Assessment");
    for(const c of d.contacts) await addContact(ctx,su.id,{...c,email:"",preferredContactMethod:"",authorityType:""});
    steps.push(d.contacts.length+" contacts added");
    if(files?.supportPlan) {
      await uploadDocument(ctx,su.id,"COUNCIL",{name:"Council Support Plan",category:"COUNCIL_SUPPORT_PLAN",markSensitive:false},files.supportPlan);
      steps.push("Council Support Plan stored");
    }
    if(files?.discharge) {
      await uploadDocument(ctx,su.id,"OTHER",{name:"Hospital Discharge Letter",category:"DISCHARGE_INFORMATION",markSensitive:true},files.discharge);
      steps.push("Restricted hospital discharge letter stored");
    }
    const draft=await startDraft(ctx,su.id);
    const saved=await db.carePlan.findFirstOrThrow({where:{id:draft.id},include:{sections:true}});
    await saveDraft(ctx,draft.id,{fingerprint:draftFingerprint(saved,saved.sections),...d.carePlan});
    steps.push("Nine-section care plan saved as DRAFT, not approved");
    for(const r of d.riskDrafts) await createRiskDraft(ctx,su.id,r);
    steps.push(d.riskDrafts.length+" DRAFT risk assessments recorded for independent review");
    await createPackage(ctx,su.id,{...d.package});
    steps.push("Care package entered");
    for(const v of d.visits) {
      await createTemplate(ctx,{
        serviceUserId:su.id,callTypeId:v.callTypeId,areaId:d.serviceUser.areaId,
        cycleWeeks:[1,2,3,4],weekdays:v.weekdays,
        startMinute:v.startMinute,durationMin:v.durationMin,carersRequired:v.carersRequired,
        preferredStaff1Id:null,preferredStaff2Id:null,extraPreferredStaffIds:[],shadowStaffId:null,
        timeLocked:false,medicationRequired:v.medicationRequired,alertOnLate:true,
        rotaType:"NORMAL",runRouteTemplateId:null,effectiveFrom:d.package.startDate,
        effectiveTo:d.package.endDate,notes:v.label+": "+v.notes,taskIds:[],
      });
    }
    steps.push(d.visits.length+" recurring visit templates created, no carers assigned");
    // No automatic activation. The coordinator/manager must activate the person
    // after verifying clinical instructions, care plan and package, then build the rota.
    if(d.draftWeekStart) steps.push("Rota week "+d.draftWeekStart+" prepared; activation and build require separate approval");
    return {serviceUserId:su.id,steps,blocked:["Care-plan approval","Risk assessments require human review","Medication reconciliation","Service-user activation","Build rota and staff allocation","Rota publication"],weeklyMinutes:preview.weeklyMinutes};
  } catch(e) {
    throw new ValidationError("Intake stopped after: "+steps.join("; ")+". "+(serviceUserId?"Created serviceUserId="+serviceUserId+". Do not resubmit; inspect that record and resume manually. ":"No service user created. ")+(e instanceof Error?e.message:"Unexpected error"));
  }
}

/**
 * Phase two: a MANAGER-approved, explicitly triggered one-week build.
 * Care plan must already be approved by an independent person and at least one
 * care risk assessment must have been completed. No carer is allocated, and
 * visits are never published by this function.
 */
export async function activateAndBuildApprovedWeek(ctx: Ctx, serviceUserId: string, weekStart: string) {
  const org=requireOrgPermission(ctx,"care.plan.approve");
  requireOrgPermission(ctx,"rota.edit");
  const scope=await rotaScope(ctx,"serviceUser.edit");
  if(!isIsoDate(weekStart) || weekStart!==monday(weekStart) || weekStart<londonDate())
    throw new ValidationError("Choose a current or future Monday");
  const su=await db.serviceUser.findFirst({where:{...serviceUserWhere(scope),id:serviceUserId},include:{
    carePlans:{where:{status:"ACTIVE"},select:{id:true},take:1},
    packages:{where:{status:"ACTIVE"},take:1},
    templates:{where:{enabled:true},orderBy:{startMinute:"asc"}},
  }});
  if(!su || su.organisationId!==org) throw new ValidationError("Service user not found in your scope");
  if(su.status!=="ASSESSMENT" && su.status!=="ACTIVE") throw new ValidationError("Person must be in Assessment or Active status");
  if(!su.carePlans.length) throw new ValidationError("An independently approved care plan is required");
  const riskCount=await db.riskAssessment.count({where:{organisationId:org,serviceUserId:su.id,status:"ACTIVE"}});
  if(riskCount<1) throw new ValidationError("An authorised assessor must complete risk assessments before visits are generated");
  const pkg=su.packages[0];
  if(!pkg || pkg.startDate>dbDate(weekStart) || (pkg.endDate && pkg.endDate<dbDate(weekStart)))
    throw new ValidationError("There is no authorised care package for the selected week");
  if(!su.templates.length) throw new ValidationError("No enabled recurring templates found");
  // Existing visit patterns are used; no new medical or care tasks are inferred.
  if(su.status==="ASSESSMENT") await setServiceUserStatus(ctx,su.id,"ACTIVE","Human-approved care plan and package setup");
  const created:string[]=[],existing:string[]=[],errors:string[]=[];
  for(let offset=0;offset<7;offset++){
    const day=addDays(weekStart,offset);
    if(day<londonDate() || (pkg.endDate && pkg.endDate<dbDate(day))) continue;
    for(const v of su.templates){
      if(!v.weekdays.includes(weekday(day)) ||
         (v.effectiveFrom && v.effectiveFrom>dbDate(day)) ||
         (v.effectiveTo && v.effectiveTo<dbDate(day))) continue;
      // Do not create a duplicate from an already built or manually created visit.
      const existingVisit=await db.visit.findFirst({where:{
        organisationId:org,serviceUserId:su.id,date:dbDate(day),callTypeId:v.callTypeId,
        scheduledStart:{gte:new Date(day+"T00:00:00Z"),lt:new Date(addDays(day,1)+"T00:00:00Z")},
      },select:{id:true,scheduledStart:true,scheduledEnd:true}});
      // Multiple visits can share a call type. Inspect their actual London clock.
      // A candidate requires exact UTC instant matching the template's London time.
      const {londonToUtc}=await import("@/lib/london");
      const expected=londonToUtc(day,v.startMinute);
      const exact=existingVisit?.scheduledStart.getTime()===expected.getTime()
        ? existingVisit
        : await db.visit.findFirst({where:{
          organisationId:org,serviceUserId:su.id,date:dbDate(day),scheduledStart:expected,
        },select:{id:true}});
      if(exact){existing.push(exact.id);continue;}
      try{
        const visit=await createVisit(ctx,{serviceUserId:su.id,callTypeId:v.callTypeId,date:day,
          startMinute:v.startMinute,durationMin:v.durationMin,carersRequired:v.carersRequired,
          medicationRequired:v.medicationRequired,timeLocked:v.timeLocked,
          notes:v.notes || undefined,publish:false});
        created.push(visit.id);
      }catch(e){errors.push(day+" "+v.startMinute+": "+(e instanceof Error?e.message:"Unable to create visit"));}
    }
  }
  return {serviceUserId:su.id,created:created.length,alreadyPresent:existing.length,errors,
    pending:["Check rota allocations and compliance","Assign eligible carers","Manager publishes visits after review"]};
}
