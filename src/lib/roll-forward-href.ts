/** The Roll Forward dialog's address for a set of choices; shared by the page (server) and the dialog (client). */
export interface RollChoices {
  from: string;
  to: string;
  weeks: number;
  areaIds: string[];
}

export function rollHref(c: RollChoices) {
  const q = new URLSearchParams({ roll: "1", from: c.from, to: c.to, weeks: String(c.weeks) });
  for (const a of c.areaIds) q.append("areas", a);
  return `/rota/build?${q.toString()}`;
}
