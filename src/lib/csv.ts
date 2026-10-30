/**
 * CSV for spreadsheets and payroll or accounts imports (RFC 4180, CRLF, UTF-8 with a byte-order mark so Excel reads
 * names such as "Zoë" correctly).
 *
 * Text that a spreadsheet would run as a formula (starting with = + - @, a tab or carriage return, even after spaces)
 * is prefixed with an apostrophe. Plain numbers, including negative amounts such as -500, are left as numbers so
 * totals still add up in the spreadsheet.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA = /^[\s]*[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (!PLAIN_NUMBER.test(s) && FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_BOM = "﻿";

export function toCsv(columns: string[], rows: (string | number | boolean | null | undefined)[][]) {
  return CSV_BOM + [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
