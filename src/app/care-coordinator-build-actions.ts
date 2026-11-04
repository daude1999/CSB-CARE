"use server";
import { requirePortal } from "@/server/auth/portals";
import { activateAndBuildApprovedWeek } from "@/server/care/coordinator-import";
export type BuildState = {phase:"idle"|"complete"|"error";message:string;created?:number;existing?:number;errors?:string[];serviceUserId?:string};
export async function coordinatorBuildAction(_prev:BuildState,fd:FormData):Promise<BuildState>{
  const ctx=await requirePortal("rota");
  try {
    if(fd.get("confirm")!=="on") throw new Error("Approval is required");
    const id=String(fd.get("serviceUserId")||"");
    const week=String(fd.get("weekStart")||"");
    const result=await activateAndBuildApprovedWeek(ctx,id,week);
    return {phase:"complete",message:"Unpublished visits created; review staff assignment and publication separately.",created:result.created,existing:result.alreadyPresent,errors:result.errors,serviceUserId:id};
  } catch(error) {
    return {phase:"error",message:error instanceof Error?error.message:"Unable to prepare rota"};
  }
}
