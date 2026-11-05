"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import { answerFromCrm, type CrmLink, type CrmPage } from "@/server/care/coordinator/crm-assistant";
import { audit } from "@/server/audit-log";
import { db } from "@/lib/db";
import { getAiProvider } from "@/server/ai";
import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";

/**
 * Permission-scoped CRM assistant: the existing deterministic CRM answer is retrieved first,
 * then optionally explained by Claude if the organisation has explicitly enabled AI document
 * processing after its data-protection review.
 * Never directly writes to patient records or sends raw document bytes in chat.
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
/** Visits use UUIDs rather than cuids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which CRM page the panel was opened on. Only the shape of the path is used here; ids are checked later. */
function pageOf(path: string | undefined, intakeId: string | null): CrmPage {
  if (intakeId && ID.test(intakeId)) return { kind: "intake", id: intakeId };
  if (!path) return { kind: "other", id: null };
  const intake = path.match(/^\/rota\/coordinator\/([^/?#]+)/);
  if (intake && ID.test(intake[1]!)) return { kind: "intake", id: intake[1]! };
  const su = path.match(/^\/rota\/(?:service-users|care-plans)\/([^/?#]+)/);
  if (su && ID.test(su[1]!)) return { kind: "service-user", id: su[1]! };
  const visit = path.match(/^\/rota\/visits\/([^/?#]+)/);
  if (visit && (UUID.test(visit[1]!) || ID.test(visit[1]!))) return { kind: "visit", id: visit[1]! };
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
  // Provider secrets are server-side. Enabling the environment variable alone must
  // never send a care organisation's records off-platform without its opt-in.
  const settings = await db.rotaSettings.findUnique({
    where: { organisationId }, select: { careCoordinatorAiEnabledAt: true },
  });
  const provider = settings?.careCoordinatorAiEnabledAt ? getAiProvider() : null;
  let usedModel = false;
  if (provider?.coordinateChat && !provider.isSimulated && result.topic !== "not-found") {
    try {
      // The deterministic engine has already applied organisation/branch/area/role
      // permissions. Send only this scoped summary and its verified navigation links.
      const caseContext = JSON.stringify({
        page: page.kind,
        crmAnswer: result.answer.slice(0, 10000),
        links: result.links.slice(0, 12),
        note: "CRM summary only. Do not claim the person or document was fully reviewed.",
      });
      const answer = await provider.coordinateChat({
        question: d.question, history: d.history, caseContext,
      });
      if (answer.trim()) {
        result = { ...result, answer, topic: "ai-coordinator" };
        usedModel = true;
      }
    } catch (e) {
      // Retain a useful, correctly-scoped answer during API outages or rate limits.
      // Never log patient details or message content.
      logger.warn({ reason: (e as Error).name }, "AI coordinator provider failed; used CRM fallback");
    }
  }
  await audit({ organisationId, actorId: ctx.userId, action: "coordinator.chat.asked", entityType: "Organisation", entityId: organisationId,
    data: { page: page.kind, topic: result.topic, historyCount: d.history.length, aiUsed: usedModel } });
  return result;
}
