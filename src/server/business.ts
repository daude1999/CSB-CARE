import "server-only";
import { db } from "@/lib/db";
import { BUSINESS_FIELDS, type BusinessDetails } from "@/lib/business";

const SERVICE_NAMES: Record<string, string> = {
  RESIDENTIAL: "Residential care home",
  NURSING: "Care home with nursing",
  DOMICILIARY: "Domiciliary (home) care",
  SUPPORTED_LIVING: "Supported living",
};

/** The organisation's business details from Settings, falling back to what is already recorded (name, branch address, services). */
export async function businessDetails(organisationId: string | null | undefined): Promise<BusinessDetails | null> {
  if (!organisationId) return null;
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    include: { branches: { orderBy: { createdAt: "asc" }, include: { services: true } } },
  });
  if (!org) return null;
  const saved = ((org.settings ?? {}) as { business?: Partial<BusinessDetails> }).business ?? {};
  const services = [...new Set(org.branches.flatMap((b) => b.services.map((s) => s.serviceTypeCode)))];
  const fallback: Partial<BusinessDetails> = {
    company_name: org.name.replace(/\s+\(DEMO\)$/i, ""),
    address: org.branches.find((b) => b.address)?.address ?? "",
    service_type: services.length > 1 ? "Mixed services" : services.length ? SERVICE_NAMES[services[0]!] ?? "" : "",
  };
  return Object.fromEntries(BUSINESS_FIELDS.map((f) => [f.tag, (saved[f.tag] ?? "").trim() || fallback[f.tag] || ""])) as BusinessDetails;
}
