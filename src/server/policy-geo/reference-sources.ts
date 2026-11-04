import type { GeoLevel, MonitoringCoverage, MonitoringMethod, SourceCategory } from "@prisma/client";

/**
 * Regional and local safeguarding sources CSB starts with, for the Tower Hamlets, Liverpool and Portsmouth branches.
 *
 * Honesty rules for this list (owner's brief, sections 6, 9 and 20):
 * - Only official addresses. Each was either given by the owner or found by web search on 4 November 2026. CSB's build
 *   system could not open these sites, so none has been read or verified: every organisation starts with the source
 *   marked "Not yet verified" and a manager must open it, check it and record that before it supports a policy.
 * - No telephone numbers, e-mail addresses or referral steps are recorded here. Those are entered by a manager from the
 *   official page in Branch & Local Authority Configuration, and the generator flags them as missing until then.
 * - Where applies-to areas are listed, they are the areas the document names for itself (from its title or the search
 *   result); a manager confirms them when verifying. A region's procedures are never applied to another region.
 */
export interface GeoSourceDef {
  key: string;
  name: string;
  issuingOrganisation: string;
  canonicalUrl: string;
  category: SourceCategory;
  geoLevel: GeoLevel;
  regionCodes: string[];
  localAuthorityCodes: string[];
  topics: string[];
  versionLabel?: string;
  monitoringMethod: MonitoringMethod;
  coverage: MonitoringCoverage;
  config: Record<string, unknown>;
  frequencyMinutes: number;
  monitoringNotes: string;
}

const FOUND = "Official address found by web search on 4 Nov 2026; the page was not opened from CSB's build system. Open it, check it is current and record the check before relying on it.";
const GIVEN = "Official address given by the owner on 4 Nov 2026; not yet opened from CSB's systems. Open it, check it is current and record the check before relying on it.";
const WEEKLY = 7 * 1440;
const page = (url: string, title: string) => ({ respectRobots: true, pages: [{ url, title, selector: "main" }] });
const SAFEGUARDING = ["SAFEGUARDING"];

