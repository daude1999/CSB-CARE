import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/** Maps authorisation and not-found errors to a 404 so pages never reveal whether a record exists. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError) notFound();
    throw e;
  }
}
