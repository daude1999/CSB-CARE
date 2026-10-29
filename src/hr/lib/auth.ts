import "server-only";
import { getCtx } from "@/server/auth/current";
import { canUsePortal } from "@/server/auth/portals";
import type { User } from "./domain";
import { HttpError } from "./http-error";

export { HttpError } from "./http-error";

/** Today's date in London. CSB_DEMO_TODAY pins it for repeatable tests, as in the standalone pilot. */
export function today() {
  return (
    process.env.CSB_DEMO_TODAY ||
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
      new Date(),
    )
  );
}

/** An HR Hub user, plus the platform organisation whose HR workspace they are working in (never sent to the browser). */
export type HrUser = User & { readonly workspace: string };

/**
 * The HR Hub account for the signed-in platform user. There is one sign-in for every portal: the platform
 * session decides who you are, and your membership's HR account decides what you can do in the HR Hub.
 */
export async function currentUser(): Promise<HrUser> {
  const { read } = await import("./store");
  const ctx = await getCtx();
  if (!ctx) throw new HttpError(401, "Sign in to continue");
  if (!ctx.organisationId || !ctx.hrUserId || !canUsePortal(ctx, "hr"))
    throw new HttpError(403, "You don't have access to HR & Workforce");
  const state = await read(ctx.organisationId);
  const user = state.users.find((u) => u.id === ctx.hrUserId && u.active);
  if (!user) throw new HttpError(403, "Your HR account is not active");
  return Object.defineProperty({ ...user }, "workspace", { value: ctx.organisationId, enumerable: false }) as HrUser;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected =
    process.env.CSB_APP_ORIGIN ||
    `${new URL(request.url).protocol}//${request.headers.get("x-forwarded-host") ?? request.headers.get("host")}`;
  if (origin !== expected)
    throw new HttpError(403, "Cross-origin request rejected");
}
