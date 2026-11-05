"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import { answerFromCrm, type CrmLink, type CrmPage } from "@/server/care/coordinator/crm-assistant";
import { audit } from "@/server/audit-log";
import { NotFoundError } from "@/lib/errors";

/**
 * AI CSB Coordinator chat (owner's decision, 5 Nov 2026: built-in CRM search, no AI key, nothing online). Every answer
 * comes from the organisation's own records through answerFromCrm, with the employee's own permission, branch and area
 * checks. Read-only: nothing is written except a usage audit entry, which never stores the question text.
 *
 * The page the panel was opened on is sent as its path; any record id in it is re-checked on the server before use.
 */
const requestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  intakeId: z.string().trim().max(80).nullable(),
  path: z.string().trim().max(300).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(8),
});
export type CoordinatorChatRequest = z.input<typeof requestSchema>;
export type CoordinatorChatResponse = { answer: string; links: CrmLink[]; topic: string };

const ID = /^[a-zA-Z0-9]{10,40}$/;

/** Which CRM page the panel was opened on. Only the shape of the path is used here; ids are checked later. */
function pageOf(path: string | undefined, intakeId: string | null): CrmPage {
  if (intakeId && ID.test(intakeId)) return { kind: "intake", id: intakeId };
  if (!path) return { kind: "other", id: null };
  const intake = path.match(/^\/rota\/coordinator\/([^/?#]+)/);
  if (intake && ID.test(intake[1]!)) return { kind: "intake", id: intake[1]! };
  const su = path.match(/^\/rota\/(?:service-users|care-plans)\/([^/?#]+)/);
  if (su && ID.test(su[1]!)) return { kind: "service-user", id: su[1]! };
  if (path === "/rota" || path.startsWith("/rota/")) return { kind: "rota", id: null };
  if (path === "/overview") return { kind: "overview", id: null };
  return { kind: "other", id: null };
}

export async function askCsbCoordinator(raw: CoordinatorChatRequest): Promise<CoordinatorChatResponse> {
  const ctx = await requirePortal("rota");
  const organisationId = requireOrgPermission(ctx, "serviceUser.documents");
  const d = requestSchema.parse(raw);
  const page = pageOf(d.path, d.intakeId);
  let result: CoordinatorChatResponse;
  try {
    result = await answerFromCrm(ctx, d.question, page);
  } catch (e) {
    // A record on the page that this employee may not open is answered as not available, never described.
    if (e instanceof NotFoundError) result = { topic: "not-found", answer: "That record isn't available to you, so I can't answer about it.", links: [] };
    else throw e;
  }
  await audit({ organisationId, actorId: ctx.userId, action: "coordinator.chat.asked", entityType: "Organisation", entityId: organisationId,
    data: { page: page.kind, topic: result.topic, historyCount: d.history.length } });
  return result;
}
