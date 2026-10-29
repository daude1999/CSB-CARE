"use server";

import { handle, str } from "./action-kit";
import { saveBranch, setMemberBranches } from "@/server/admin/branches";

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
