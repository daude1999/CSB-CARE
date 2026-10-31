import { redirect } from "next/navigation";
import { isIsoDate } from "@/lib/london";

/** "Today at a Glance" is now part of the Rota Dashboard; old links and bookmarks land there on the same day. */
export default async function TodayRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(sp.date && isIsoDate(sp.date) ? `/rota?date=${sp.date}` : "/rota");
}
