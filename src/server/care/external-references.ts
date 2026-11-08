import "server-only";
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { REFERENCE_TYPES, isPersonSpecific, normaliseReference, referenceSearchValues, storedSpellings, type ReferenceType } from "@/lib/reference-numbers";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";

export { REFERENCE_TYPES };

/** The reference encryption key is not configured, so the register can be neither read nor searched. */
export class ReferenceKeyMissingError extends Error{
  constructor(){super("CSB_REFERENCE_SECRET must be configured");this.name="ReferenceKeyMissingError";}
}

/** True when references can be stored and checked (always in development; in production only with CSB_REFERENCE_SECRET). */
export function referenceKeyConfigured(){return !!process.env.CSB_REFERENCE_SECRET || process.env.NODE_ENV!=="production";}

/** This secret must be configured separately from database and keysafe secrets in production. */
function secret(){
  const v=process.env.CSB_REFERENCE_SECRET;
  if(!v && process.env.NODE_ENV==="production") throw new ReferenceKeyMissingError();
  return createHash("sha256").update(v || "LOCAL-ONLY-NOT-FOR-PRODUCTION-REFERENCE-KEY").digest();
}
function fingerprint(v:string){return createHmac("sha256",secret()).update(v).digest("hex");}
function encrypt(v:string){
  const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",secret(),iv);
  const body=Buffer.concat([c.update(v,"utf8"),c.final()]);
  return [iv,c.getAuthTag(),body].map(v=>v.toString("base64url")).join(".");
}
function decrypt(v:string){
  const chunks=v.split(".");
  if(chunks.length!==3) throw new Error("Invalid encrypted external reference");
  const [iv,tag,body]=chunks.map(x=>Buffer.from(x,"base64url"));
  const d=createDecipheriv("aes-256-gcm",secret(),iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!),d.final()]).toString("utf8");
}
/** Every fingerprint a value may be stored under (NHS numbers saved before normalising kept their spaces). */
const hashesOf=(type:string,value:string)=>storedSpellings(type,value).map(fingerprint);

const refSchema=z.object({
  type:z.enum(REFERENCE_TYPES),
  issuer:z.string().trim().min(2,"Give the issuing organisation").max(180),
  value:z.string().trim().min(1,"Enter the reference number").max(120),
  systemLabel:z.string().trim().max(80).optional().transform(v=>v||undefined),
  sourceDocumentId:z.string().max(100).optional().transform(v=>v||undefined),
  sourcePage:z.number().int().positive().max(2000).optional(),
  sourceQuote:z.string().trim().max(500).optional().transform(v=>v||undefined),
  verificationNote:z.string().trim().max(500).optional().transform(v=>v||undefined),
}).strict();
export type ExternalRefInput=z.input<typeof refSchema>;
const issuerKey=(s:string)=>s.trim().toLocaleLowerCase("en-GB").replace(/\s+/g," ");

type Tx=Prisma.TransactionClient;
type LinkInput={type:ReferenceType;issuer:string;value:string;systemLabel?:string|null;sourceDocumentId?:string|null;sourcePage?:number|null;sourceQuote?:string|null;verificationNote?:string|null};

/** A source document must be this person's: one of their documents, or a Care Coordinator intake document for them. */
async function checkSourceDocument(tx:Tx,ctx:Ctx,organisationId:string,serviceUserId:string,documentId:string){
  const doc=await tx.serviceUserDocument.findFirst({where:{id:documentId,organisationId,serviceUserId},select:{sensitive:true}});
  if(doc){
    if(doc.sensitive && !hasOrgPermission(ctx,"serviceUser.sensitive")) throw new ForbiddenError("That document is restricted to managers");
    return;
  }
  const intakeDoc=await tx.careIntakeDocument.findFirst({where:{id:documentId,organisationId,intake:{serviceUserId}},select:{id:true}});
  if(!intakeDoc) throw new ValidationError("Choose one of this person's documents as the source");
}

