/**
 * CQC registration pack content for the Resource Centre. Original CSB wording, written from
 * the public CQC registration guidance and the Health and Social Care Act 2008 (Regulated
 * Activities) Regulations 2014 and Care Quality Commission (Registration) Regulations 2009.
 * It is orientation, not legal advice: providers check the current CQC guidance before applying.
 */

export const CQC_REGISTRATION_URL = "https://www.cqc.org.uk/guidance-providers/registration";

export type Video = { key: string; title: string; summary: string; minutes: number; tone: "navy" | "teal" | "amber" | "rose" };

/** Short CSB explainer videos. The recordings are being produced, so tiles show as coming soon. */
export const VIDEOS: Video[] = [
  { key: "intro", title: "Introduction to the CQC application", summary: "Who must register, what a regulated activity is, and the order to tackle the application in.", minutes: 8, tone: "navy" },
  { key: "sop", title: "Writing your statement of purpose", summary: "The parts CQC expects, how much detail to give, and keeping it up to date after registration.", minutes: 6, tone: "teal" },
  { key: "business-plan", title: "Building a business plan CQC can rely on", summary: "Showing the service is financially viable, properly led and ready to deliver safe care from day one.", minutes: 7, tone: "amber" },
  { key: "training-matrix", title: "Setting up your training matrix", summary: "Mapping mandatory and role-specific training before your first staff start, and keeping evidence.", minutes: 5, tone: "rose" },
  { key: "interview", title: "Preparing for the registered manager interview", summary: "What the inspector is testing, how to evidence your answers and common gaps to close beforehand.", minutes: 9, tone: "navy" },
  { key: "policies", title: "Policies and procedures for registration", summary: "Which policies to have in place, how to personalise them and how to show staff have read them.", minutes: 6, tone: "teal" },
];

export type Step = { title: string; body: string };

export const STEPS: Step[] = [
  { title: "Confirm what you will do and how you are set up", body: "Decide which regulated activities you will carry on (for most adult social care, personal care or accommodation for persons who require nursing or personal care) and whether you are applying as an individual, a partnership or an organisation. Make sure your legal entity is set up and its details match Companies House." },
  { title: "Choose your key people", body: "An organisation names a nominated individual to supervise the management of the regulated activities. Each location needs a registered manager, unless the provider is an individual who manages the service themselves. Both need to be of good character and have the right skills and experience." },
  { title: "Get your DBS checks done through CQC's route", body: "Applicants, including the registered manager and nominated individual, need an enhanced DBS check with barred list checks, processed through CQC's umbrella body arrangement. Allow time for this: the application cannot progress without it." },
  { title: "Write your statement of purpose", body: "This is a legal document describing who you are, the services you provide, who they are for, where they are provided and your aims and objectives. It is submitted with the application and must be kept up to date afterwards." },
  { title: "Put your policies, plans and evidence in place", body: "Have your core policies personalised and approved, a business plan, a training plan and matrix, your recruitment process, insurance and, for care homes, premises checks such as fire and water safety. CQC will ask how you will meet each of the five key questions from your first day." },
  { title: "Submit the provider application", body: "Complete the application through the CQC online portal, attaching your statement of purpose and any documents requested. Check names, addresses and regulated activities carefully, as mistakes cause delays." },
  { title: "Submit the registered manager application", body: "Once the provider application is under way, the proposed registered manager applies separately. They will be asked about their experience, qualifications and how they will lead the service." },
  { title: "Assessment, interview and site visit", body: "A CQC registration inspector reviews the application and usually interviews the registered manager and sometimes the nominated individual. Care homes and some other services can expect a site visit. Be ready to show your policies, training plans and how you will keep people safe." },
  { title: "Decision and getting started", body: "CQC first issues a notice of proposal, then a notice of decision, and your registration certificate. Display your certificate, and once you are rated, your rating. Keep your statement of purpose current and send statutory notifications from the day you start." },
];

export type PackItem = { key: string; document: string; why: string; csb?: { ref: string; label: string }[]; resource?: string };

