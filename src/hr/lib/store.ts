import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { State } from "./domain";
import { upgradeFixtures } from "./upgrade-fixtures";
import { HttpError } from "./auth";

/**
 * The HR Hub's records for one organisation, stored in the platform database (HrWorkspace).
 * Replaces the standalone pilot's local SQLite file; every HR rule still runs on the same State document.
 */
const CURRENT_FIXTURE = 4;

async function load(tx: Prisma.TransactionClient, organisationId: string, lock: boolean): Promise<State> {
  const rows = lock
    ? await tx.$queryRaw<{ state: State }[]>`SELECT "state" FROM "HrWorkspace" WHERE "organisationId" = ${organisationId} FOR UPDATE`
    : await tx.$queryRaw<{ state: State }[]>`SELECT "state" FROM "HrWorkspace" WHERE "organisationId" = ${organisationId}`;
  if (!rows[0]) throw new HttpError(404, "HR & Workforce is not set up for this organisation yet.");
  return rows[0].state;
}

async function save(tx: Prisma.TransactionClient, organisationId: string, state: State) {
  await tx.hrWorkspace.update({ where: { organisationId }, data: { state: state as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
}

export async function read(organisationId: string): Promise<State> {
  const state = await load(db, organisationId, false);
  if ((state.fixtureVersion || 1) >= CURRENT_FIXTURE) return state;
  return transaction(organisationId, (s) => Object.assign(s, upgradeFixtures(s)));
}

/** Runs one HR change with the organisation's row locked, so two changes never overwrite each other. */
export async function transaction<T>(organisationId: string, fn: (state: State) => T): Promise<T> {
  return db.$transaction(async (tx) => {
    const state = await load(tx, organisationId, true);
    const upgraded = (state.fixtureVersion || 1) < CURRENT_FIXTURE ? upgradeFixtures(state) : state;
    const result = fn(upgraded);
    await save(tx, organisationId, upgraded);
    return result;
  });
}

/** Creates an organisation's HR workspace from a starting document (used by seeding). */
export async function createWorkspace(organisationId: string, state: State) {
  await db.hrWorkspace.upsert({
    where: { organisationId },
    create: { organisationId, state: state as unknown as Prisma.InputJsonValue },
    update: {},
  });
}
