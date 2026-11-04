import "server-only";
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { rotaScope, serviceUserWhere } from "@/server/rota/scope";

/** This secret must be configured separately from database and keysafe secrets in production. */
function secret(){
  const v=process.env.CSB_REFERENCE_SECRET;
  if(!v && process.env.NODE_ENV==="production") throw new Error("CSB_REFERENCE_SECRET must be configured");
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
export const REFERENCE_TYPES=["COUNCIL_CLIENT","COUNCIL_FRAMEWORK","COUNCIL_PACKAGE","OTHER_EXTERNAL","NHS"] as const;
const refSchema=z.object({
  type:z.enum(REFERENCE_TYPES),
  issuer:z.string().trim().min(2).max(180),
  value:z.string().trim().min(1).max(120),
  sourceDocumentId:z.string().max(100).optional(),
  sourcePage:z.number().int().positive().optional(),
  verificationNote:z.string().max(500).optional(),
}).strict();
export type ExternalRefInput=z.input<typeof refSchema>;
const isPersonSpecific=(t:string)=>t!=="COUNCIL_FRAMEWORK";
const issuerKey=(s:string)=>s.trim().toLocaleLowerCase("en-GB").replace(/\s+/g," ");
const normalized=(v:string)=>v.trim(); // never parse as number; preserve zeros and punctuation

/** Save a source-linked identifier; verified status must be set in a separate manager action. */
export async function addExternalReference(ctx:Ctx,serviceUserId:string,raw:ExternalRefInput){
  const scope=await rotaScope(ctx,"serviceUser.edit");
  const d=refSchema.parse(raw);
  if(d.type==="NHS" && !hasOrgPermission(ctx,"serviceUser.sensitive"))
    throw new ValidationError("NHS references require restricted permission");
  if(d.type==="NHS" && !/^\d{3} ?\d{3} ?\d{4}$/.test(d.value))
    throw new ValidationError("NHS number must have ten digits");
  const hash=fingerprint(normalized(d.value));
  return db.$transaction(async tx=>{
    const su=await tx.serviceUser.findFirst({where:{...serviceUserWhere(scope),id:serviceUserId},select:{id:true}});
    if(!su) throw new NotFoundError("Service user");
    const key=issuerKey(d.issuer);
    if(isPersonSpecific(d.type)){
      const conflicts=await tx.serviceUserExternalReference.findMany({where:{
        organisationId:scope.organisationId,type:d.type,issuerKey:key,valueHash:hash,
        serviceUserId:{not:su.id}},select:{serviceUserId:true},take:2});
      if(conflicts.length) throw new ConflictError("This external reference belongs to another profile. Investigate before linking.");
    }
    const existing=await tx.serviceUserExternalReference.findFirst({where:{
      organisationId:scope.organisationId,serviceUserId:su.id,type:d.type,issuerKey:key,valueHash:hash
    },select:{id:true}});
    if(existing) return {id:existing.id,created:false};
    const row=await tx.serviceUserExternalReference.create({data:{
      organisationId:scope.organisationId,serviceUserId:su.id,type:d.type,issuer:d.issuer,issuerKey:key,
      valueCipher:encrypt(normalized(d.value)),valueHash:hash,
      sourceDocumentId:d.sourceDocumentId || null,sourcePage:d.sourcePage || null,
      verificationNote:d.verificationNote || null,createdById:ctx.userId,
    }});
    await audit({organisationId:scope.organisationId,actorId:ctx.userId,
      action:"serviceUser.externalReference.added",entityType:"ServiceUser",entityId:su.id,
      data:{externalReferenceId:row.id,type:d.type,issuer:d.issuer,sourceDocumentId:d.sourceDocumentId||null,sourcePage:d.sourcePage||null}},tx);
    return {id:row.id,created:true};
  });
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
    await tx.serviceUserExternalReference.update({where:{id},data:{
      verified,verificationNote:reason.trim(),verifiedById:ctx.userId,verifiedAt:new Date()
    }});
    await audit({organisationId:scope.organisationId,actorId:ctx.userId,
      action:"serviceUser.externalReference.verified",entityType:"ServiceUser",entityId:ref.serviceUserId,
      data:{externalReferenceId:id,type:ref.type,verified}},tx);
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
  return {csbReference:su.csbReference,legacyReference:su.reference,rows:rows.map(r=>({
    id:r.id,type:r.type,issuer:r.issuer,verified:r.verified,sourcePage:r.sourcePage,
    sourceDocumentId:r.sourceDocumentId,verifiedAt:r.verifiedAt,
    value:r.type==="NHS" && !sensitive ? null : decrypt(r.valueCipher),
  }))};
}

/** Exact lookup. Framework IDs can link many people and must not identify a person by themselves. */
export async function matchExternalReference(ctx:Ctx,type:typeof REFERENCE_TYPES[number],value:string,issuer?:string){
  const scope=await rotaScope(ctx,"serviceUser.view");
  if(type==="NHS" && !hasOrgPermission(ctx,"serviceUser.sensitive")) throw new ValidationError("Restricted NHS lookup");
  const v=normalized(value);
  if(!v) return {candidates:[],ambiguous:false,frameworkOnly:type==="COUNCIL_FRAMEWORK"};
  const rows=await db.serviceUserExternalReference.findMany({where:{
    organisationId:scope.organisationId,type,valueHash:fingerprint(v),
    ...(issuer?{issuerKey:issuerKey(issuer)}:{}),serviceUser:serviceUserWhere(scope)
  },select:{serviceUserId:true,verified:true},take:21});
  const ids=[...new Set(rows.map(r=>r.serviceUserId))];
  return {candidates:ids,ambiguous:ids.length!==1||rows.length>1||rows.some(r=>!r.verified),
    frameworkOnly:type==="COUNCIL_FRAMEWORK"};
}
export async function searchReferenceIds(ctx:Ctx,query:string){
  const scope=await rotaScope(ctx,"serviceUser.view");
  if(!query.trim()) return [];
  const rows=await db.serviceUserExternalReference.findMany({where:{
    organisationId:scope.organisationId,valueHash:fingerprint(normalized(query)),
    ...(hasOrgPermission(ctx,"serviceUser.sensitive")?{}:{type:{not:"NHS"}}),
    serviceUser:serviceUserWhere(scope),
  },select:{serviceUserId:true},take:101});
  return [...new Set(rows.map(r=>r.serviceUserId))];
}
