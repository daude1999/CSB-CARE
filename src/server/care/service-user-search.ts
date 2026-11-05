import "server-only";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { referenceTitle, storedSpellings } from "@/lib/reference-numbers";
import { mayBeExternalReference, nameTerms, postcodeSpellings, referenceSpellings } from "@/lib/service-user-search";
import type { Ctx } from "@/server/auth/rbac";
import { ReferenceKeyMissingError, searchReferenceHits, type ReferenceHit } from "./external-references";

/**
 * How the top bar search and the Service Users directory find a person. Both call these two functions, so a name,
 * postcode or reference typed in either box finds the same people. Branch, area and organisation limits are always
 * added by the caller through serviceUserWhere(scope).
 */

export const REFERENCE_KEY_MISSING =
  "Council, Frameworki and NHS numbers can't be searched at the moment because the reference encryption key (CSB_REFERENCE_SECRET) is not set on the server. Names, postcodes, CSB and SU numbers are still searched. Ask your system administrator to add the key.";
export const REFERENCE_REGISTER_FAILED =
  "Council, Frameworki and NHS numbers couldn't be searched because the reference register could not be read. Names, postcodes, CSB and SU numbers are still searched. The problem has been logged.";

export interface ReferenceLookup {
  hits: ReferenceHit[];
  /** Why external references were not searched, shown to the user. Null when the lookup ran (or was not needed). */
  problem: string | null;
}

/**
 * Exact lookup in the encrypted reference register, only for entries that could be a reference (they contain a digit).
 * A missing encryption key or an unreadable register is reported in `problem` and logged, so the name and postcode
 * search still answers; it is never turned into a silent "no results". Permission errors are not caught. The search
 * entry itself is never logged, because it may be an NHS number.
 */
export async function lookUpReferences(ctx: Ctx, q: string): Promise<ReferenceLookup> {
  if (!mayBeExternalReference(q)) return { hits: [], problem: null };
  try {
    return { hits: await searchReferenceHits(ctx, q), problem: null };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const keyMissing = e instanceof ReferenceKeyMissingError;
    const code = typeof e === "object" && e && "code" in e && typeof e.code === "string" ? e.code : undefined;
    logger.error(
      { event: "serviceUser.referenceSearch.failed", reason: keyMissing ? "CSB_REFERENCE_SECRET is not configured" : "reference register query failed", errorName: e instanceof Error ? e.name : typeof e, code, organisationId: ctx.organisationId },
      "Reference number search failed; name and postcode search continued",
    );
    return { hits: [], problem: keyMissing ? REFERENCE_KEY_MISSING : REFERENCE_REGISTER_FAILED };
  }
}

const like = (v: string) => ({ contains: v, mode: "insensitive" as const });

/**
 * The search part of a service-user query. Every word must match the first name, surname or preferred name (so
 * "Fatuma Ali" finds Fatuma Ali, and "Fat" still finds her); or the whole entry matches the CSB number, legacy SU
 * number or postcode; or it is the person's NHS number (only for restricted access); or the person holds an external
 * reference that matched exactly.
 */
export function serviceUserMatchWhere(q: string, opts: { sensitive: boolean; referenceIds: string[] }): Prisma.ServiceUserWhereInput {
  const or: Prisma.ServiceUserWhereInput[] = [];
  const terms = nameTerms(q);
  if (terms.length) or.push({ AND: terms.map((t) => ({ OR: [{ firstName: like(t) }, { lastName: like(t) }, { preferredName: like(t) }] })) });
  for (const r of referenceSpellings(q)) or.push({ reference: like(r) }, { csbReference: like(r) });
  for (const p of postcodeSpellings(q)) or.push({ postcode: like(p) });
  if (opts.sensitive) {
    const digits = q.replace(/^nhs(?:\s*(?:no\.?|number))?\s*[:#]?\s*/i, "").replace(/\s+/g, "");
    if (/^\d{10}$/.test(digits)) or.push({ nhsNumber: { in: storedSpellings("NHS", digits) } });
  }
  if (opts.referenceIds.length) or.push({ id: { in: opts.referenceIds } });
  return { OR: or };
}

/** Which external reference found the person, so a shared framework ID is never mistaken for their own number. */
export function matchedReferenceLabel(hits: ReferenceHit[], serviceUserId: string): string | null {
  const h = hits.find((x) => x.serviceUserId === serviceUserId);
  return h ? `${referenceTitle(h)}${h.type === "COUNCIL_FRAMEWORK" ? " (shared framework ID)" : ""}` : null;
}
