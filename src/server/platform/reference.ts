import type { Tx } from "@/lib/db";

/** The next permanent customer reference (EVX-0001, EVX-0002, ...) from a database sequence, so it is never reused. */
export async function nextCustomerReference(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('customer_reference_seq') AS n`;
  return `EVX-${String(Number(row?.n ?? 0)).padStart(4, "0")}`;
}
