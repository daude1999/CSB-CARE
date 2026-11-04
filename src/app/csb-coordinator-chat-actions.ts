"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import { db } from "@/lib/db";
import { getIntake } from "@/server/care/coordinator/intake";
import { getAiProvider } from "@/server/ai";
import { audit } from "@/server/audit-log";

/**
 * Real chat with the existing AI provider, not a Claude Code command.
 * Read-only: no action tools, no writes to clinical records, no side effects
 * except a privacy-conscious usage audit. History lives only in the current UI.
 */
const requestSchema=z.object({
  question:z.string().trim().min(2).max(2000),
  intakeId:z.string().trim().max(80).nullable(),
  history:z.array(z.object({role:z.enum(["user","assistant"]),content:z.string().max(2000)})).max(8),
});
export type CoordinatorChatRequest=z.input<typeof requestSchema>;
export async function askCsbCoordinator(raw:CoordinatorChatRequest):Promise<{answer:string;caseUrl:string|null}> {
  const ctx=await requirePortal("rota");
  const organisationId=requireOrgPermission(ctx,"serviceUser.documents");
  const d=requestSchema.parse(raw);
  const settings=await db.rotaSettings.findUnique({where:{organisationId},select:{careCoordinatorAiEnabledAt:true}});
  if(!settings?.careCoordinatorAiEnabledAt) {
    return {answer:"AI chat has not been enabled for this organisation. An administrator must approve its data-protection setup. You can still use the document intake and manual review workflow.",caseUrl:d.intakeId?`/rota/coordinator/${encodeURIComponent(d.intakeId)}`:null};
  }
  const provider=getAiProvider();
  if(!provider?.coordinateChat || provider.isSimulated)
    return {answer:"The CRM's AI provider is not configured for conversation yet. Your intakes remain accessible, and no information has been changed.",caseUrl:d.intakeId?`/rota/coordinator/${encodeURIComponent(d.intakeId)}`:null};

  let caseContext="No specific intake selected. Only general workflow guidance is available.";
  let caseUrl:string|null=null;
  if(d.intakeId) {
    // getIntake checks tenant, branch and area restrictions and redacts sensitive
    // facts for users without the necessary permission.
    const view=await getIntake(ctx,d.intakeId);
    const intake=view.intake;
    caseUrl=`/rota/coordinator/${encodeURIComponent(intake.id)}`;
    const facts=view.facts.slice(0,65).map(f=>({
      section:f.section,label:f.label,
      value:f.hidden?"RESTRICTED":String(f.display).slice(0,350),
      decision:f.decision,verification:f.verification,conflict:f.hidden?null:f.conflict,
      page:f.sourcePage,
    }));
    caseContext=JSON.stringify({
      intake:{reference:intake.reference,title:intake.title,status:intake.status,mode:intake.mode},
      documents:view.documents.map(d=>({name:d.name,category:d.category,pages:d.pageCount,readStatus:d.readStatus})),
      sections:view.sections.map(s=>({section:s.key,status:s.status,applyStatus:s.applyStatus,accepted:s.accepted,open:s.open})),
      facts,
      outstanding:view.followUps?.slice(0,15).map(f=>({category:f.category,status:f.status,description:String(f.description).slice(0,300)}))||[],
    });
  }
  const answer=await provider.coordinateChat({question:d.question,history:d.history,caseContext});
  await audit({organisationId,actorId:ctx.userId,action:"coordinator.chat.asked",entityType:"Organisation",entityId:organisationId,
    data:{intakeId:d.intakeId,historyCount:d.history.length,answerLength:answer.length}});
  return {answer,caseUrl};
}
