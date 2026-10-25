import type { LegalStatus } from "@prisma/client";

/**
 * Starter requirements register. Every excerpt is an Evantix summary written for
 * orientation, NOT a quotation, and every entry is seeded as UNVERIFIED: wording,
 * section numbers and effective dates must be checked against the official text.
 */
export interface RequirementDef {
  ref: string;
  title: string;
  /** RegulatorySource.key */
  source: string;
  exactReference: string;
  sectionRef?: string;
  url: string;
  summary: string;
  legalStatus: LegalStatus;
  serviceTypes?: string[];
  applicabilityNotes?: string;
}

const LEG = "legislation-regulated-activities-2014";
const MCA = "legislation-mca-care-act";
const OTHER = "legislation-other";
const CQC = "cqc-assessment-framework";
const GOVUK = "govuk-statutory-guidance";
const CQCG = "cqc-regulation-guidance";

/** Statutory, regulator and national guidance. Refs start GDN- and are cited per document. */
const gdn = (ref: string, source: string, exactReference: string, url: string, summary: string, legalStatus: LegalStatus = "ADVISORY_GUIDANCE"): RequirementDef => ({
  ref,
  title: exactReference,
  source,
  exactReference,
  sectionRef: url.startsWith("https://www.gov.uk") ? url.slice("https://www.gov.uk".length) : undefined,
  url,
  summary,
  legalStatus,
});
const nice = (code: string, title: string, year: number, summary: string): RequirementDef =>
  gdn(`GDN-NICE-${code}`, "nice", `NICE ${code.startsWith("QS") ? "quality standard" : "guideline"} ${code}: ${title} (${year})`, `https://www.nice.org.uk/guidance/${code.toLowerCase()}`, summary, "ADVISORY_GUIDANCE");

const ra = (n: string, title: string, summary: string, ref: string): RequirementDef => ({
  ref,
  title,
  source: LEG,
  exactReference: `SI 2014/2936, regulation ${n}`,
  sectionRef: `/uksi/2014/2936/regulation/${n}`,
  url: `https://www.legislation.gov.uk/uksi/2014/2936/regulation/${n}`,
  summary,
  legalStatus: "LEGISLATION",
});

const leg = (ref: string, title: string, exactReference: string, path: string, summary: string, source = OTHER): RequirementDef => ({
  ref,
  title,
  source,
  exactReference,
  sectionRef: path,
  url: `https://www.legislation.gov.uk${path}`,
  summary,
  legalStatus: "LEGISLATION",
});

