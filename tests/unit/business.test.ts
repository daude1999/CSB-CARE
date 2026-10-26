import { describe, expect, it } from "vitest";
import { fillTags, missingDetails, personaliseSections, splitTags, type BusinessDetails } from "@/lib/business";

const details = { company_name: "Brookfield Care", address: "1 High St", registered_manager: "Sam Lee", local_authority: "Leeds City Council" } as Partial<BusinessDetails>;

describe("business detail tags", () => {
  it("splits text into runs and tags with their values", () => {
    expect(splitTags("At {{company_name}}, ask {{phone}}.", details)).toEqual([{ text: "At " }, { tag: "company_name", value: "Brookfield Care" }, { text: ", ask " }, { tag: "phone", value: null }, { text: "." }]);
  });

  it("fills tags for downloads and prompts for missing ones", () => {
    expect(fillTags("{{company_name}} on {{phone}}", details)).toBe("Brookfield Care on [Main telephone: add in Settings]");
  });

  it("adds tags to starter text once, and replaces the local contacts prompt", () => {
    const out = personaliseSections(
      [
        { key: "scope", body: "It applies to all staff." },
        { key: "responsibilities", body: "The registered manager leads. The registered manager reviews." },
        { key: "local.contacts", body: "[Complete locally] List names." },
        { key: "framework", body: "the registered manager" },
      ],
      "POLICY",
    );
    expect(out[0]!.body).toContain("{{company_name}}");
    expect(out[1]!.body).toBe("The registered manager ({{registered_manager}}) leads. The registered manager reviews.");
    expect(out[2]!.body).toContain("{{safeguarding_lead}}");
    expect(out[3]!.body).toBe("the registered manager");
  });

  it("leaves forms and locally written contacts alone", () => {
    const local = { key: "local.contacts", body: "Call Jo on 0123." };
    expect(personaliseSections([local], "POLICY")[0]).toBe(local);
    expect(personaliseSections([{ key: "scope", body: "x" }], "FORM")[0]!.body).toBe("x");
  });

  it("lists required details that are missing", () => {
    expect(missingDetails(details as BusinessDetails)).toEqual(["phone", "nominated_individual", "safeguarding_lead"]);
  });
});
