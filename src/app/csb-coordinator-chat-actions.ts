"use server";

import { z } from "zod";
import { requirePortal } from "@/server/auth/portals";
import { requireOrgPermission } from "@/server/auth/rbac";
import { getIntake } from "@/server/care/coordinator/intake";
import { coordinatorChatStatus, serviceUserChatContext } from "@/server/care/coordinator/chat";
import { getAiProvider } from "@/server/ai";
import { AiUnavailableError } from "@/server/ai/provider";
import { audit } from "@/server/audit-log";
import { logger } from "@/lib/logger";

/**
 * Real chat with the existing AI provider, not a Claude Code command.
 * Read-only: no action tools, no writes to clinical records, no side effects
 * except a privacy-conscious usage audit. History lives only in the current UI.
 *
 * The page the panel was opened on is sent as its path; any record id in it is re-checked on the server against the
 * employee's organisation, branches, areas and permissions before anything about it reaches the model.
 */
const requestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  intakeId: z.string().trim().max(80).nullable(),
  path: z.string().trim().max(300).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(8),
});
export type CoordinatorChatRequest = z.input<typeof requestSchema>;
export type CoordinatorChatResponse = { answer: string; caseUrl: string | null; status: "answered" | "not-enabled" | "no-provider" | "unavailable" };

const ID = /^[a-zA-Z0-9]{10,40}$/;

/** Which CRM page the panel was opened on. Only the shape of the path is used here; ids are checked later. */
function pageOf(path: string | undefined): { kind: "intake" | "service-user" | "rota" | "overview" | "other"; id: string | null } {
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
  const page = pageOf(d.path);
  const intakeId = d.intakeId && ID.test(d.intakeId) ? d.intakeId : page.kind === "intake" ? page.id : null;
  const intakeUrl = intakeId ? `/rota/coordinator/${encodeURIComponent(intakeId)}` : null;

  const status = await coordinatorChatStatus(organisationId);
  if (!status.online && status.reason === "not-enabled") {
    return { status: "not-enabled", caseUrl: intakeUrl, answer: "AI chat has not been switched on for this organisation yet. A manager turns it on in Rota Settings after the data-protection review. You can still use the suggested actions to open the Care Coordinator, care plans and rota screens. Nothing has been changed." };
  }
  const provider = getAiProvider();
  if (!status.online || !provider?.coordinateChat) {
    return { status: "no-provider", caseUrl: intakeUrl, answer: "The CRM's AI service is not configured for conversation yet, so I can't answer questions. Your records are unchanged, and the suggested actions still open the right screens." };
  }

  let caseContext: unknown = { page: page.kind, note: "No specific record selected. Only general workflow guidance is available." };
  let caseUrl: string | null = null;
  if (intakeId) {
    // getIntake checks tenant, branch and area restrictions and redacts sensitive
    // facts for users without the necessary permission.
    const view = await getIntake(ctx, intakeId);
    const intake = view.intake;
    caseUrl = `/rota/coordinator/${encodeURIComponent(intake.id)}`;
    const facts = view.facts.slice(0, 65).map((f) => ({
      section: f.section, label: f.label,
      value: f.hidden ? "RESTRICTED" : String(f.display).slice(0, 350),
      decision: f.decision, verification: f.verification, conflict: f.hidden ? null : f.conflict,
      page: f.sourcePage,
    }));
    caseContext = {
      page: "care-intake",
      intake: { reference: intake.reference, title: intake.title, status: intake.status, mode: intake.mode },
      documents: view.documents.map((doc) => ({ name: doc.name, category: doc.category, pages: doc.pageCount, readStatus: doc.readStatus })),
      sections: view.sections.map((s) => ({ section: s.key, status: s.status, applyStatus: s.applyStatus, accepted: s.accepted, open: s.open })),
      facts,
      outstanding: view.followUps?.slice(0, 15).map((f) => ({ category: f.category, status: f.status, description: String(f.description).slice(0, 300) })) || [],
    };
  } else if (page.kind === "service-user" && page.id) {
    const su = await serviceUserChatContext(ctx, page.id);
    if (su) {
      caseContext = { page: "service-user", ...su };
      caseUrl = `/rota/service-users/${encodeURIComponent(page.id)}`;
    } else {
      caseContext = { page: "service-user", note: "The person on this page is not available to this employee. Do not discuss them." };
    }
  }

  let answer: string;
  try {
    answer = await provider.coordinateChat({ question: d.question, history: d.history, caseContext: JSON.stringify(caseContext) });
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) logger.error({ err: (e as Error).message }, "AI CSB Coordinator chat failed");
    return { status: "unavailable", caseUrl, answer: "AI CSB Coordinator is temporarily unavailable. Please try again in a moment. Your records are unchanged." };
  }
  await audit({ organisationId, actorId: ctx.userId, action: "coordinator.chat.asked", entityType: "Organisation", entityId: organisationId,
    data: { intakeId, page: page.kind, historyCount: d.history.length, answerLength: answer.length } });
  return { status: "answered", answer, caseUrl };
}
