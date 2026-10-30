"use server";

import type { MarOutcome } from "@prisma/client";
import { addMedication, approveMedication, correctDose, recordDose, setMedicationEnabled, stopMedication, type MedInput } from "@/server/care/medication";
import { handle, str } from "./action-kit";

const list = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && !!x);
const OUTCOMES: MarOutcome[] = ["GIVEN", "PROMPTED", "REFUSED", "NOT_GIVEN", "NOT_REQUIRED"];
const outcome = (fd: FormData) => OUTCOMES.find((o) => o === str(fd, "outcome")) ?? "NOT_GIVEN";

function medInput(fd: FormData): MedInput {
  const route = str(fd, "route");
  const support = str(fd, "support");
  return {
    name: str(fd, "name"),
    strength: str(fd, "strength"),
    dose: str(fd, "dose"),
    route: route === "TOPICAL" || route === "INHALED" || route === "EYE" || route === "EAR" || route === "NASAL" || route === "TRANSDERMAL" || route === "OTHER" ? route : "ORAL",
    support: support === "ASSIST" || support === "ADMINISTER" ? support : "PROMPT",
    timeRanges: list(fd, "timeRanges").filter((t): t is "MORNING" | "LUNCH" | "TEA" | "BED" => t === "MORNING" || t === "LUNCH" || t === "TEA" || t === "BED"),
    asRequired: str(fd, "asRequired") === "1",
    maxDosesPerDay: str(fd, "maxDosesPerDay") ? Number(str(fd, "maxDosesPerDay")) : null,
    controlled: str(fd, "controlled") === "1",
    instructions: str(fd, "instructions"),
    startDate: str(fd, "startDate"),
    endDate: str(fd, "endDate") || undefined,
    prescriber: str(fd, "prescriber"),
  };
}

export async function addMedicationAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await addMedication(ctx, str(fd, "serviceUserId"), medInput(fd), { replacesId: str(fd, "replacesId") || undefined, reason: str(fd, "reason") });
  }, "Saved. Someone else must now check it against the prescription and approve it.");
}

export async function approveMedicationAction(fd: FormData) {
  return handle(fd, (ctx) => approveMedication(ctx, str(fd, "medicationId")), "Medicine approved and now shown on visits");
}

export async function stopMedicationAction(fd: FormData) {
  return handle(fd, (ctx) => stopMedication(ctx, str(fd, "medicationId"), str(fd, "reason")), "Medicine stopped");
}

export async function recordDoseAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await recordDose(ctx, str(fd, "visitId"), { medicationId: str(fd, "medicationId"), outcome: outcome(fd), reason: str(fd, "reason"), witnessName: str(fd, "witnessName") });
  }, "Medication recorded");
}

export async function correctDoseAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await correctDose(ctx, str(fd, "recordId"), { outcome: outcome(fd), reason: str(fd, "reason") });
  }, "Correction recorded; the original stays on file");
}

export async function medicationSwitchAction(fd: FormData) {
  return handle(fd, (ctx) => setMedicationEnabled(ctx, str(fd, "on") === "1", str(fd, "reviewNote")), str(fd, "on") === "1" ? "Medication records switched on" : "Medication records switched off");
}
