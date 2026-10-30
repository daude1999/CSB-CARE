import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("CSV exports", () => {
  it("neutralises spreadsheet formulas, including after leading spaces", () => {
    for (const v of ["=1+1", "+44 7700", "@SUM(A1)", "-cmd|' /C calc'!A0", "  =HYPERLINK(\"x\")", "\t=1"]) expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("keeps numbers, including negative amounts, as numbers so totals still add up", () => {
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell("-500")).toBe("-500");
    expect(csvCell("12.75")).toBe("12.75");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("quotes commas, quotes, line breaks and padded text, and starts with a byte-order mark for Excel", () => {
    expect(csvCell('Zoë "Jo", carer')).toBe('"Zoë ""Jo"", carer"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    const csv = toCsv(["Name", "Amount"], [["Zoë", -250], [null, 3]]);
    expect(csv.startsWith("﻿Name,Amount\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")[2]).toBe(",3");
  });
});
