"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AppError, ConflictError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireCtx } from "@/server/auth/current";
import { saveVisitStaffing, StaffingPlaceError, type StaffingInput } from "@/server/rota/staffing";

/**
 * The Visit Details panel's Save Changes. Unlike the form actions it returns the outcome instead of redirecting, so the
 * panel keeps the coordinator's unsaved choices when a change is refused, and only says "saved" after the commit.
 */
export type SaveStaffingState =
  | { ok: true; message: string }
  | { ok: false; error: string; place?: string; stale?: boolean };

export async function saveVisitStaffingAction(input: StaffingInput): Promise<SaveStaffingState> {
  try {
    const ctx = await requireCtx();
    const r = await saveVisitStaffing(ctx, input);
    revalidatePath("/", "layout");
    return { ok: true, message: r.summary };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof StaffingPlaceError) return { ok: false, error: e.message, place: e.place };
    if (e instanceof ConflictError) return { ok: false, error: e.message, stale: e.message.startsWith("Someone else changed") };
    if (e instanceof AppError) return { ok: false, error: e.message };
    logger.error({ err: (e as Error).message, stack: (e as Error).stack }, "save visit staffing failed");
    return { ok: false, error: "The changes could not be saved. Nothing was changed. Try again, and if it keeps happening tell your manager." };
  }
}
