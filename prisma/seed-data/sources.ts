import type { MonitoringCoverage, MonitoringMethod, SourceCategory } from "@prisma/client";

/**
 * Official source registry. Monitoring mechanisms are recorded honestly:
 * sources without a verified API/feed or permitted retrieval configuration are
 * MANUAL_REVIEW_ONLY and are never reported as continuously monitored.
 */
export interface SourceDef {
  key: string;
  name: string;
  canonicalUrl: string;
  category: SourceCategory;
  serviceTypes: string[];
  monitoringMethod: MonitoringMethod;
  coverage: MonitoringCoverage;
  config: Record<string, unknown>;
  frequencyMinutes: number;
  freshnessWindowHours: number;
  licence: string;
  reuseNotes: string;
  monitoringNotes: string;
  active?: boolean;
}

const OGL = "Open Government Licence v3.0";
const ALL = ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"];

export const SOURCES: SourceDef[] = [
  {
    key: "govuk-adult-social-care-guidance",
    name: "GOV.UK: Adult social care guidance collection",
    canonicalUrl: "https://www.gov.uk/government/collections/adult-social-care-guidance",
    category: "GOVERNMENT_GUIDANCE",
    serviceTypes: ALL,
    monitoringMethod: "GOVUK_CONTENT_API",
    coverage: "AUTOMATED",
    config: { basePaths: ["/government/collections/adult-social-care-guidance"], followLinkedDocuments: true, maxDocuments: 40, includePdfAttachments: false },
    frequencyMinutes: 720,
    freshnessWindowHours: 36,
    licence: OGL,
    reuseNotes: "Crown copyright content may be reused under OGL v3.0 with attribution. Store links and permitted excerpts.",
    monitoringNotes: "Uses the public GOV.UK Content API (JSON). The collection and each linked document are compared section by section. PDF attachments are not compared unless includePdfAttachments is enabled.",
  },
  {
    key: "govuk-dhsc-publications",
    name: "Department of Health and Social Care: recent publications",
    canonicalUrl: "https://www.gov.uk/government/organisations/department-of-health-and-social-care",
    category: "GOVERNMENT_GUIDANCE",
    serviceTypes: ALL,
    monitoringMethod: "GOVUK_SEARCH_API",
    coverage: "PARTIAL",
    config: { params: { filter_organisations: "department-of-health-and-social-care", order: "-public_timestamp", count: "20" }, maxDocuments: 20 },
    frequencyMinutes: 720,
    freshnessWindowHours: 36,
    licence: OGL,
    reuseNotes: "Crown copyright, OGL v3.0.",
    monitoringNotes: "Partial: only the 20 most recent DHSC publications are discovered (GOV.UK Search API) and retrieved via the Content API. Older documents are not re-checked unless added to a collection source.",
  },
  {
    key: "legislation-regulated-activities-2014",
    name: "Health and Social Care Act 2008 (Regulated Activities) Regulations 2014",
    canonicalUrl: "https://www.legislation.gov.uk/uksi/2014/2936/contents",
    category: "LEGISLATION",
    serviceTypes: ALL,
    monitoringMethod: "LEGISLATION_GOV_UK",
    coverage: "AUTOMATED",
    config: {
      provisions: [
        { uri: "/uksi/2014/2936/regulation/12", title: "Regulation 12: Safe care and treatment" },
        { uri: "/uksi/2014/2936/regulation/13", title: "Regulation 13: Safeguarding service users from abuse and improper treatment" },
        { uri: "/uksi/2014/2936/regulation/16", title: "Regulation 16: Receiving and acting on complaints" },
        { uri: "/uksi/2014/2936/regulation/17", title: "Regulation 17: Good governance" },
        { uri: "/uksi/2014/2936/regulation/19", title: "Regulation 19: Fit and proper persons employed" },
        { uri: "/uksi/2014/2936/regulation/20", title: "Regulation 20: Duty of candour" },
      ],
    },
    frequencyMinutes: 1440,
    freshnessWindowHours: 72,
    licence: OGL,
    reuseNotes: "Legislation text is Crown copyright, reusable under OGL v3.0.",
    monitoringNotes: "Retrieves CLML XML for each listed provision. Revised legislation can have outstanding effects not yet applied by legislation.gov.uk; the unapplied-effects count is recorded with each version.",
  },
  {
    key: "legislation-mca-care-act",
    name: "Mental Capacity Act 2005 and Care Act 2014 (selected provisions)",
    canonicalUrl: "https://www.legislation.gov.uk/",
    category: "LEGISLATION",
    serviceTypes: ALL,
    monitoringMethod: "LEGISLATION_GOV_UK",
    coverage: "PARTIAL",
    config: {
      provisions: [
        { uri: "/ukpga/2005/9/section/1", title: "Mental Capacity Act 2005, section 1: The principles" },
        { uri: "/ukpga/2014/23/section/42", title: "Care Act 2014, section 42: Enquiry by local authority" },
      ],
    },
    frequencyMinutes: 1440,
    freshnessWindowHours: 72,
    licence: OGL,
    reuseNotes: "Crown copyright, OGL v3.0.",
    monitoringNotes: "Partial: only the listed provisions are monitored.",
  },
  {
    key: "cqc-regulation-guidance",
    name: "Care Quality Commission: guidance on the regulations",
    canonicalUrl: "https://www.cqc.org.uk/guidance-providers/regulations",
    category: "REGULATOR",
    serviceTypes: ALL,
    monitoringMethod: "HTML_PAGE",
    coverage: "PARTIAL",
    config: {
      respectRobots: true,
      pages: [
        { url: "https://www.cqc.org.uk/guidance-providers/regulations/regulation-13-safeguarding-service-users-abuse-improper", title: "CQC: Regulation 13 guidance", selector: "main" },
        { url: "https://www.cqc.org.uk/guidance-providers/regulations/regulation-12-safe-care-treatment", title: "CQC: Regulation 12 guidance", selector: "main" },
      ],
    },
    frequencyMinutes: 1440,
    freshnessWindowHours: 72,
    licence: "CQC website content; check CQC terms of use before reusing text",
    reuseNotes: "Store links and short excerpts only. Verify CQC's reuse terms before reproducing content.",
    monitoringNotes: "Permitted page retrieval of selected pages (robots.txt respected). Page URLs and content selectors must be verified after deployment; a page-structure change is reported as a validation failure, not as a regulatory change. CQC's public API covers provider/location data, not guidance.",
  },
  ...(
    [
      ["nice", "National Institute for Health and Care Excellence (NICE)", "https://www.nice.org.uk/", "CLINICAL_GUIDANCE", "NICE content is subject to NICE's licence terms; the NICE syndication API requires registration and a licence.", "Manual review only until a NICE syndication API licence and key are configured."],
      ["skills-for-care", "Skills for Care", "https://www.skillsforcare.org.uk/", "WORKFORCE", "Check Skills for Care terms before reuse.", "Manual review only: no verified API or feed configured."],
      ["scie", "Social Care Institute for Excellence (SCIE)", "https://www.scie.org.uk/", "BEST_PRACTICE", "Check SCIE terms before reuse.", "Manual review only: no verified API or feed configured."],
      ["nhs-england", "NHS England", "https://www.england.nhs.uk/", "NHS", "Check NHS England terms before reuse.", "Manual review only: candidate feeds to be verified before enabling automated monitoring."],
      ["hse", "Health and Safety Executive (HSE)", "https://www.hse.gov.uk/", "HEALTH_AND_SAFETY", "HSE content is Crown copyright; check reuse terms.", "Manual review only: no verified API or feed configured."],
      ["ico", "Information Commissioner's Office (ICO)", "https://ico.org.uk/", "DATA_PROTECTION", "Check ICO reuse terms.", "Manual review only: no verified API or feed configured."],
      ["fsa", "Food Standards Agency", "https://www.food.gov.uk/", "FOOD_SAFETY", "Check FSA reuse terms.", "Manual review only: the FSA ratings API covers hygiene ratings, not guidance."],
      ["cqc-home", "Care Quality Commission (news and updates)", "https://www.cqc.org.uk/", "REGULATOR", "Check CQC terms of use.", "Manual review only: news feed availability not yet verified."],
    ] as const
  ).map(
    ([key, name, url, category, reuse, notes]): SourceDef => ({
      key,
      name,
      canonicalUrl: url,
      category,
      serviceTypes: ALL,
      monitoringMethod: "MANUAL",
      coverage: "MANUAL_REVIEW_ONLY",
      config: {},
      frequencyMinutes: 10080,
      freshnessWindowHours: 336,
      licence: "See source terms",
      reuseNotes: reuse,
      monitoringNotes: notes,
    }),
  ),
];