export const GEO_SOURCES: GeoSourceDef[] = [
  // ── National (England) ──
  {
    key: "geo-care-support-statutory-guidance",
    name: "Care and support statutory guidance (Care Act 2014), including chapter 14 on safeguarding",
    issuingOrganisation: "Department of Health and Social Care",
    canonicalUrl: "https://www.gov.uk/government/publications/care-act-2014-supporting-implementation/care-and-support-statutory-guidance",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "NATIONAL",
    regionCodes: [],
    localAuthorityCodes: [],
    topics: [],
    monitoringMethod: "GOVUK_CONTENT_API",
    coverage: "PARTIAL",
    config: { basePaths: ["/government/publications/care-act-2014-supporting-implementation/care-and-support-statutory-guidance"], followLinkedDocuments: false, includePdfAttachments: false },
    frequencyMinutes: 1440,
    monitoringNotes: `${GIVEN} Checked through the public GOV.UK Content API once a live check succeeds.`,
  },
  {
    key: "geo-cqc-home",
    name: "Care Quality Commission: guidance for providers",
    issuingOrganisation: "Care Quality Commission",
    canonicalUrl: "https://www.cqc.org.uk/",
    category: "REGULATOR",
    geoLevel: "NATIONAL",
    regionCodes: [],
    localAuthorityCodes: [],
    topics: [],
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${GIVEN} The regulation-by-regulation CQC pages are monitored separately ("Care Quality Commission: guidance on the regulations").`,
  },
  // ── London ──
  {
    key: "geo-london-multi-agency-safeguarding",
    name: "London Multi-Agency Adult Safeguarding Policy and Procedures (Pan-London)",
    issuingOrganisation: "London Safeguarding Adults Board",
    canonicalUrl: "https://www.saeb.org.uk/professionals/guidance-and-resources/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "REGIONAL",
    regionCodes: ["LONDON"],
    localAuthorityCodes: [],
    topics: SAFEGUARDING,
    versionLabel: "Copies hosted by London councils are dated April 2019; check for a newer edition",
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://www.saeb.org.uk/professionals/guidance-and-resources/", "London safeguarding adults guidance and resources"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${GIVEN} Applies to London boroughs only. Never applied outside London.`,
  },
  {
    key: "geo-tower-hamlets-report-concern",
    name: "Tower Hamlets Council: I want to report a concern (adult safeguarding)",
    issuingOrganisation: "London Borough of Tower Hamlets",
    canonicalUrl: "https://towerhamlets.gov.uk/lgnl/health__social_care/Health-and-adult-social-care/Staying-safe/I-want-to-report-a-concern.aspx",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["LONDON"],
    localAuthorityCodes: ["tower-hamlets"],
    topics: SAFEGUARDING,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://towerhamlets.gov.uk/lgnl/health__social_care/Health-and-adult-social-care/Staying-safe/I-want-to-report-a-concern.aspx", "Tower Hamlets: report a concern"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} Search results showed different telephone numbers for Tower Hamlets on different sites, so no number is recorded: take it from this page only.`,
  },
  {
    key: "geo-tower-hamlets-referral-form",
    name: "Tower Hamlets Council: safeguarding adults referral form",
    issuingOrganisation: "London Borough of Tower Hamlets",
    canonicalUrl: "https://www.towerhamlets.gov.uk/Documents/Adult-care-services/Safeguarding-adults/Safeguarding-adults-referral-form.docx",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["LONDON"],
    localAuthorityCodes: ["tower-hamlets"],
    topics: SAFEGUARDING,
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} A Word form; reviewed by hand.`,
  },
  {
    key: "geo-tower-hamlets-sab-annual-report",
    name: "Tower Hamlets Safeguarding Adults Board: Annual Report 2022-23",
    issuingOrganisation: "Tower Hamlets Safeguarding Adults Board",
    canonicalUrl: "https://democracy.towerhamlets.gov.uk/documents/s225334/Appendix.%201%20for%20Tower%20Hamlets%20-%20Safeguarding%20Adults%20Board%20Annual%20Report%202022-23.pdf",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["LONDON"],
    localAuthorityCodes: ["tower-hamlets"],
    topics: SAFEGUARDING,
    versionLabel: "2022-23",
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} An annual report, not a procedure: it shows the Board's arrangements and learning. The Board's own procedures page still needs to be found and added.`,
  },
  // ── North West / Liverpool ──
  {
    key: "geo-north-west-safeguarding-adults-policy",
    name: "North West Safeguarding Adults Policy",
    issuingOrganisation: "North West Safeguarding Adults Boards",
    canonicalUrl: "https://www.cheshirewestandchester.gov.uk/residents/health-and-social-care/adult-social-care/lsab/documents/northwest-safeguarding-adults-policy.pdf",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "REGIONAL",
    regionCodes: ["NORTH_WEST"],
    localAuthorityCodes: [],
    topics: SAFEGUARDING,
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} The search result says local procedures for each council are provided separately. Check which edition Liverpool Safeguarding Adults Board currently uses.`,
  },
  {
    key: "geo-north-west-people-in-positions-of-trust",
    name: "North West Policy for Managing Concerns around People in Positions of Trust with Adults who have Care and Support Needs",
    issuingOrganisation: "North West Safeguarding Adults Boards",
    canonicalUrl: "https://liverpool.gov.uk/referrals/adults-social-care-referrals-and-training/safeguarding-adults-procedure/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "REGIONAL",
    regionCodes: ["NORTH_WEST"],
    localAuthorityCodes: [],
    topics: SAFEGUARDING,
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} Named on Liverpool City Council's procedure page; the address recorded is that page until the policy's own address is checked.`,
  },
  {
    key: "geo-liverpool-sab-local-policies",
    name: "Liverpool Safeguarding Adults Board: local policies and procedures",
    issuingOrganisation: "Liverpool Safeguarding Adults Board",
    canonicalUrl: "https://liverpoolsab.org/professionals/local-policies-and-procedures/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["NORTH_WEST"],
    localAuthorityCodes: ["liverpool"],
    topics: SAFEGUARDING,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://liverpoolsab.org/professionals/local-policies-and-procedures/", "Liverpool SAB: local policies and procedures"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${GIVEN} No adult-specific Pan-Merseyside protocol was found by search; check this page for any that Liverpool uses and add them.`,
  },
  {
    key: "geo-liverpool-cc-safeguarding-procedure",
    name: "Liverpool City Council: Safeguarding adults procedure (for professionals)",
    issuingOrganisation: "Liverpool City Council",
    canonicalUrl: "https://liverpool.gov.uk/adult-social-care/professional-referrals/safeguarding-adults/safeguarding-adults-procedure/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["NORTH_WEST"],
    localAuthorityCodes: ["liverpool"],
    topics: SAFEGUARDING,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://liverpool.gov.uk/adult-social-care/professional-referrals/safeguarding-adults/safeguarding-adults-procedure/", "Liverpool City Council: safeguarding adults procedure"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${GIVEN} A web search on 4 Nov 2026 also showed the page at liverpool.gov.uk/referrals/adults-social-care-referrals-and-training/safeguarding-adults-procedure/; confirm which address is current.`,
  },
  // ── South East / Portsmouth ──
  {
    key: "geo-4lsab-policy-guidance",
    name: "4LSAB Multi-Agency Safeguarding Adults Policy, Process and Guidance (Hampshire, Isle of Wight, Portsmouth and Southampton)",
    issuingOrganisation: "Hampshire, Isle of Wight, Portsmouth and Southampton Safeguarding Adults Boards (4LSAB)",
    canonicalUrl: "https://www.hampshiresab.org.uk/professionals-area/hampshire_4lsab_multiagency_safeguarding_adults_policy_guidance/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "REGIONAL",
    regionCodes: ["SOUTH_EAST"],
    localAuthorityCodes: ["hampshire", "isle-of-wight", "portsmouth", "southampton"],
    topics: SAFEGUARDING,
    versionLabel: "July 2023 (check for a newer edition)",
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://www.hampshiresab.org.uk/professionals-area/hampshire_4lsab_multiagency_safeguarding_adults_policy_guidance/", "4LSAB multi-agency safeguarding adults policy and guidance"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} Covers the four Safeguarding Adults Board areas named in its title only; never applied elsewhere in the South East.`,
  },
  {
    key: "geo-4lsab-marm-framework",
    name: "4LSAB Multi-Agency Risk Management (MARM) Framework: one-minute guide (high risk, self-neglect)",
    issuingOrganisation: "Hampshire, Isle of Wight, Portsmouth and Southampton Safeguarding Adults Boards (4LSAB)",
    canonicalUrl: "https://www.hampshiresab.org.uk/wp-content/uploads/One-Minute-Guide-to-the-4LSAB-MARM-Framework.pdf",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "REGIONAL",
    regionCodes: ["SOUTH_EAST"],
    localAuthorityCodes: ["hampshire", "isle-of-wight", "portsmouth", "southampton"],
    topics: SAFEGUARDING,
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: FOUND,
  },
  {
    key: "geo-portsmouth-report-concern",
    name: "Portsmouth City Council: Report a concern about an adult",
    issuingOrganisation: "Portsmouth City Council",
    canonicalUrl: "https://www.portsmouth.gov.uk/services/adult-social-care/report-a-concern-about-an-adult/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["SOUTH_EAST"],
    localAuthorityCodes: ["portsmouth"],
    topics: SAFEGUARDING,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://www.portsmouth.gov.uk/services/adult-social-care/report-a-concern-about-an-adult/", "Portsmouth: report a concern about an adult"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: `${FOUND} Take telephone and out-of-hours numbers from this page only.`,
  },
  {
    key: "geo-portsmouth-sab",
    name: "Portsmouth Safeguarding Adults Board",
    issuingOrganisation: "Portsmouth Safeguarding Adults Board",
    canonicalUrl: "https://www.portsmouthsab.uk/",
    category: "GOVERNMENT_GUIDANCE",
    geoLevel: "LOCAL",
    regionCodes: ["SOUTH_EAST"],
    localAuthorityCodes: ["portsmouth"],
    topics: SAFEGUARDING,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: page("https://www.portsmouthsab.uk/", "Portsmouth Safeguarding Adults Board"),
    frequencyMinutes: WEEKLY,
    monitoringNotes: FOUND,
  },
  {
    key: "geo-portsmouth-escalation-protocol",
    name: "Portsmouth City: one-minute guide to the escalation protocol",
    issuingOrganisation: "NHS England South East (Portsmouth guide)",
    canonicalUrl: "https://www.england.nhs.uk/south-east/wp-content/uploads/sites/45/2019/05/Portsmouth-City-One-minute-guide-Escalation-Protocol.pdf",
    category: "NHS",
    geoLevel: "LOCAL",
    regionCodes: ["SOUTH_EAST"],
    localAuthorityCodes: ["portsmouth"],
    topics: SAFEGUARDING,
    versionLabel: "May 2019 upload (check it is still current)",
    monitoringMethod: "MANUAL",
    coverage: "MANUAL_REVIEW_ONLY",
    config: {},
    frequencyMinutes: WEEKLY,
    monitoringNotes: FOUND,
  },
];
