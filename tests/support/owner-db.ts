import { PrismaClient } from "@prisma/client";

/**
 * A plain connection as the database owner, for the few tests that must do what the application role (`csb_app`)
 * is rightly not allowed to do: change the structure of a table to simulate a broken database, add a failing
 * trigger, or read and drop a backup schema made by a maintenance script. Never use it to read or write tenant
 * rows in a test of application behaviour: that would skip row-level security.
 */
export const ownerDb = new PrismaClient();
