"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createResetLink, deactivateMember, inviteMember, reactivateMember, redeemToken, revokeInvite, updateMember } from "@/server/admin/users";
import { handle, str } from "./action-kit";
import { saveBranch, setMemberBranches } from "@/server/admin/branches";
import { ONE_TIME_LINK_COOKIE } from "./admin-link";

async function showLinkOnce(token: string) {
  const h = await headers();
  const origin = process.env.APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  (await cookies()).set(ONE_TIME_LINK_COOKIE, `${origin}/account/${token}`, { httpOnly: true, sameSite: "strict", secure: origin.startsWith("https"), path: "/admin/users", maxAge: 120 });
}

const ids = (fd: FormData, k: string) => fd.getAll(k).filter((x): x is string => typeof x === "string" && x.length > 0);

export async function saveBranchAction(fd: FormData) {
  return handle(
    fd,
    (ctx) => saveBranch(ctx, { id: str(fd, "branchId") || undefined, name: str(fd, "name"), address: str(fd, "address") || undefined, cqcLocationId: str(fd, "cqcLocationId") || undefined, hrBranchKey: str(fd, "hrBranchKey") || undefined }),
    "Branch saved",
  );
}

export async function memberBranchesAction(fd: FormData) {
  return handle(fd, (ctx) => setMemberBranches(ctx, str(fd, "membershipId"), ids(fd, "branchIds")), "Branch access saved");
}

const memberInput = (fd: FormData) => ({
  roles: ids(fd, "roles"),
  branchIds: ids(fd, "branchIds"),
  jobTitle: str(fd, "jobTitle"),
});

export async function inviteMemberAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await inviteMember(ctx, { ...memberInput(fd), email: str(fd, "email"), name: str(fd, "name") });
    await showLinkOnce(r.token);
  }, "Invitation created. Copy the link below.");
}

export async function revokeInviteAction(fd: FormData) {
  return handle(fd, (ctx) => revokeInvite(ctx, str(fd, "inviteId")), "Invitation revoked");
}

export async function updateMemberAction(fd: FormData) {
  return handle(fd, (ctx) => updateMember(ctx, str(fd, "membershipId"), memberInput(fd)), "Member updated");
}

export async function deactivateMemberAction(fd: FormData) {
  return handle(fd, (ctx) => deactivateMember(ctx, str(fd, "membershipId"), str(fd, "reason")), "Member deactivated and signed out");
}

export async function reactivateMemberAction(fd: FormData) {
  return handle(fd, (ctx) => reactivateMember(ctx, str(fd, "membershipId")), "Member reactivated with their previous roles");
}

export async function createResetLinkAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await createResetLink(ctx, str(fd, "membershipId"));
    await showLinkOnce(r.token);
  }, "Password reset link created. Copy the link below.");
}

/** Used from the public account page, so it has no session: the token is the only authority. */
export async function redeemTokenAction(fd: FormData) {
  const token = str(fd, "token");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) redirect("/login?error=This%20link%20is%20not%20valid");
  if (str(fd, "password") !== str(fd, "confirm")) redirect(`/account/${token}?error=${encodeURIComponent("The two passwords do not match")}`);
  let done: { kind: string } | null = null;
  let error = "";
  try {
    done = await redeemToken(token, { password: fd.get("password")?.toString() ?? "", name: str(fd, "name") });
  } catch (e) {
    if (!(e instanceof AppError)) logger.error({ err: (e as Error).message }, "account link failed");
    error = e instanceof AppError ? e.message : "Something went wrong. Ask your administrator for a new link.";
  }
  if (!done) redirect(`/account/${token}?error=${encodeURIComponent(error)}`);
  redirect(`/login?ok=${encodeURIComponent(done.kind === "RESET" ? "Password changed. Sign in with your new password." : "Account ready. Sign in to continue.")}`);
}
