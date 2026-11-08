import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The former Service User Management workspace. Its actions and directory now live on All Service Users (owner's
 * decision, 7 Nov 2026), so old bookmarks and links land there with their search, filters and page kept.
 */
export default async function ServiceUserManagementRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const keep = new URLSearchParams();
  for (const k of ["q", "status", "area", "branch", "page"]) {
    const v = sp[k];
    if (typeof v === "string" && v) keep.set(k, v);
  }
  const qs = keep.toString();
  redirect(`/rota/service-users${qs ? `?${qs}` : ""}`);
}
