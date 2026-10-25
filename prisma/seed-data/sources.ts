import type { MonitoringCoverage, MonitoringMethod, SourceCategory } from "@prisma/client";
import { REQUIREMENTS } from "./library/requirements";

/** Legislation provisions cited in the requirements register for a source, as monitoring config. */
const provisionsFor = (source: string) =>
  REQUIREMENTS.filter((r) => r.source === source && r.sectionRef && !r.sectionRef.endsWith("/contents")).map((r) => ({ uri: r.sectionRef!, title: `${r.exactReference}: ${r.title}` }));
const govukPathsFor = (source: string) => REQUIREMENTS.filter((r) => r.source === source && r.sectionRef).map((r) => r.sectionRef!);

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
    config: { provisions: provisionsFor("legislation-regulated-activities-2014") },
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
    config: { provisions: provisionsFor("legislation-mca-care-act") },
    frequencyMinutes: 1440,
    freshnessWindowHours: 72,
    licence: OGL,
    reuseNotes: "Crown copyright, OGL v3.0.",
    monitoringNotes: "Partial: only the provisions cited in the requirements register are monitored.",
  },
  {
    key: "legislation-other",
    name: "Other legislation cited by starter policies (health and safety, data protection, equality, employment, mental health, food, controlled drugs, CQC registration)",
    canonicalUrl: "https://www.legislation.gov.uk/",
    category: "LEGISLATION",
    serviceTypes: ALL,
    monitoringMethod: "LEGISLATION_GOV_UK",
    coverage: "PARTIAL",
    config: { provisions: provisionsFor("legislation-other") },
    frequencyMinutes: 1440,
    freshnessWindowHours: 72,
    licence: OGL,
    reuseNotes: "Crown copyright, OGL v3.0.",
    monitoringNotes: "Partial: each provision cited in the requirements register is retrieved as CLML XML. Whole instruments cited only by their contents page (for example RIDDOR 2013) are reviewed manually.",
  },
  {
    key: "govuk-statutory-guidance",
    name: "GOV.UK: statutory guidance and codes of practice for adult social care",
    canonicalUrl: "https://www.gov.uk/",
    category: "GOVERNMENT_GUIDANCE",
    serviceTypes: ALL,
    monitoringMethod: "GOVUK_CONTENT_API",
    coverage: "AUTOMATED",
    config: { basePaths: govukPathsFor("govuk-statutory-guidance"), followLinkedDocuments: false, includePdfAttachments: false },
    frequencyMinutes: 720,
    freshnessWindowHours: 36,
    licence: OGL,
    reuseNotes: "Crown copyright content may be reused under OGL v3.0 with attribution.",
    monitoringNotes: "Uses the GOV.UK Content API for each publication cited in the requirements register (Care Act statutory guidance, MCA and MHA codes of practice, IPC code of practice, UKHSA guidance and others). The publication page and its summary are compared; attached PDFs are not compared. Paths must be confirmed on the first live run.",
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
        ...REQUIREMENTS.filter((r) => r.source === "cqc-regulation-guidance").map((r) => ({ url: r.url, title: r.exactReference, selector: "main" })),
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
      ["cqc-assessment-framework", "Care Quality Commission: assessment framework and quality statements", "https://www.cqc.org.uk/assessment/quality-statements", "REGULATOR", "Store quality statement titles, links and CSB summaries only. Check CQC terms of use before reproducing text.", "Manual review only. CQC has announced revisions to its assessment framework; quality statement mappings must be re-checked when the revised framework is published."],
      ["nmc", "Nursing and Midwifery Council (NMC)", "https://www.nmc.org.uk/", "WORKFORCE", "Check NMC terms before reuse.", "Manual review only: no verified API or feed configured."],
      ["restraint-reduction-network", "Restraint Reduction Network", "https://restraintreductionnetwork.org/", "BEST_PRACTICE", "Check RRN terms before reuse.", "Manual review only: no verified API or feed configured."],
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
