import { describe, expect, it } from "vitest";
import { MAX_CARERS, carerPlaces, carersNeededLabel, openPlaces, parsePlace, placeData, placeKey, placeLabel, placeNumber, preferredFor, preferredOf, staffingOf } from "@/lib/carer-places";

describe("carer places", () => {
  it("numbers places 1 to N, keeping the original names for places 1 and 2", () => {
    expect(carerPlaces(1)).toEqual(["PRIMARY"]);
    expect(carerPlaces(4)).toEqual(["PRIMARY", "SECOND", "C3", "C4"]);
    expect(carerPlaces(99)).toHaveLength(MAX_CARERS);
    expect(placeNumber("C12")).toBe(12);
    expect(placeNumber("SHADOW")).toBeNull();
    expect(placeLabel("SECOND")).toBe("Carer 2");
    expect(placeLabel("SHADOW")).toBe("Shadow");
  });

  it("maps places to what is stored and back", () => {
    expect(placeData("PRIMARY")).toEqual({ slot: "PRIMARY", position: 1 });
    expect(placeData("C7")).toEqual({ slot: "ADDITIONAL", position: 7 });
    expect(placeData("SHADOW")).toEqual({ slot: "SHADOW", position: 0 });
    for (const k of [...carerPlaces(MAX_CARERS), "SHADOW" as const]) expect(placeKey(placeData(k))).toBe(k);
  });

  it("reads places from forms safely", () => {
    expect(parsePlace("c3")).toBe("C3");
    expect(parsePlace("2")).toBe("SECOND");
    expect(parsePlace("shadow")).toBe("SHADOW");
    for (const bad of ["C0", "C21", "21", "ADDITIONAL", "", "x", undefined, 3]) expect(parsePlace(bad)).toBeNull();
  });

  it("finds open places and staffing status, never counting a shadow", () => {
    const live = [{ slot: "PRIMARY", position: 1 }, { slot: "SHADOW", position: 0 }, { slot: "ADDITIONAL", position: 3 }];
    expect(openPlaces(4, live)).toEqual(["SECOND", "C4"]);
    expect(staffingOf(4, 2)).toBe("PARTIAL");
    expect(staffingOf(4, 0)).toBe("UNASSIGNED");
    expect(staffingOf(4, 4)).toBe("FULL");
  });

  it("labels the number of carers", () => {
    expect(carersNeededLabel(1)).toBe("1 carer");
    expect(carersNeededLabel(2)).toBe("Double-up");
    expect(carersNeededLabel(9)).toBe("9 carers");
  });

  it("lists a template's preferred carer for every place", () => {
    const t = { carersRequired: 4, preferredStaff1Id: "a", preferredStaff2Id: null, extraPreferredStaffIds: ["c", ""] };
    expect(preferredOf(t)).toEqual(["a", null, "c", null]);
    expect(preferredFor(t, "C3")).toBe("c");
    expect(preferredFor(t, "SHADOW")).toBeNull();
    expect(preferredOf({ carersRequired: 1, preferredStaff1Id: "a", preferredStaff2Id: "b" })).toEqual(["a"]);
  });
});