/** Documents CQC asks for, or will expect to see, matched to CSB documents that help. */
export const PACK: PackItem[] = [
  { key: "sop", document: "Statement of purpose", why: "Required with the application (Registration Regulations 2009, regulation 12 and schedule 3).", csb: [{ ref: "CSB-TPL-005", label: "Statement of Purpose template" }, { ref: "CSB-GOV-005", label: "Registration and regulatory relationships" }] },
  { key: "business-plan", document: "Business plan and financial viability", why: "Shows the service can be sustained and properly resourced.", resource: "business-plan" },
  { key: "dbs", document: "Enhanced DBS checks for applicants", why: "Needed for the registered manager and nominated individual, via CQC's umbrella body route.", csb: [{ ref: "CSB-REC-001", label: "Safer Recruitment" }] },
  { key: "fit-proper", document: "Fit and proper persons evidence for directors", why: "Regulation 5: directors and equivalents must be fit and proper.", csb: [{ ref: "CSB-GOV-010", label: "Fit and Proper Persons: Directors" }] },
  { key: "safeguarding", document: "Safeguarding adults policy and training plan", why: "Regulation 13: protecting people from abuse and improper treatment.", csb: [{ ref: "CSB-SAF-001", label: "Safeguarding Adults" }, { ref: "CSB-MCA-001", label: "Mental Capacity and Consent" }] },
  { key: "medicines", document: "Medicines management policy", why: "Regulation 12: safe care and treatment, including proper and safe use of medicines.", csb: [{ ref: "CSB-MED-001", label: "Medicines Management" }] },
  { key: "ipc", document: "Infection prevention and control policy", why: "Regulation 12 and the Code of Practice on infection prevention and control.", csb: [{ ref: "CSB-IPC-001", label: "Infection Prevention and Control" }] },
  { key: "complaints", document: "Complaints procedure", why: "Regulation 16: receiving and acting on complaints.", csb: [{ ref: "CSB-COM-001", label: "Complaints" }] },
  { key: "recruitment", document: "Recruitment procedure and staff file checklist", why: "Regulation 19: fit and proper persons employed, with schedule 3 information.", csb: [{ ref: "CSB-REC-001", label: "Safer Recruitment" }, { ref: "CSB-CHK-002", label: "Safer Recruitment File Checklist" }] },
  { key: "training", document: "Training plan and training matrix", why: "Regulation 18: staff are suitably qualified, competent, skilled and experienced.", csb: [{ ref: "CSB-TRN-001", label: "Induction, Training and Competence" }, { ref: "CSB-CHK-001", label: "New Starter Induction Checklist" }] },
  { key: "governance", document: "Governance, audit and quality assurance arrangements", why: "Regulation 17: good governance, with audits and action plans.", csb: [{ ref: "CSB-GOV-001", label: "Governance and Quality Assurance" }] },
  { key: "notifications", document: "Statutory notifications procedure", why: "Registration Regulations 2009, regulations 16 to 18: what you must tell CQC.", csb: [{ ref: "CSB-INC-002", label: "Statutory Notifications to CQC" }] },
  { key: "candour", document: "Duty of candour policy", why: "Regulation 20: openness when things go wrong.", csb: [{ ref: "CSB-DOC-001", label: "Duty of Candour" }] },
  { key: "continuity", document: "Business continuity plan", why: "Shows how care continues through staff shortages, outages and emergencies.", csb: [{ ref: "CSB-TPL-006", label: "Business Continuity Plan template" }] },
  { key: "insurance", document: "Insurance certificates", why: "Employer's and public liability cover, plus professional indemnity where relevant." },
  { key: "premises", document: "Premises safety evidence (care homes)", why: "Regulation 15: fire risk assessment, water safety and equipment checks.", csb: [{ ref: "CSB-HS-003", label: "Fire Safety" }, { ref: "CSB-HS-005", label: "Premises, Equipment and Water Safety" }] },
];

/** Downloadable CSB templates generated as branded Word and PDF documents. */
export const TEMPLATES = {
  "business-plan": {
    title: "Business Plan Template for CQC Registration",
    ref: "CSB-RES-001",
    description: "A structured business plan with prompts under each heading, written to help you show CQC that your service is viable, well led and ready to deliver safe care.",
    sections: [
      { heading: "How to use this template", body: "Replace each prompt with your own answer, written in plain English. Keep it specific to your service and your local area. Delete the prompts before you submit. Where you mention a policy, make sure it exists, is personalised and has been approved.\n[Complete locally] Keep a dated copy of each version you send to CQC or commissioners." },
      { heading: "About {{company_name}}", body: "• Legal entity, company number and registered office: {{address}}.\n• The regulated activities you will carry on and the service type: {{service_type}}.\n• Your nominated individual ({{nominated_individual}}) and registered manager ({{registered_manager}}), with a short summary of their experience.\n• Why you are setting up this service, and what will make it good for the people who use it." },
      { heading: "The people you will support", body: "• Who the service is for: age range, needs (for example dementia, learning disability, physical disability, mental health) and any needs you will not meet.\n• How many people you expect to support at launch, at six months and at two years.\n• How people will be referred: local authority, NHS, self-funders, other routes." },
      { heading: "Local need and market", body: "• Evidence of demand in {{local_authority}}: the local market position statement, commissioning intentions, waiting lists or conversations with commissioners.\n• Other providers nearby and what you will do differently.\n• Your geographical area, and for home care, realistic travel times between visits." },
      { heading: "Leadership and governance", body: "• Your management structure, with an organisation chart.\n• How the registered manager will be supported and supervised, and who deputises.\n• Your audit programme, quality monitoring and how you will act on findings.\n• How you will listen to people, families and staff, and use feedback to improve." },
      { heading: "Staffing and recruitment", body: "• Roles you need at launch and how many hours of care each role covers.\n• How you will recruit safely: references, DBS checks, right to work, gaps in employment.\n• Your induction (including the Care Certificate), mandatory training and training matrix.\n• Supervision, appraisal and how you will keep good staff." },
      { heading: "Delivering safe, effective care", body: "Explain briefly how you will meet each of CQC's five key questions from day one:\n• Safe: safeguarding, risk assessment, medicines, infection control, safe staffing.\n• Effective: assessment, care planning, consent and the Mental Capacity Act, working with health services.\n• Caring: dignity, privacy, involving people in decisions.\n• Responsive: person-centred plans, complaints, end of life care.\n• Well-led: culture, governance, continuous improvement." },
      { heading: "Policies and procedures", body: "• List the core policies you have in place and confirm they are personalised to {{company_name}} and approved.\n• How staff will read and sign policies, and how you will keep them under review." },
      { heading: "Financial plan", body: "• Start-up costs and how they are funded.\n• Fee rates by funder and your expected income in year one.\n• Staffing and running costs, with a break-even point.\n• Cash-flow forecast for at least the first 12 months, and the reserves you hold.\n• Insurance in place: employer's liability, public liability and professional indemnity." },
      { heading: "Risks and contingency", body: "• The main risks to the service (for example staff shortages, losing a contract, slow referrals) and how you will manage each one.\n• Your business continuity arrangements, including out-of-hours cover on {{phone}}." },
      { heading: "Milestones", body: "• Key dates: registration, recruitment, first referrals, first audit, first review of this plan.\n• What success looks like after 12 months, and how you will measure it." },
    ],
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