export const REQUIREMENTS: RequirementDef[] = [
  // The first eight entries keep their original refs; tests and demo data use them.
  ra("13", "Protect people from abuse and improper treatment", "Providers must have systems and processes to prevent abuse and to investigate allegations.", "REQ-ENG-0001"),
  ra("12", "Safe care and treatment, including proper and safe management of medicines", "Care must be provided in a safe way, including the proper and safe management of medicines.", "REQ-ENG-0002"),
  ra("16", "Receiving and acting on complaints", "Complaints must be investigated and proportionate action taken; an accessible system must be in place.", "REQ-ENG-0003"),
  ra("17", "Good governance", "Systems must assess, monitor and improve quality and safety, and maintain accurate records.", "REQ-ENG-0004"),
  ra("19", "Fit and proper persons employed", "Persons employed must be of good character and have the necessary qualifications, competence, skills and experience.", "REQ-ENG-0005"),
  ra("20", "Duty of candour", "Providers must act in an open and transparent way when a notifiable safety incident occurs.", "REQ-ENG-0006"),
  leg("REQ-ENG-0007", "Principles of the Mental Capacity Act", "Mental Capacity Act 2005, section 1", "/ukpga/2005/9/section/1", "Statutory principles on presumption of capacity, supported decision making, unwise decisions, best interests and least restriction.", MCA),
  leg("REQ-ENG-0008", "Local authority safeguarding enquiries", "Care Act 2014, section 42", "/ukpga/2014/23/section/42", "Duty on local authorities to make enquiries where an adult with care and support needs may be at risk of abuse or neglect.", MCA),

  // Remaining fundamental standards.
  ra("9", "Person-centred care", "Care must be appropriate, meet the person's needs and reflect their preferences, with the person involved in assessing and planning it.", "REQ-ENG-0009"),
  ra("10", "Dignity and respect", "People must be treated with dignity and respect, including privacy, autonomy and support to stay independent and involved in their community.", "REQ-ENG-0010"),
  ra("11", "Need for consent", "Care must only be provided with the consent of the relevant person, or in line with the Mental Capacity Act where they lack capacity.", "REQ-ENG-0011"),
  ra("14", "Meeting nutritional and hydration needs", "People must have enough to eat and drink to sustain good health, with their preferences, cultural and religious needs and any support needs met.", "REQ-ENG-0012"),
  ra("15", "Premises and equipment", "Premises and equipment must be clean, secure, suitable, properly used and maintained.", "REQ-ENG-0013"),
  ra("18", "Staffing", "There must be sufficient numbers of suitably qualified, competent and experienced staff, who receive the support, training, supervision and appraisal they need.", "REQ-ENG-0014"),
  ra("20A", "Display of performance assessments", "Providers must display their most recent CQC rating where people can see it, including on their website.", "REQ-ENG-0015"),

  // Mental Capacity Act 2005 and Care Act 2014.
  leg("REQ-ENG-0016", "People who lack capacity and the test of capacity", "Mental Capacity Act 2005, sections 2 and 3", "/ukpga/2005/9/section/2", "Defines lack of capacity for a specific decision at a specific time and how inability to make a decision is assessed.", MCA),
  leg("REQ-ENG-0017", "Best interests", "Mental Capacity Act 2005, section 4", "/ukpga/2005/9/section/4", "Sets out what must be considered when a decision is made in the best interests of a person who lacks capacity, including their wishes, feelings, beliefs and values.", MCA),
  leg("REQ-ENG-0018", "Deprivation of liberty in care homes and hospitals", "Mental Capacity Act 2005, section 4A and Schedule A1", "/ukpga/2005/9/schedule/A1", "Framework for authorising a deprivation of liberty in a care home or hospital, including urgent and standard authorisations requested from the supervisory body.", MCA),
  leg("REQ-ENG-0019", "Lasting powers of attorney", "Mental Capacity Act 2005, section 9", "/ukpga/2005/9/section/9", "Describes lasting powers of attorney for property and financial affairs and for health and welfare, and the authority they give.", MCA),
  leg("REQ-ENG-0020", "Advance decisions to refuse treatment", "Mental Capacity Act 2005, sections 24 to 26", "/ukpga/2005/9/section/24", "Allows an adult with capacity to refuse specified treatment in advance; sets out validity and applicability, including written requirements for life-sustaining treatment.", MCA),
  leg("REQ-ENG-0021", "Promoting individual wellbeing", "Care Act 2014, section 1", "/ukpga/2014/23/section/1", "Local authorities must promote wellbeing when carrying out care and support functions; providers commissioned by them work to the same principle.", MCA),

  // Other legislation (manual review source).
  leg("REQ-ENG-0022", "Notification of death of a service user", "SI 2009/3112, regulation 16", "/uksi/2009/3112/regulation/16", "Registered persons must notify CQC without delay of the death of a person using the service, with specified details.", OTHER),
  leg("REQ-ENG-0023", "Notification of other incidents", "SI 2009/3112, regulation 18", "/uksi/2009/3112/regulation/18", "Registered persons must notify CQC of specified events including serious injuries, abuse or allegations of abuse, police incidents, DoLS applications and outcomes, and events that stop the service running safely.", OTHER),
  leg("REQ-ENG-0024", "General duties of employers to their employees", "Health and Safety at Work etc. Act 1974, section 2", "/ukpga/1974/37/section/2", "Employers must ensure, so far as is reasonably practicable, the health, safety and welfare at work of their employees.", OTHER),
  leg("REQ-ENG-0025", "Duties to people other than employees", "Health and Safety at Work etc. Act 1974, section 3", "/ukpga/1974/37/section/3", "Employers must conduct their undertaking so that people not in their employment, such as the people they support and visitors, are not exposed to risks to their health or safety, so far as is reasonably practicable.", OTHER),
  leg("REQ-ENG-0026", "Risk assessment", "SI 1999/3242, regulation 3", "/uksi/1999/3242/regulation/3", "Employers must make a suitable and sufficient assessment of the risks to employees and others, and record significant findings where five or more people are employed.", OTHER),
  leg("REQ-ENG-0027", "Manual handling operations", "SI 1992/2793, regulation 4", "/uksi/1992/2793/regulation/4", "Hazardous manual handling should be avoided so far as reasonably practicable; otherwise it must be assessed and the risk of injury reduced.", OTHER),
  leg("REQ-ENG-0028", "Thorough examination of lifting equipment", "SI 1998/2307, regulation 9", "/uksi/1998/2307/regulation/9", "Lifting equipment, including equipment for lifting people, must be thoroughly examined at set intervals by a competent person.", OTHER),
  leg("REQ-ENG-0029", "Control of substances hazardous to health", "SI 2002/2677, regulations 6 and 7", "/uksi/2002/2677/regulation/6", "Employers must assess the risks from hazardous substances, including biological agents, and prevent or adequately control exposure.", OTHER),
  leg("REQ-ENG-0030", "Reporting of injuries, diseases and dangerous occurrences", "SI 2013/1471 (RIDDOR 2013)", "/uksi/2013/1471/contents", "Specified work-related injuries, diseases and dangerous occurrences must be reported to the enforcing authority within set timescales.", OTHER),
  leg("REQ-ENG-0031", "Fire risk assessment", "SI 2005/1541, article 9", "/uksi/2005/1541/article/9", "The responsible person must make a suitable and sufficient assessment of fire risks and keep it under review.", OTHER),
  leg("REQ-ENG-0032", "Principles for processing personal data", "UK GDPR, Article 5", "/eur/2016/679/article/5", "Personal data must be processed lawfully, fairly and transparently, for specified purposes, kept accurate, minimised, retained no longer than necessary and kept secure; the controller must be able to demonstrate compliance.", OTHER),
  leg("REQ-ENG-0033", "Security of processing", "UK GDPR, Article 32", "/eur/2016/679/article/32", "Controllers and processors must use appropriate technical and organisational measures to keep personal data secure.", OTHER),
  leg("REQ-ENG-0034", "Notifying personal data breaches", "UK GDPR, Article 33", "/eur/2016/679/article/33", "Reportable personal data breaches must be notified to the ICO without undue delay and, where feasible, within 72 hours of becoming aware of them.", OTHER),
  leg("REQ-ENG-0035", "Duty to make reasonable adjustments", "Equality Act 2010, section 20", "/ukpga/2010/15/section/20", "Service providers and employers must make reasonable adjustments so that disabled people are not placed at a substantial disadvantage.", OTHER),
  leg("REQ-ENG-0036", "Protected disclosures", "Employment Rights Act 1996, section 43B (as inserted by the Public Interest Disclosure Act 1998)", "/ukpga/1996/18/section/43B", "Defines qualifying disclosures of information about wrongdoing; workers who make protected disclosures must not be subjected to detriment or dismissed for doing so.", OTHER),
  leg("REQ-ENG-0037", "Duty to refer to the Disclosure and Barring Service", "Safeguarding Vulnerable Groups Act 2006, section 35", "/ukpga/2006/47/section/35", "Regulated activity providers must refer a person to the DBS when they remove them from regulated activity because of harm, or risk of harm, to vulnerable adults.", OTHER),
  leg("REQ-ENG-0038", "Safe custody of controlled drugs", "SI 1973/798 (Misuse of Drugs (Safe Custody) Regulations 1973)", "/uksi/1973/798/contents", "Sets standards for the secure storage of certain controlled drugs, including in care homes.", OTHER),
  leg("REQ-ENG-0039", "Food hygiene and allergen information", "Food Safety Act 1990; SI 2014/1855 (Food Information Regulations 2014)", "/uksi/2014/1855/contents", "Food must be safe and prepared hygienically by a registered food business; information about the 14 specified allergens must be available for food provided.", OTHER),
  leg("REQ-ENG-0040", "Right to work checks", "Immigration, Asylum and Nationality Act 2006, section 15", "/ukpga/2006/13/section/15", "Employers face civil penalties for employing a person without the right to work; prescribed checks before employment provide a statutory excuse.", OTHER),
  leg("REQ-ENG-0041", "Offence of slavery, servitude and forced labour", "Modern Slavery Act 2015, section 1", "/ukpga/2015/30/section/1", "Creates offences of holding a person in slavery or servitude or requiring them to perform forced or compulsory labour.", OTHER),

  // Further fundamental standards and legislation.
  ra("5", "Fit and proper persons: directors", "Directors and equivalent post-holders must be of good character, have the necessary qualifications, competence and experience, and must not have been responsible for serious misconduct or mismanagement.", "REQ-ENG-0042"),
  leg("REQ-ENG-0043", "After-care under the Mental Health Act", "Mental Health Act 1983, section 117", "/ukpga/1983/20/section/117", "Integrated care boards and local authorities must provide after-care services, free of charge, to people who have been detained under certain sections until they no longer need them.", OTHER),
  leg("REQ-ENG-0044", "Guardianship", "Mental Health Act 1983, section 7", "/ukpga/1983/20/section/7", "Allows a person aged 16 or over to be received into guardianship, giving the guardian powers such as requiring the person to live at a specified place.", OTHER),
  leg("REQ-ENG-0045", "Definition of domestic abuse", "Domestic Abuse Act 2021, section 1", "/ukpga/2021/17/section/1", "Defines domestic abuse as abusive behaviour between people aged 16 or over who are personally connected, including physical, sexual, controlling or coercive, economic and psychological abuse.", OTHER),
  leg("REQ-ENG-0046", "Working time limits and rest breaks", "SI 1998/1833, regulations 4 and 12", "/uksi/1998/1833/regulation/4", "Limits average weekly working time unless the worker opts out, and gives workers rest breaks during the working day.", OTHER),
  leg("REQ-ENG-0047", "Risk assessment for new or expectant mothers", "SI 1999/3242, regulation 16", "/uksi/1999/3242/regulation/16", "Employers must assess risks to workers who are pregnant, have recently given birth or are breastfeeding, and avoid those risks.", OTHER),
  leg("REQ-ENG-0048", "First aid provision", "SI 1981/917, regulation 3", "/uksi/1981/917/regulation/3", "Employers must provide adequate and appropriate first aid equipment, facilities and trained people.", OTHER),
  leg("REQ-ENG-0049", "Unfair contract terms", "Consumer Rights Act 2015, section 62", "/ukpga/2015/15/section/62", "Unfair terms in consumer contracts, such as care home contracts with self-funding residents, are not binding on the consumer.", OTHER),

  // Statutory guidance and codes of practice (GOV.UK, monitored).
  gdn("GDN-0001", GOVUK, "Care and support statutory guidance (Care Act 2014)", "https://www.gov.uk/government/publications/care-act-statutory-guidance", "Statutory guidance on the Care Act, including wellbeing, prevention, assessment, safeguarding adults (chapter 14), advocacy and market shaping.", "STATUTORY_GUIDANCE"),
  gdn("GDN-0002", GOVUK, "Mental Capacity Act 2005 Code of Practice", "https://www.gov.uk/government/publications/mental-capacity-act-code-of-practice", "Statutory code explaining how the MCA works day to day, which care workers must have regard to when acting for people who may lack capacity.", "STATUTORY_GUIDANCE"),
  gdn("GDN-0003", GOVUK, "Deprivation of Liberty Safeguards: forms and guidance", "https://www.gov.uk/government/publications/deprivation-of-liberty-safeguards-forms-and-guidance", "Forms and guidance for managing authorities applying for DoLS authorisations, used with the DoLS code of practice.", "STATUTORY_GUIDANCE"),
  gdn("GDN-0004", GOVUK, "Health and Social Care Act 2008: code of practice on the prevention and control of infections", "https://www.gov.uk/government/publications/the-health-and-social-care-act-2008-code-of-practice-on-the-prevention-and-control-of-infections-and-related-guidance", "Statutory code setting out the criteria registered providers are judged against for infection prevention and control.", "STATUTORY_GUIDANCE"),
  gdn("GDN-0005", GOVUK, "Mental Health Act 1983: Code of Practice", "https://www.gov.uk/government/publications/code-of-practice-mental-health-act-1983", "Statutory guidance for professionals on the Mental Health Act, including guardianship, community treatment orders and after-care.", "STATUTORY_GUIDANCE"),
  gdn("GDN-0006", GOVUK, "UKHSA and DHSC: infection prevention and control in adult social care settings", "https://www.gov.uk/government/publications/infection-prevention-and-control-in-adult-social-care-settings", "National guidance on standard and transmission-based precautions, outbreaks and acute respiratory infections in adult social care."),
  gdn("GDN-0007", GOVUK, "UKHSA: Adverse Weather and Health Plan", "https://www.gov.uk/government/publications/adverse-weather-and-health-plan", "National plan and supporting guidance for protecting health during hot and cold weather, including actions for care settings."),
  gdn("GDN-0008", GOVUK, "Code of practice for the international recruitment of health and social care personnel in England", "https://www.gov.uk/government/publications/code-of-practice-for-the-international-recruitment-of-health-and-social-care-personnel", "Sets ethical standards for recruiting staff from overseas, including not charging workers recruitment fees."),
  gdn("GDN-0009", GOVUK, "Home Office: fire safety risk assessment for residential care premises", "https://www.gov.uk/government/publications/fire-safety-risk-assessment-residential-care-premises", "Guide for responsible persons on carrying out and reviewing fire risk assessments in care homes, including evacuation strategies."),
  gdn("GDN-0010", GOVUK, "CMA: care homes consumer law advice for providers", "https://www.gov.uk/government/publications/care-homes-consumer-law-advice-for-providers", "Explains how consumer law applies to care homes, including fair contract terms, upfront information about fees and complaints."),
  gdn("GDN-0011", GOVUK, "Home Office: modern slavery: how to identify and support victims", "https://www.gov.uk/government/publications/modern-slavery-how-to-identify-and-support-victims", "Statutory guidance on recognising indicators of modern slavery and referral routes.", "STATUTORY_GUIDANCE"),

  // Regulator guidance (CQC).
  gdn("GDN-0012", CQCG, "CQC guidance: statutory notifications", "https://www.cqc.org.uk/guidance-providers/notifications", "Explains which events registered providers must notify CQC about and how.", "REGULATOR_GUIDANCE"),
  gdn("GDN-0013", CQCG, "CQC guidance: Regulation 20 duty of candour", "https://www.cqc.org.uk/guidance-providers/regulations/regulation-20-duty-candour", "Guidance for providers on meeting the duty of candour, including what counts as a notifiable safety incident.", "REGULATOR_GUIDANCE"),
  gdn("GDN-0014", CQCG, "CQC: Right support, right care, right culture", "https://www.cqc.org.uk/guidance-providers/autism-learning-disability/right-support-right-care-right-culture", "CQC's guidance on how it regulates services for autistic people and people with a learning disability.", "REGULATOR_GUIDANCE"),
  gdn("GDN-0015", CQCG, "CQC: using surveillance in your care service", "https://www.cqc.org.uk/guidance-providers/all-services/using-surveillance-your-care-service", "Information for providers considering CCTV or other surveillance, covering privacy, consent and data protection.", "REGULATOR_GUIDANCE"),
  gdn("GDN-0016", CQCG, "CQC guidance: Regulation 5 fit and proper persons: directors", "https://www.cqc.org.uk/guidance-providers/regulations/regulation-5-fit-proper-persons-directors", "Guidance on checks providers must make on directors and equivalents.", "REGULATOR_GUIDANCE"),

  // NICE guidelines and quality standards (manual review; NICE licence applies).
  nice("SC1", "Managing medicines in care homes", 2014, "Recommendations on safe and effective use of medicines in care homes, from ordering to disposal, including covert administration and self-administration."),
  nice("NG67", "Managing medicines for adults receiving social care in the community", 2017, "Recommendations for home care providers on assessing and supporting people with their medicines."),
  nice("NG46", "Controlled drugs: safe use and management", 2016, "Systems and processes for using and managing controlled drugs safely."),
  nice("NG5", "Medicines optimisation", 2015, "Safe and effective use of medicines, including medicines reconciliation and medication review."),
  nice("NG189", "Safeguarding adults in care homes", 2021, "Recommendations on policy, training, recognising and responding to abuse and neglect in care homes."),
  nice("NG108", "Decision-making and mental capacity", 2018, "Supporting decision-making, assessing capacity, best interests decisions and advance care planning."),
  nice("NG86", "People's experience in adult social care services", 2018, "Improving experience of care through person-centred support, information and involvement."),
  nice("NG21", "Home care: delivering personal care and practical support to older people living in their own homes", 2015, "Planning and delivering home care, including visit length, continuity and workforce support."),
  nice("NG27", "Transition between inpatient hospital settings and community or care home settings for adults with social care needs", 2015, "Admission to and discharge from hospital for people with social care needs."),
  nice("NG53", "Transition between inpatient mental health settings and community or care home settings", 2016, "Admission to and discharge from mental health inpatient settings."),
  nice("NG11", "Challenging behaviour and learning disabilities", 2015, "Prevention and interventions for people with learning disabilities whose behaviour challenges."),
  nice("NG93", "Learning disabilities and behaviour that challenges: service design and delivery", 2018, "Designing services that support people to live in their communities."),
  nice("NG54", "Mental health problems in people with learning disabilities", 2016, "Prevention, assessment and management of mental health problems in people with learning disabilities."),
  nice("NG31", "Care of dying adults in the last days of life", 2015, "Recognising dying, communication, hydration and symptom management in the last days of life."),
  nice("NG142", "End of life care for adults: service delivery", 2019, "Organising services so people approaching the end of life get coordinated, person-centred care."),
  nice("NG48", "Oral health for adults in care homes", 2016, "Oral health assessment, daily mouth care and staff training in care homes."),
  nice("CG179", "Pressure ulcers: prevention and management", 2014, "Risk assessment, skin assessment, repositioning and pressure-relieving equipment."),
  nice("NG249", "Falls: assessment and prevention in older people and in people 50 and over at higher risk", 2025, "Identifying falls risk, multifactorial assessment and interventions to prevent falls."),
  nice("CG32", "Nutrition support for adults", 2006, "Screening for malnutrition and providing oral, enteral and parenteral nutrition support."),
  nice("NG51", "Suspected sepsis: recognition, diagnosis and early management", 2016, "Recognising and responding quickly to people who may have sepsis."),
  nice("NG97", "Dementia: assessment, management and support for people living with dementia and their carers", 2018, "Care and support for people living with dementia, including managing distress and reducing antipsychotic use."),
  nice("CG139", "Healthcare-associated infections: prevention and control in primary and community care", 2012, "Standard precautions and care of urinary catheters and enteral feeding systems in community settings."),
  nice("QS61", "Infection prevention and control", 2014, "Quality statements on hand hygiene, catheter care and antimicrobial prescribing."),
  nice("NG150", "Supporting adult carers", 2020, "Identifying, assessing and supporting unpaid carers."),
  nice("NG32", "Older people: independence and mental wellbeing", 2015, "Activities and approaches that maintain independence and mental wellbeing in later life."),
  nice("NG10", "Violence and aggression: short-term management in mental health, health and community settings", 2015, "Preventing and managing violence and aggression, including de-escalation and restrictive interventions."),
  nice("NG225", "Self-harm: assessment, management and preventing recurrence", 2022, "Supporting people who self-harm, including safety planning."),
  nice("NG58", "Coexisting severe mental illness and substance misuse: community health and social care services", 2016, "Joined-up support for people with severe mental illness who misuse substances."),
  nice("NG28", "Type 2 diabetes in adults: management", 2015, "Managing type 2 diabetes, including blood glucose and recognising complications."),
  nice("NG217", "Epilepsies in children, young people and adults", 2022, "Diagnosis and management of epilepsy, including emergency seizure management."),

  // Other national bodies (manual review).
  gdn("GDN-SFC-1", "skills-for-care", "Skills for Care: the Care Certificate standards", "https://www.skillsforcare.org.uk/Developing-your-workforce/Care-Certificate/Care-Certificate.aspx", "The standards new care workers should meet during induction.", "BEST_PRACTICE"),
  gdn("GDN-SFC-2", "skills-for-care", "Skills for Care: guidance on supervision and workforce development", "https://www.skillsforcare.org.uk/", "Practical guidance for employers on supervision, appraisal and developing the adult social care workforce.", "BEST_PRACTICE"),
  gdn("GDN-HSE-1", "hse", "HSE: Health and safety in care homes (HSG220)", "https://www.hse.gov.uk/pubns/books/hsg220.htm", "HSE guidance on managing the main health and safety risks in care homes."),
  gdn("GDN-HSE-2", "hse", "HSE: Legionnaires' disease: the control of legionella bacteria in water systems (L8)", "https://www.hse.gov.uk/pubns/books/l8.htm", "Approved Code of Practice on assessing and controlling legionella risks.", "STATUTORY_GUIDANCE"),
  gdn("GDN-HSE-3", "hse", "HSE: Management Standards for work-related stress", "https://www.hse.gov.uk/stress/standards/", "Framework for assessing and managing the causes of work-related stress."),
  gdn("GDN-HSE-4", "hse", "HSE: First aid at work (L74)", "https://www.hse.gov.uk/pubns/books/l74.htm", "Guidance on the First-Aid Regulations, including needs assessment."),
  gdn("GDN-HSE-5", "hse", "HSE: Violence and aggression at work", "https://www.hse.gov.uk/violence/", "Guidance on assessing and reducing the risk of work-related violence."),
  gdn("GDN-HSE-6", "hse", "HSE: Moving and handling in health and social care", "https://www.hse.gov.uk/healthservices/moving-handling.htm", "Guidance on assessing and reducing moving and handling risks for people and workers."),
  gdn("GDN-ICO-1", "ico", "ICO: guide to UK GDPR and data protection", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/", "Regulator guidance on the data protection principles, lawful bases, rights and breaches.", "REGULATOR_GUIDANCE"),
  gdn("GDN-ICO-2", "ico", "ICO: video surveillance guidance", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/cctv-and-video-surveillance/", "Guidance on using CCTV and other surveillance lawfully, including impact assessments.", "REGULATOR_GUIDANCE"),
  gdn("GDN-ICO-3", "ico", "ICO: right of access (subject access requests)", "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/", "Guidance on recognising and responding to subject access requests.", "REGULATOR_GUIDANCE"),
  gdn("GDN-NHSE-1", "nhs-england", "NHS England: Accessible Information Standard", "https://www.england.nhs.uk/about/equality/equality-hub/patient-equalities-programme/equality-frameworks-and-information-standards/accessibleinfo/", "Required standard for identifying, recording, flagging, sharing and meeting communication needs; applies to publicly funded adult social care.", "STATUTORY_GUIDANCE"),
  gdn("GDN-NHSE-2", "nhs-england", "NHS England: STOMP (stopping over-medication of people with a learning disability, autism or both)", "https://www.england.nhs.uk/learning-disabilities/improving-health/stomp/", "National programme to reduce inappropriate use of psychotropic medicines.", "BEST_PRACTICE"),
  gdn("GDN-NHSE-3", "nhs-england", "Oliver McGowan Mandatory Training on Learning Disability and Autism", "https://www.hee.nhs.uk/our-work/learning-disability/oliver-mcgowan-mandatory-training-learning-disability-autism", "Standardised training for health and social care staff, required for CQC-registered providers.", "STATUTORY_GUIDANCE"),
  gdn("GDN-NHSE-4", "nhs-england", "NHS England: learning disability annual health checks", "https://www.england.nhs.uk/learning-disabilities/improving-health/annual-health-checks/", "Annual GP health checks and health action plans for people aged 14 and over with a learning disability.", "BEST_PRACTICE"),
  gdn("GDN-NMC-1", "nmc", "NMC: The Code: professional standards of practice and behaviour for nurses, midwives and nursing associates", "https://www.nmc.org.uk/standards/code/", "Professional standards registered nurses must uphold.", "REGULATOR_GUIDANCE"),
  gdn("GDN-NMC-2", "nmc", "NMC: revalidation", "https://www.nmc.org.uk/revalidation/", "Requirements nurses must meet every three years to renew their registration.", "REGULATOR_GUIDANCE"),
  gdn("GDN-FSA-1", "fsa", "Food Standards Agency: Safer food, better business for caterers", "https://www.food.gov.uk/business-guidance/safer-food-better-business-for-caterers", "Food safety management pack based on HACCP principles."),
  gdn("GDN-SCIE-1", "scie", "SCIE: safeguarding adults: types and indicators of abuse", "https://www.scie.org.uk/safeguarding/adults/introduction/types-and-indicators-of-abuse", "Practice guidance describing the types of abuse and signs that may indicate them.", "BEST_PRACTICE"),
  gdn("GDN-RRN-1", "restraint-reduction-network", "Restraint Reduction Network: Training Standards", "https://restraintreductionnetwork.org/training-standards/", "Standards for training in preventing and reducing restrictive practices, required for NHS-commissioned services.", "BEST_PRACTICE"),
];

/**
 * CQC single assessment framework quality statements (titles only, with Evantix
 * summaries). CQC has said it is revising the framework; check the current
 * version before relying on these mappings.
 */
const QS: [code: string, keyQuestion: string, title: string, summary: string][] = [
  ["S1", "Safe", "Learning culture", "A proactive, positive culture of safety based on openness and honesty, in which concerns are listened to and learning leads to improvement."],
  ["S2", "Safe", "Safe systems, pathways and transitions", "Working with people and partners so that care is safe and continuous when people move between services."],
  ["S3", "Safe", "Safeguarding", "Working with people to understand what being safe means to them and protecting them from abuse and neglect."],
  ["S4", "Safe", "Involving people to manage risks", "Working with people to understand and manage risks through thorough, person-centred assessment."],
  ["S5", "Safe", "Safe environments", "Detecting and controlling potential risks in the care environment and keeping equipment, facilities and technology safe."],
  ["S6", "Safe", "Safe and effective staffing", "Enough qualified, skilled and experienced staff who receive effective support, supervision and development."],
  ["S7", "Safe", "Infection prevention and control", "Assessing and managing the risk of infection and sharing concerns with partners."],
  ["S8", "Safe", "Medicines optimisation", "Making sure medicines are safe and effective for each person, involving them in decisions."],
  ["E1", "Effective", "Assessing needs", "Maximising effectiveness by assessing and reviewing people's health, care, wellbeing and communication needs with them."],
  ["E2", "Effective", "Delivering evidence-based care and treatment", "Planning and delivering care in line with legislation and current evidence-based good practice."],
  ["E3", "Effective", "How staff, teams and services work together", "Working with other teams and services to deliver joined-up care."],
  ["E4", "Effective", "Supporting people to live healthier lives", "Supporting people to manage their health and wellbeing and to make healthier choices."],
  ["E5", "Effective", "Monitoring and improving outcomes", "Routinely monitoring people's care and using the information to improve outcomes."],
  ["E6", "Effective", "Consent to care and treatment", "Telling people about their rights around consent and respecting them when delivering care."],
  ["C1", "Caring", "Kindness, compassion and dignity", "Treating people with kindness, compassion and dignity and protecting their privacy."],
  ["C2", "Caring", "Treating people as individuals", "Seeing people as individuals and responding to their needs, preferences and protected characteristics."],
  ["C3", "Caring", "Independence, choice and control", "Promoting people's independence and supporting them to make choices and stay in control."],
  ["C4", "Caring", "Responding to people's immediate needs", "Listening to and understanding people's needs and responding promptly to distress or discomfort."],
  ["C5", "Caring", "Workforce wellbeing and enablement", "Caring about and promoting the wellbeing of staff so they can deliver person-centred care."],
  ["R1", "Responsive", "Person-centred care", "Making sure people are at the centre of their care and their needs are met."],
  ["R2", "Responsive", "Care provision, integration and continuity", "Understanding local needs and delivering care that is flexible and continuous."],
  ["R3", "Responsive", "Providing information", "Providing information people can understand and that meets their communication needs."],
  ["R4", "Responsive", "Listening to and involving people", "Making it easy for people to share feedback and complaints and acting on them."],
  ["R5", "Responsive", "Equity in access", "Making sure everyone can access the care they need when they need it."],
  ["R6", "Responsive", "Equity in experiences and outcomes", "Actively seeking out and addressing inequalities in people's experiences and outcomes."],
  ["R7", "Responsive", "Planning for the future", "Supporting people to plan for important life changes, including the end of their life."],
  ["W1", "Well-led", "Shared direction and culture", "A shared vision, strategy and culture based on transparency, equity and listening."],
  ["W2", "Well-led", "Capable, compassionate and inclusive leaders", "Leaders with the experience, capability and integrity to lead the service well."],
  ["W3", "Well-led", "Freedom to speak up", "A culture in which people and staff can speak up and their concerns are acted on."],
  ["W4", "Well-led", "Workforce equality, diversity and inclusion", "Valuing diversity in the workforce and working towards an inclusive and fair culture."],
  ["W5", "Well-led", "Governance, management and sustainability", "Clear responsibilities, roles and systems of accountability to manage performance and risk."],
  ["W6", "Well-led", "Partnerships and communities", "Working in partnership with people, communities and organisations to improve care."],
  ["W7", "Well-led", "Learning, improvement and innovation", "Focusing on continuous learning, innovation and improvement."],
  ["W8", "Well-led", "Environmental sustainability", "Understanding and reducing the service's impact on the environment."],
];

export const QUALITY_STATEMENTS: Record<string, { keyQuestion: string; title: string; ref: string }> = Object.fromEntries(
  QS.map(([code, keyQuestion, title]) => [code, { keyQuestion, title, ref: `CQC-QS-${code}` }]),
);

for (const [code, keyQuestion, title, summary] of QS) {
  REQUIREMENTS.push({
    ref: `CQC-QS-${code}`,
    title: `${keyQuestion}: ${title}`,
    source: CQC,
    exactReference: `CQC quality statement, ${keyQuestion}: ${title}`,
    url: "https://www.cqc.org.uk/assessment/quality-statements",
    summary,
    legalStatus: "REGULATOR_GUIDANCE",
    applicabilityNotes: "CQC quality statement used in the single assessment framework. CQC has announced revisions to its assessment approach; confirm the current framework before relying on this mapping.",
  });
}

export const REQUIREMENT_BY_REF: Record<string, RequirementDef> = Object.fromEntries(REQUIREMENTS.map((r) => [r.ref, r]));
