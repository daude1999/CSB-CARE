import { redirect } from "next/navigation";
import Hub from "@/hr/components/hub";
import { requirePortal } from "@/server/auth/portals";

export const dynamic = "force-dynamic";

export default async function HrPortal({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePortal("hr");
  // "/hr" is the HR Hub's home; it has one address so the side menu can mark it.
  if (!(await params).path?.length) {
    const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : (v ?? []).map((x) => [k, x]))));
    redirect(`/hr/dashboard${query.size ? `?${query}` : ""}`);
  }
  return <Hub />;
}
