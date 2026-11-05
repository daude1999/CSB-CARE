/**
 * Pure helpers for finding a service user from a search box entry (no database, no secrets). Shared by the top bar
 * search on rostering pages and the Service Users directory so both read an entry the same way.
 */

/** Trims, collapses inner whitespace and caps the length of a search entry. */
export function cleanSearch(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * The words of a name search. "Fatuma Ali" gives ["Fatuma", "Ali"]: every word must match the first name, surname or
 * preferred name, so a full name finds the person while each word on its own still finds partial names.
 */
export function nameTerms(q: string): string[] {
  return [...new Set(cleanSearch(q).split(" ").filter(Boolean))].slice(0, 6);
}

/**
 * Other spellings of the CSB and legacy SU numbers people type: "csb 159", "CSB159" and "CSB-159" all mean
 * CSB-000159; "su 159" and "SU159" mean SU-159. The entry as typed is always searched as well.
 */
export function referenceSpellings(q: string): string[] {
  const t = cleanSearch(q);
  const out = new Set<string>([t]);
  const csb = /^csb\s*[-–]?\s*(\d{1,6})$/i.exec(t);
  if (csb) out.add(`CSB-${csb[1]!.padStart(6, "0")}`);
  const su = /^su\s*[-–]?\s*(\d{1,8})$/i.exec(t);
  if (su) out.add(`SU-${su[1]}`);
  return [...out];
}

/** "E14AB" or "e1 4ab" → also try "E1 4AB", the way postcodes are normally stored. */
export function postcodeSpellings(q: string): string[] {
  const t = cleanSearch(q);
  const out = new Set<string>([t]);
  const compact = t.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) out.add(`${compact.slice(0, -3)} ${compact.slice(-3)}`);
  return [...out];
}

/**
 * Whether an entry could be an external reference (council, Frameworki, package or NHS number). Every such number
 * contains a digit, so ordinary name searches never touch the encrypted register.
 */
export const mayBeExternalReference = (q: string) => /\d/.test(q);
