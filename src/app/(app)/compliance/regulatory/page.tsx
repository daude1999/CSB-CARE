import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/current";

/** Regulatory Monitoring opens on its first tab, Regulatory Updates, which keeps its address (/changes). */
export default async function RegulatoryMonitoring() {
  await requireCtx();
  redirect("/changes");
}