/** Save a source-linked identifier; verified status must be set in a separate manager action. */
export async function addExternalReference(ctx:Ctx,serviceUserId:string,raw:ExternalRefInput){
  const scope=await rotaScope(ctx,"serviceUser.edit");
  const p=refSchema.safeParse(raw);
  if(!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the reference");
  const d=p.data;
  if(d.type==="NHS" && !hasOrgPermission(ctx,"serviceUser.sensitive"))
    throw new ValidationError("NHS references require restricted permission");
  if(d.type==="NHS" && !/^\d{3} ?\d{3} ?\d{4}$/.test(d.value))
    throw new ValidationError("NHS number must have ten digits");
  return db.$transaction(async tx=>{
    const su=await tx.serviceUser.findFirst({where:{...serviceUserWhere(scope),id:serviceUserId},select:{id:true}});
    if(!su) throw new NotFoundError("Service user");
    if(d.sourceDocumentId) await checkSourceDocument(tx,ctx,scope.organisationId,su.id,d.sourceDocumentId);
    const r=await linkExternalReferenceInTx(tx,ctx,scope.organisationId,su.id,d);
    if(r.status==="conflict") throw new ConflictError("This reference is already on another person's profile. Investigate before linking it here.");
    const warnings=r.status==="created" ? await otherUses(tx,scope.organisationId,su.id,d) : [];
    return {id:r.id,created:r.status==="created",reinstated:r.status==="reinstated",warnings};
  });
}

/** Warnings that do not stop a save: a shared framework ID, or the same number recorded elsewhere as another type. */
async function otherUses(tx:Tx,organisationId:string,serviceUserId:string,d:LinkInput){
  const rows=await tx.serviceUserExternalReference.findMany({where:{
    organisationId,status:"ACTIVE",valueHash:{in:hashesOf(d.type,d.value)},serviceUserId:{not:serviceUserId}},select:{serviceUserId:true,type:true,issuerKey:true},take:50});
  const people=new Set(rows.map(r=>r.serviceUserId)).size;
  if(!people) return [];
  if(d.type==="COUNCIL_FRAMEWORK") return [`This framework ID is also recorded for ${people} other ${people===1?"person":"people"}. It is shared and never identifies one person.`];
  return [`The same number is recorded on ${people===1?"another person's profile":`${people} other profiles`} as a different type or issuer. Check the source before verifying.`];
}

/**
 * Links one already-validated reference inside the caller's transaction. The caller has checked the service user
 * belongs to the organisation and that the actor may save NHS references. A person-specific reference that already
 * belongs to another profile is reported as a conflict and never linked. The same reference on the same profile is
 * never created twice: an active copy is reported as existing, a superseded copy is put back into use (audited).
 */
export async function linkExternalReferenceInTx(tx:Tx,ctx:Ctx,organisationId:string,serviceUserId:string,d:LinkInput,
):Promise<{status:"created"|"existing"|"reinstated";id:string}|{status:"conflict";id:null}>{
  const value=normaliseReference(d.type,d.value);
  const hashes=hashesOf(d.type,value);
  const key=issuerKey(d.issuer);
  if(isPersonSpecific(d.type)){
    const conflicts=await tx.serviceUserExternalReference.findMany({where:{
      organisationId,type:d.type,issuerKey:key,valueHash:{in:hashes},status:"ACTIVE",serviceUserId:{not:serviceUserId}},select:{serviceUserId:true},take:2});
    if(conflicts.length) return {status:"conflict",id:null};
  }
  const existing=await tx.serviceUserExternalReference.findFirst({where:{
    organisationId,serviceUserId,type:d.type,issuerKey:key,valueHash:{in:hashes}
  },select:{id:true,status:true}});
  if(existing && existing.status==="ACTIVE") return {status:"existing",id:existing.id};
  if(existing){
    await tx.serviceUserExternalReference.update({where:{id:existing.id},data:{status:"ACTIVE",supersededAt:null,supersededByUserId:null,replacedById:null,
      verified:false,verifiedAt:null,verifiedById:null,verificationNote:d.verificationNote || "Put back into use; needs verifying again"}});
    await audit({organisationId,actorId:ctx.userId,action:"serviceUser.externalReference.reinstated",entityType:"ServiceUser",entityId:serviceUserId,
      data:{externalReferenceId:existing.id,type:d.type,issuer:d.issuer}},tx);
    return {status:"reinstated",id:existing.id};
  }
  const row=await tx.serviceUserExternalReference.create({data:{
    organisationId,serviceUserId,type:d.type,issuer:d.issuer.trim(),issuerKey:key,
    valueCipher:encrypt(value),valueHash:fingerprint(value),
    systemLabel:d.systemLabel?.trim() || null,
    sourceQuoteCipher:d.sourceQuote?.trim() ? encrypt(d.sourceQuote.trim().slice(0,500)) : null,
    sourceDocumentId:d.sourceDocumentId || null,sourcePage:d.sourcePage || null,
    verificationNote:d.verificationNote || null,createdById:ctx.userId,
  }});
  await audit({organisationId,actorId:ctx.userId,
    action:"serviceUser.externalReference.added",entityType:"ServiceUser",entityId:serviceUserId,
    data:{externalReferenceId:row.id,type:d.type,issuer:d.issuer,systemLabel:row.systemLabel,sourceDocumentId:d.sourceDocumentId||null,sourcePage:d.sourcePage||null}},tx);
  return {status:"created",id:row.id};
}

/** What the register already says about a proposed reference, for the Care Coordinator's checks. Never decrypts. */
export async function registerCheckInTx(tx:Tx,organisationId:string,serviceUserId:string|null,d:{type:string;issuer:string;value:string}){
  // Without the reference key the register cannot be searched: say so on the fact instead of stopping the reading.
  if(!referenceKeyConfigured()) return {onThisProfile:false,sameOnOtherProfiles:0,otherTypeElsewhere:false,unchecked:true};
  const hashes=hashesOf(d.type,d.value);
  const rows=await tx.serviceUserExternalReference.findMany({where:{organisationId,status:"ACTIVE",valueHash:{in:hashes}},select:{serviceUserId:true,type:true,issuerKey:true},take:50});
  const key=issuerKey(d.issuer);
  const same=(r:{type:string;issuerKey:string})=>r.type===d.type && r.issuerKey===key;
  return {
    onThisProfile:!!serviceUserId && rows.some(r=>r.serviceUserId===serviceUserId && same(r)),
    sameOnOtherProfiles:new Set(rows.filter(r=>r.serviceUserId!==serviceUserId && same(r)).map(r=>r.serviceUserId)).size,
    otherTypeElsewhere:rows.some(r=>r.serviceUserId!==serviceUserId && !same(r)),
    unchecked:false,
  };
}

/** Verification belongs to an authorised care manager; no automatic verified status from AI confidence. */
export async function verifyExternalReference(ctx:Ctx,id:string,verified:boolean,reason:string){
  const scope=await rotaScope(ctx,"serviceUser.edit");
  if(!hasOrgPermission(ctx,"serviceUser.sensitive")) throw new ValidationError("Manager permission required to verify external identifiers");
  if(reason.trim().length<3) throw new ValidationError("Give a verification reason");
  return db.$transaction(async tx=>{
    const ref=await tx.serviceUserExternalReference.findFirst({where:{
      organisationId:scope.organisationId,id,serviceUser:serviceUserWhere(scope)
    }});
    if(!ref) throw new NotFoundError("Reference");
    if(ref.status!=="ACTIVE") throw new ConflictError("This reference has been superseded. Verify the reference that replaced it.");
    await tx.serviceUserExternalReference.update({where:{id},data:{
      verified,verificationNote:reason.trim().slice(0,500),verifiedById:ctx.userId,verifiedAt:new Date()
    }});
    await audit({organisationId:scope.organisationId,actorId:ctx.userId,
      action:"serviceUser.externalReference.verified",entityType:"ServiceUser",entityId:ref.serviceUserId,
      data:{externalReferenceId:id,type:ref.type,systemLabel:ref.systemLabel,verified,decision:verified?"VERIFIED":"REJECTED",reason:reason.trim().slice(0,500)}},tx);
  });
}

const supersedeSchema=z.object({
  value:z.string().trim().max(120).optional().transform(v=>v||undefined),
  reason:z.string().trim().min(3,"Say why the reference is being corrected or withdrawn").max(500),
});

/**
 * Controlled correction: the original row is never overwritten. It is marked SUPERSEDED (kept with its history) and,
 * when a corrected number is given, a new unverified row takes its place with the same type, issuer, label and source.
 */
export async function supersedeExternalReference(ctx:Ctx,id:string,raw:z.input<typeof supersedeSchema>){
  const scope=await rotaScope(ctx,"serviceUser.edit");
  const p=supersedeSchema.safeParse(raw);
  if(!p.success) throw new ValidationError(p.error.issues[0]?.message ?? "Check the correction");
  const d=p.data;
  return db.$transaction(async tx=>{
    const ref=await tx.serviceUserExternalReference.findFirst({where:{organisationId:scope.organisationId,id,serviceUser:serviceUserWhere(scope)}});
    if(!ref) throw new NotFoundError("Reference");
    if(ref.type==="NHS" && !hasOrgPermission(ctx,"serviceUser.sensitive")) throw new ForbiddenError("NHS references require restricted permission");
    if(ref.status!=="ACTIVE") throw new ConflictError("This reference has already been superseded");
    let replacedById:string|null=null;
    if(d.value){
      if(ref.type==="NHS" && !/^\d{3} ?\d{3} ?\d{4}$/.test(d.value)) throw new ValidationError("NHS number must have ten digits");
      if(hashesOf(ref.type,d.value).includes(ref.valueHash)) throw new ValidationError("That is the number already recorded");
      // Mark the original first so it does not count against its own correction.
      await tx.serviceUserExternalReference.update({where:{id},data:{status:"SUPERSEDED"}});
      const r=await linkExternalReferenceInTx(tx,ctx,scope.organisationId,ref.serviceUserId,{
        type:ref.type as ReferenceType,issuer:ref.issuer,value:d.value,systemLabel:ref.systemLabel,
        sourceDocumentId:ref.sourceDocumentId,sourcePage:ref.sourcePage,verificationNote:`Correction of an earlier entry: ${d.reason}`.slice(0,500)});
      if(r.status==="conflict") throw new ConflictError("The corrected number is already on another person's profile. Investigate before linking it here.");
      replacedById=r.id;
    }
    await tx.serviceUserExternalReference.update({where:{id},data:{status:"SUPERSEDED",supersededAt:new Date(),supersededByUserId:ctx.userId,replacedById,supersedeReason:d.reason}});
    await audit({organisationId:scope.organisationId,actorId:ctx.userId,action:"serviceUser.externalReference.superseded",entityType:"ServiceUser",entityId:ref.serviceUserId,
      data:{externalReferenceId:id,type:ref.type,replacedById,reason:d.reason}},tx);
    return {replacedById};
  });
}

export async function referencesFor(ctx:Ctx,serviceUserId:string){
  const scope=await rotaScope(ctx,"serviceUser.view");
  const su=await db.serviceUser.findFirst({where:{...serviceUserWhere(scope),id:serviceUserId},select:{id:true,csbReference:true,reference:true}});
  if(!su) throw new NotFoundError("Service user");
  const sensitive=hasOrgPermission(ctx,"serviceUser.sensitive");
  const rows=await db.serviceUserExternalReference.findMany({where:{
    organisationId:scope.organisationId,serviceUserId:su.id
  },orderBy:{createdAt:"asc"}});
  return {csbReference:su.csbReference,legacyReference:su.reference,rows:rows.map(r=>{
    const hidden=r.type==="NHS" && !sensitive;
    return {
      id:r.id,type:r.type as ReferenceType,issuer:r.issuer,systemLabel:r.systemLabel,verified:r.verified,status:r.status as "ACTIVE"|"SUPERSEDED",
      sourcePage:r.sourcePage,sourceDocumentId:r.sourceDocumentId,verifiedAt:r.verifiedAt,verifiedById:r.verifiedById,
      verificationNote:hidden?null:r.verificationNote,createdAt:r.createdAt,createdById:r.createdById,
      supersededAt:r.supersededAt,supersededByUserId:r.supersededByUserId,replacedById:r.replacedById,supersedeReason:hidden?null:r.supersedeReason,
      value:hidden ? null : decrypt(r.valueCipher),
      sourceQuote:hidden || !r.sourceQuoteCipher ? null : decrypt(r.sourceQuoteCipher),
    };
  })};
}

/** Exact lookup. Framework IDs can link many people and must not identify a person by themselves. */
export async function matchExternalReference(ctx:Ctx,type:ReferenceType,value:string,issuer?:string){
  const scope=await rotaScope(ctx,"serviceUser.view");
  if(type==="NHS" && !hasOrgPermission(ctx,"serviceUser.sensitive")) throw new ValidationError("Restricted NHS lookup");
  const v=value.trim();
  if(!v) return {candidates:[],ambiguous:false,frameworkOnly:type==="COUNCIL_FRAMEWORK"};
  const rows=await db.serviceUserExternalReference.findMany({where:{
    organisationId:scope.organisationId,type,status:"ACTIVE",valueHash:{in:hashesOf(type,v)},
    ...(issuer?{issuerKey:issuerKey(issuer)}:{}),serviceUser:serviceUserWhere(scope)
  },select:{serviceUserId:true,verified:true},take:21});
  const ids=[...new Set(rows.map(r=>r.serviceUserId))];
  return {candidates:ids,ambiguous:ids.length!==1||rows.length>1||rows.some(r=>!r.verified),
    frameworkOnly:type==="COUNCIL_FRAMEWORK"};
}

export interface ReferenceHit { serviceUserId:string; type:ReferenceType; issuer:string; systemLabel:string|null }

/**
 * Exact search of the encrypted register by fingerprint, scoped to the caller's organisation, branches and areas.
 * Accepts labelled entries ("Frameworki 1088676"). NHS rows are only searched for staff with restricted access, and
 * superseded rows are never matched. Framework hits are returned with their type so the screen can say they are shared.
 */
export async function searchReferenceHits(ctx:Ctx,query:string):Promise<ReferenceHit[]>{
  const scope=await rotaScope(ctx,"serviceUser.view");
  const values=referenceSearchValues(query);
  if(!values.length) return [];
  const rows=await db.serviceUserExternalReference.findMany({where:{
    organisationId:scope.organisationId,status:"ACTIVE",valueHash:{in:values.map(fingerprint)},
    ...(hasOrgPermission(ctx,"serviceUser.sensitive")?{}:{type:{not:"NHS"}}),
    serviceUser:serviceUserWhere(scope),
  },select:{serviceUserId:true,type:true,issuer:true,systemLabel:true},take:101});
  return rows.map(r=>({serviceUserId:r.serviceUserId,type:r.type as ReferenceType,issuer:r.issuer,systemLabel:r.systemLabel}));
}
export async function searchReferenceIds(ctx:Ctx,query:string){
  return [...new Set((await searchReferenceHits(ctx,query)).map(h=>h.serviceUserId))];
}

export interface ListedReference { value:string; title:string; verified:boolean; others:number }

/**
 * The council reference shown in the All Service Users table, for people the caller has ALREADY loaded through their
 * own scope (the ids come from a scoped query). Only active, person-specific council numbers are listed: a framework
 * or contract ID can be shared by many people, so it never stands for a person here. NHS numbers are never listed.
 * Client numbers come first, then package references; verified before unverified. A missing key is reported, not thrown.
 */
export async function councilReferencesFor(organisationId:string,serviceUserIds:string[]):Promise<{byPerson:Map<string,ListedReference>;problem:"KEY_MISSING"|"FAILED"|null}>{
  const byPerson=new Map<string,ListedReference>();
  if(!serviceUserIds.length) return {byPerson,problem:null};
  const rank=(t:string)=>t==="COUNCIL_CLIENT"?0:t==="COUNCIL_PACKAGE"?1:2;
  try{
    const rows=await db.serviceUserExternalReference.findMany({where:{organisationId,serviceUserId:{in:serviceUserIds},status:"ACTIVE",type:{in:["COUNCIL_CLIENT","COUNCIL_PACKAGE","OTHER_EXTERNAL"]}},select:{serviceUserId:true,type:true,issuer:true,systemLabel:true,verified:true,valueCipher:true,createdAt:true}});
    const groups=new Map<string,typeof rows>();
    for(const r of rows){const g=groups.get(r.serviceUserId)??[];g.push(r);groups.set(r.serviceUserId,g);}
    for(const [id,g] of groups){
      g.sort((a,b)=>rank(a.type)-rank(b.type)||Number(b.verified)-Number(a.verified)||a.createdAt.getTime()-b.createdAt.getTime());
      const top=g[0]!;
      byPerson.set(id,{value:decrypt(top.valueCipher),title:referenceTitleOf(top),verified:top.verified,others:g.length-1});
    }
    return {byPerson,problem:null};
  }catch(e){
    if(e instanceof ReferenceKeyMissingError) return {byPerson:new Map(),problem:"KEY_MISSING"};
    logger.error({event:"serviceUser.referenceList.failed",errorName:e instanceof Error?e.name:typeof e,organisationId},"Council references for the directory could not be read");
    return {byPerson:new Map(),problem:"FAILED"};
  }
}
function referenceTitleOf(r:{type:string;issuer:string;systemLabel:string|null}){
  const short=r.issuer.replace(/\s+(london borough )?(borough )?council$/i,"").replace(/^london borough of\s+/i,"").trim()||r.issuer;
  return r.systemLabel?`${short} ${r.systemLabel}`:r.type==="COUNCIL_PACKAGE"?`${short} package`:short;
}
