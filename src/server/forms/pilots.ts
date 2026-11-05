import { createHash } from "node:crypto";
import type { z } from "zod";
import type { OrgRole } from "@prisma/client";
import { db } from "@/lib/db";
import { FormSchema } from "@/lib/forms/schema";

/**
 * The CSB forms staff can fill in on screen (Forms PR 2/3 pilot). Original CSB wording, based on the downloadable
 * CSB-FRM-020 and CSB-FRM-013. Two low-risk office forms were chosen first; clinical and safeguarding forms stay
 * downloadable, or go through their existing CRM workflows, until they have been professionally reviewed.
 *
 * `syncPilotForms()` makes the database match this file: it creates each CSB form once and publishes a new version
 * only when its fields or instructions change (records keep the version they were started on).
 */
type Pilot = {
  ref: string;
  title: string;
  description: string;
  categoryCode: string;
  completeRoles: OrgRole[];
  reviewRoles: OrgRole[];
  subjectType: "SELF" | null;
  /** CRM records a copy may be linked to (the person the form is about). */
  linkTypes: ("SERVICE_USER" | "STAFF_MEMBER")[];
  instructions: string;
  changeSummary: string;
  fields: z.input<typeof FormSchema>;
};

const EVERYONE: OrgRole[] = ["ORG_ADMIN", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER", "COMPLIANCE_LEAD", "STAFF", "CARE_MANAGER", "CARE_COORDINATOR", "CARER", "FINANCE_OFFICER"];

export const PILOT_FORMS: Pilot[] = [
  {
    ref: "CSB-FRM-020",
    title: "Staff Disclosure and Declaration of Interests",
    description: "Your own declaration of new convictions or investigations, registration conditions, relationships and outside interests. Your manager reviews it.",
    categoryCode: "RECRUITMENT",
    completeRoles: EVERYONE,
    reviewRoles: ["ORG_ADMIN", "COMPLIANCE_LEAD"],
    subjectType: "SELF",
    // A declaration is already about its author, so it shows on their staff record without a separate link.
    linkTypes: [],
    instructions: "Complete this before you start work and again each year. A declaration does not automatically stop you working: your manager looks at each one and decides what, if anything, needs to happen. Only you and the people who review declarations can see it.",
    changeSummary: "First on-screen version, based on the CSB-FRM-020 document.",
    fields: [
      { type: "heading", key: "conduct", label: "Conduct" },
      { type: "yesno", key: "new_conduct", label: "Since your last DBS check or declaration, have you had a new conviction, caution, warning or reprimand, or been told you are under police investigation?", required: true },
      { type: "longtext", key: "conduct_details", label: "Give the details, with dates", required: true, maxLength: 2000, showIf: { field: "new_conduct", equals: true }, sensitive: true },
      { type: "yesno", key: "registration_conditions", label: "Do you have any conditions or restrictions on a professional registration?", required: true },
      { type: "longtext", key: "registration_details", label: "Which registration, and what are the conditions?", required: true, maxLength: 2000, showIf: { field: "registration_conditions", equals: true }, sensitive: true },
      { type: "heading", key: "interests", label: "Interests" },
      { type: "yesno", key: "relationships", label: "Are you related to, or in a close personal relationship with, anyone we support or a member of their family?", required: true },
      { type: "longtext", key: "relationship_details", label: "Who, and what is the relationship?", required: true, maxLength: 2000, showIf: { field: "relationships", equals: true }, sensitive: true },
      { type: "yesno", key: "other_work", label: "Do you have other paid or unpaid work?", required: true },
      { type: "text", key: "other_work_details", label: "Where, and your usual hours each week", required: true, maxLength: 200, showIf: { field: "other_work", equals: true } },
      { type: "yesno", key: "business_interests", label: "Do you have a business interest connected to the service, for example in a supplier or another care provider?", required: true },
      { type: "longtext", key: "business_details", label: "Describe the interest", required: true, maxLength: 2000, showIf: { field: "business_interests", equals: true } },
      { type: "heading", key: "declaration", label: "Declaration" },
      { type: "attestation", key: "confirm", label: "I confirm this information is true and complete, and I will tell my manager straight away if anything changes.", required: true },
    ],
  },
  {
    ref: "CSB-FRM-013",
    title: "Subject Access Request Log",
    description: "A log entry for one request from a person for a copy of their information: when it arrived, identity checks, the due date and how it was answered.",
    categoryCode: "DATA_PROTECTION",
    completeRoles: ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR"],
    reviewRoles: ["ORG_ADMIN", "COMPLIANCE_LEAD"],
    subjectType: null,
    linkTypes: ["SERVICE_USER", "STAFF_MEMBER"],
    instructions: "Start an entry on the day a request arrives, however it is made, and save it as a draft as you go. Submit it for review once the response has been sent. Record only what is needed to identify the request: the information itself stays in its own records.",
    changeSummary: "First on-screen version, based on the CSB-FRM-013 document.",
    fields: [
      { type: "heading", key: "request", label: "Request" },
      { type: "date", key: "received_on", label: "Date the request was received", required: true, notInFuture: true },
      { type: "select", key: "received_how", label: "How it was received", required: true, options: ["Email", "Letter", "Telephone", "In person", "Other"] },
      { type: "select", key: "requester_type", label: "Who made the request", required: true, options: ["The person themselves", "Someone acting for the person", "A member of staff, about their own records", "Other"] },
      { type: "text", key: "requester_reference", label: "Requester's name or reference", required: true, maxLength: 120, help: "Enough to identify the request, nothing more.", sensitive: true },
      { type: "longtext", key: "information_requested", label: "Information requested", required: true, maxLength: 2000 },
      { type: "yesno", key: "identity_verified", label: "Has the requester's identity been checked?", required: true },
      { type: "text", key: "identity_how", label: "How it was checked, and on what date", required: true, maxLength: 200, showIf: { field: "identity_verified", equals: true } },
      { type: "select", key: "authority_checked", label: "If someone is acting for the person, has their authority been checked?", required: true, options: ["Yes", "No", "Not applicable"] },
      { type: "heading", key: "response", label: "Response" },
      { type: "date", key: "due_on", label: "Date the response is due", required: true, help: "Usually one calendar month from the date received." },
      { type: "yesno", key: "extended", label: "Was the deadline extended?", required: true },
      { type: "longtext", key: "extension_reason", label: "Why, and the new due date", required: true, maxLength: 1000, showIf: { field: "extended", equals: true } },
      { type: "longtext", key: "withheld", label: "Information withheld, and the exemption relied on", maxLength: 2000, help: "Leave blank if nothing was withheld." },
      { type: "date", key: "sent_on", label: "Date the response was sent", required: true, notInFuture: true },
      { type: "select", key: "sent_format", label: "How it was sent", required: true, options: ["Secure email", "Post", "Collected in person", "Other"] },
    ],
  },
];

const hashOf = (p: Pilot) => createHash("sha256").update(JSON.stringify({ fields: p.fields, instructions: p.instructions })).digest("hex");

/** Creates or updates the CSB pilot forms. Idempotent; returns how many new versions were published. */
export async function syncPilotForms(): Promise<number> {
  let published = 0;
  for (const p of PILOT_FORMS) {
    const fields = FormSchema.parse(p.fields);
    const hash = hashOf(p);
    await db.$transaction(async (tx) => {
      const meta = { title: p.title, description: p.description, categoryCode: p.categoryCode, completeRoles: p.completeRoles, reviewRoles: p.reviewRoles, subjectType: p.subjectType, linkTypes: p.linkTypes };
      const existing = await tx.formDefinition.findFirst({ where: { organisationId: null, ref: p.ref }, include: { currentVersion: true } });
      const def = existing ? await tx.formDefinition.update({ where: { id: existing.id }, data: meta }) : await tx.formDefinition.create({ data: { ...meta, ref: p.ref } });
      if (existing?.currentVersion?.contentHash === hash) return;
      const last = await tx.formVersion.aggregate({ where: { definitionId: def.id }, _max: { versionNumber: true } });
      if (existing?.currentVersionId) await tx.formVersion.update({ where: { id: existing.currentVersionId }, data: { status: "SUPERSEDED" } });
      const v = await tx.formVersion.create({
        data: { definitionId: def.id, versionNumber: (last._max.versionNumber ?? 0) + 1, schemaJson: fields, instructions: p.instructions, changeSummary: existing ? "Fields or instructions updated." : p.changeSummary, contentHash: hash },
      });
      await tx.formDefinition.update({ where: { id: def.id }, data: { currentVersionId: v.id } });
      published += 1;
    });
  }
  return published;
}
