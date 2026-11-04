/**
 * CSB's management checklist for CQC readiness, version 1. Original CSB wording.
 *
 * Each assessment area is one of the owner's checklist topics (spec of 4 Nov 2026, section 5), filed under one of
 * CQC's five key questions and mapped to:
 *   - the title of the CQC Single Assessment Framework quality statement it most relates to, and
 *   - the regulations of the Health and Social Care Act 2008 (Regulated Activities) Regulations 2014 (and, for
 *     notifications, the Care Quality Commission (Registration) Regulations 2009) it most relates to.
 *
 * The mapping is a management aid, not CQC's own text. Only quality statement titles are used; CQC's "we statements"
 * and guidance are not copied. CQC published draft replacement frameworks in 2026, so this version records where it
 * came from and is replaced by a new version (new rows), never edited in place, when CQC's framework changes.
 * Check the mapping against https://www.cqc.org.uk/assessment before relying on it.
 */
export type CqcKq = "SAFE" | "EFFECTIVE" | "CARING" | "RESPONSIVE" | "WELL_LED";
export interface CriterionSeed {
  code: string;
  keyQuestion: CqcKq;
  title: string;
  qualityStatement: string;
  regulations: string[];
  guidance: string;
  evidenceExamples: string[];
  keywords: string[];
  discoveryKinds: string[];
  essential: boolean;
}

export const CQC_FRAMEWORK_V1 = {
  version: "CSB-SAF-1.0",
  title: "CSB readiness checklist mapped to the CQC Single Assessment Framework",
  basis:
    "CSB's own assessment areas, mapped by CSB to the titles of the 34 quality statements in CQC's Single Assessment Framework and to the 2014 Regulated Activities Regulations. Not CQC text, and not checked by CQC.",
  sourceUrl: "https://www.cqc.org.uk/assessment",
  notes:
    "CQC published draft replacement assessment frameworks in 2026. When CQC confirms a new framework, add it as a new version; assessments already done keep the version they used.",
  effectiveFrom: "2026-11-01",
};

const R = {
  r9: "Reg 9 Person-centred care",
  r10: "Reg 10 Dignity and respect",
  r11: "Reg 11 Need for consent",
  r12: "Reg 12 Safe care and treatment",
  r13: "Reg 13 Safeguarding",
  r14: "Reg 14 Nutrition and hydration",
  r15: "Reg 15 Premises and equipment",
  r16: "Reg 16 Complaints",
  r17: "Reg 17 Good governance",
  r18: "Reg 18 Staffing",
  r19: "Reg 19 Fit and proper persons employed",
  r20: "Reg 20 Duty of candour",
  n18: "Registration Reg 18 Notification of other incidents",
};

type Row = [code: string, title: string, qs: string, regs: string[], guidance: string, examples: string[], keywords: string[], kinds: string[], essential?: boolean];

const SAFE: Row[] = [
  ["S01", "Safeguarding", "Safeguarding", [R.r13, R.r12], "Concerns are recognised, reported and followed through, with referrals made where needed and lessons shared.", ["Safeguarding policy", "Safeguarding training records", "Safeguarding concern log and referrals"], ["safeguard", "abuse", "neglect"], ["POLICY", "TRAINING", "INCIDENT", "RCA", "EVIDENCE_DOCUMENT", "AUDIT"], true],
  ["S02", "Risk assessments", "Involving people to manage risks", [R.r12], "Each person's risks are assessed, kept under review and reflected in how care is given.", ["Current risk assessments", "Risk assessment review dates"], ["risk assessment", "risk"], ["CARE_PLAN", "AUDIT", "POLICY", "EVIDENCE_DOCUMENT"], true],
  ["S03", "Medication management and MAR/eMAR", "Medicines optimisation", [R.r12], "Medicines support is planned, recorded on MAR and checked, and errors are reported and learned from.", ["Medication policy", "MAR audits", "Medication training and competency checks"], ["medication", "medicine", "mar"], ["POLICY", "TRAINING", "AUDIT", "INCIDENT", "RCA", "EVIDENCE_DOCUMENT"], true],
  ["S04", "Incidents and accidents", "Learning culture", [R.r12, R.r17, R.r20], "Incidents are reported, investigated in proportion to their seriousness and closed with an outcome.", ["Incident log", "Incident investigations", "Duty of candour records"], ["incident", "accident"], ["INCIDENT", "RCA", "POLICY", "EVIDENCE_DOCUMENT"]],
  ["S05", "Infection prevention and control", "Infection prevention and control", [R.r12], "Staff follow infection control practice and have the training and equipment to do so.", ["IPC policy", "IPC training", "Spot checks"], ["infection", "ipc", "hygiene", "ppe"], ["POLICY", "TRAINING", "AUDIT", "EVIDENCE_DOCUMENT"]],
  ["S06", "Recruitment, DBS and safer staffing", "Safe and effective staffing", [R.r18, R.r19], "Staff are recruited safely, with DBS and reference checks completed before they work alone.", ["Recruitment file audits", "DBS records", "References"], ["recruit", "dbs", "reference", "right to work"], ["POLICY", "AUDIT", "EVIDENCE_DOCUMENT"], true],
  ["S07", "Training and competency", "Safe and effective staffing", [R.r18], "Staff have current mandatory training and are assessed as competent for the tasks they do.", ["Training matrix", "Competency assessments"], ["training", "competen"], ["TRAINING", "AUDIT", "EVIDENCE_DOCUMENT"], true],
  ["S08", "Missed visits and electronic call monitoring", "Safe systems, pathways and transitions", [R.r12, R.r17], "Late and missed visits are spotted quickly, covered, investigated and learned from.", ["Missed call investigations", "Call monitoring reports"], ["missed", "late call", "call monitoring"], ["MISSED_CALL", "RCA", "INCIDENT", "EVIDENCE_DOCUMENT"], true],
  ["S09", "Moving and handling", "Safe environments", [R.r12, R.r15], "Moving and handling needs are assessed, equipment is safe and staff are trained to use it.", ["Moving and handling risk assessments", "Equipment checks", "Training records"], ["moving and handling", "manual handling", "hoist"], ["TRAINING", "POLICY", "AUDIT", "EVIDENCE_DOCUMENT"]],
  ["S10", "Health and safety", "Safe environments", [R.r12, R.r15], "Home environment and lone-working risks are assessed and acted on.", ["Health and safety policy", "Environmental risk assessments", "Lone working arrangements"], ["health and safety", "lone work", "environment"], ["POLICY", "AUDIT", "EVIDENCE_DOCUMENT"]],
  ["S11", "Emergency preparedness", "Safe systems, pathways and transitions", [R.r12, R.r17], "There is a tested plan for emergencies and service disruption, including on-call cover.", ["Business continuity plan", "On-call rota", "Emergency contact lists"], ["business continuity", "emergency", "on-call", "contingency"], ["POLICY", "EVIDENCE_DOCUMENT", "ACTION"]],
  ["S12", "Learning from incidents", "Learning culture", [R.r17, R.r20], "Investigations find causes, actions are taken and checked, and lessons reach staff.", ["Root cause analyses", "Lessons learned briefings", "Verified improvement actions"], ["lesson", "learning", "root cause"], ["RCA", "ACTION", "EVIDENCE_DOCUMENT"], true],
];
const EFFECTIVE: Row[] = [
  ["E01", "Assessment of care needs", "Assessing needs", [R.r9], "Needs are assessed before care starts and reassessed when they change.", ["Initial assessments", "Reassessments"], ["assessment of needs", "needs assessment", "pre-assessment"], ["CARE_PLAN", "AUDIT", "EVIDENCE_DOCUMENT"], true],
  ["E02", "Personalised care planning", "Delivering evidence-based care and treatment", [R.r9], "Care plans say what matters to the person and how support is given.", ["Approved care plans", "Care plan audits"], ["care plan"], ["CARE_PLAN", "AUDIT", "POLICY"], true],
  ["E03", "Consent and Mental Capacity Act", "Consent to care and treatment", [R.r11], "Consent is sought and recorded; capacity assessments and best interests decisions follow the Act.", ["Consent records", "Capacity assessments", "MCA training"], ["consent", "capacity", "mca", "best interest"], ["POLICY", "TRAINING", "AUDIT", "EVIDENCE_DOCUMENT"], true],
  ["E04", "Staff training and competency", "How staff, teams and services work together", [R.r18], "Training is planned around the people supported and refreshed when due.", ["Training plan", "Induction records"], ["training", "induction", "care certificate"], ["TRAINING", "EVIDENCE_DOCUMENT"]],
  ["E05", "Nutrition and hydration", "Supporting people to live healthier lives", [R.r14], "Eating and drinking needs and risks are known, supported and recorded.", ["Nutrition risk assessments", "Food and fluid records"], ["nutrition", "hydration", "fluid", "diet"], ["CARE_PLAN", "POLICY", "TRAINING", "EVIDENCE_DOCUMENT"]],
  ["E06", "Healthcare professional involvement", "How staff, teams and services work together", [R.r9, R.r12], "Staff involve GPs, district nurses and other professionals promptly and act on their advice.", ["Referral records", "Professional visit notes"], ["gp", "district nurse", "professional", "referral"], ["EVIDENCE_DOCUMENT", "INCIDENT"]],
  ["E07", "Care reviews and outcomes", "Monitoring and improving outcomes", [R.r9, R.r17], "Care is reviewed on time and outcomes for the person are checked.", ["Care plan reviews", "Review schedule"], ["review", "outcome"], ["CARE_PLAN", "AUDIT"]],
  ["E08", "Equality and accessibility", "Assessing needs", [R.r9, R.r10], "Protected characteristics and access needs are considered in assessment and planning.", ["Equality policy", "Accessible information records"], ["equality", "diversity", "accessib"], ["POLICY", "TRAINING", "EVIDENCE_DOCUMENT"]],
  ["E09", "Communication needs", "Assessing needs", [R.r9], "How each person communicates is recorded and staff follow it.", ["Communication profiles", "Interpreter arrangements"], ["communication", "interpreter", "language"], ["CARE_PLAN", "POLICY", "EVIDENCE_DOCUMENT"]],
];
const CARING: Row[] = [
  ["C01", "Dignity and respect", "Kindness, compassion and dignity", [R.r10], "People are treated with dignity and respect in every visit.", ["Feedback", "Spot checks", "Dignity training"], ["dignity", "respect"], ["POLICY", "TRAINING", "AUDIT", "EVIDENCE_DOCUMENT"], true],
  ["C02", "Privacy and confidentiality", "Kindness, compassion and dignity", [R.r10, R.r17], "Personal information and privacy are protected.", ["Data protection policy", "Confidentiality training", "Breach log"], ["privacy", "confidential", "data protection", "gdpr"], ["POLICY", "TRAINING", "EVIDENCE_DOCUMENT"]],
  ["C03", "Independence", "Independence, choice and control", [R.r9, R.r10], "Support helps people do what they can for themselves.", ["Care plans with goals", "Reablement notes"], ["independen", "reablement"], ["CARE_PLAN", "EVIDENCE_DOCUMENT"]],
  ["C04", "Choice and personal preferences", "Independence, choice and control", [R.r9], "Preferences about care, times and carers are recorded and respected.", ["Preferences in care plans", "Carer preference records"], ["preference", "choice"], ["CARE_PLAN", "EVIDENCE_DOCUMENT"]],
  ["C05", "Cultural and religious preferences", "Treating people as individuals", [R.r9, R.r10], "Culture, faith and identity are understood and supported.", ["Care plans", "Staff matching records"], ["cultur", "religio", "faith"], ["CARE_PLAN", "TRAINING", "EVIDENCE_DOCUMENT"]],
  ["C06", "Compassionate care", "Kindness, compassion and dignity", [R.r10], "Staff are kind, patient and take time with people.", ["Compliments", "Observations of practice"], ["compassion", "compliment", "observation"], ["AUDIT", "EVIDENCE_DOCUMENT"]],
  ["C07", "Service-user and family feedback", "Treating people as individuals", [R.r17], "Feedback is sought regularly and acted on.", ["Surveys", "Review meeting notes"], ["feedback", "survey", "questionnaire"], ["EVIDENCE_DOCUMENT", "AUDIT"]],
  ["C08", "Advocacy", "Independence, choice and control", [R.r9, R.r11], "People who need an advocate are helped to get one.", ["Advocacy referrals", "Advocacy information"], ["advoca"], ["POLICY", "EVIDENCE_DOCUMENT"]],
  ["C09", "Involvement in decisions", "Independence, choice and control", [R.r9], "People and those important to them are involved in decisions about their care.", ["Signed care plans", "Review attendance"], ["involve", "decision"], ["CARE_PLAN", "EVIDENCE_DOCUMENT"]],
];
const RESPONSIVE: Row[] = [
  ["R01", "Personalised care", "Person-centred care", [R.r9], "Care is planned around the person, not the rota.", ["Person-centred care plans"], ["person-centred", "personalised"], ["CARE_PLAN", "POLICY"], true],
  ["R02", "Changing care needs", "Person-centred care", [R.r9, R.r12], "Changes in need are noticed and the plan and rota are updated.", ["Change of need records", "Updated care plans"], ["change", "deteriorat"], ["CARE_PLAN", "INCIDENT", "EVIDENCE_DOCUMENT"]],
  ["R03", "Care plan reviews", "Person-centred care", [R.r9, R.r17], "Care plans are reviewed on schedule and after significant events.", ["Review dates met", "Care plan review records"], ["care plan review", "review"], ["CARE_PLAN", "AUDIT"], true],
  ["R04", "Complaints", "Listening to and involving people", [R.r16], "Complaints are logged, investigated, answered in time and learned from.", ["Complaints policy", "Complaints log", "Responses"], ["complaint"], ["POLICY", "INCIDENT", "RCA", "EVIDENCE_DOCUMENT"], true],
  ["R05", "Compliments and feedback", "Listening to and involving people", [R.r17], "Compliments and feedback are recorded and shared with staff.", ["Compliments log"], ["compliment", "feedback"], ["EVIDENCE_DOCUMENT"]],
  ["R06", "Continuity of care", "Care provision, integration and continuity", [R.r9, R.r12], "People see familiar carers wherever possible.", ["Continuity reports", "Rota records"], ["continuity", "consistent carer"], ["EVIDENCE_DOCUMENT", "AUDIT"]],
  ["R07", "Reliability of visits", "Care provision, integration and continuity", [R.r12, R.r17], "Visits happen on time and for the planned length.", ["Call monitoring", "Missed and late call investigations"], ["late", "missed", "punctual"], ["MISSED_CALL", "RCA", "EVIDENCE_DOCUMENT"], true],
  ["R08", "Communication with service users and families", "Providing information", [R.r9], "People and families are kept informed, including about changes and problems.", ["Contact records", "Communication logs"], ["communicat", "inform", "family"], ["EVIDENCE_DOCUMENT", "MISSED_CALL"]],
  ["R09", "Accessible information", "Providing information", [R.r9], "Information is given in a format each person can use.", ["Accessible Information Standard records", "Easy read documents"], ["accessible information", "easy read", "large print"], ["POLICY", "EVIDENCE_DOCUMENT"]],
  ["R10", "Responsiveness to concerns", "Listening to and involving people", [R.r16, R.r17], "Concerns raised informally are logged and acted on.", ["Concern log", "Actions taken"], ["concern"], ["INCIDENT", "ACTION", "EVIDENCE_DOCUMENT"]],
  ["R11", "End-of-life care (where applicable)", "Planning for the future", [R.r9], "Wishes for the end of life are discussed, recorded and followed.", ["Advance care plans", "End-of-life training"], ["end of life", "advance care", "palliative"], ["CARE_PLAN", "TRAINING", "POLICY", "EVIDENCE_DOCUMENT"]],
];
const WELL_LED: Row[] = [
  ["W01", "Governance and accountability", "Governance, management and sustainability", [R.r17], "Roles, responsibilities and reporting lines are clear and work.", ["Governance framework", "Board or management reports"], ["governance", "accountab"], ["POLICY", "EVIDENCE_DOCUMENT", "AUDIT"], true],
  ["W02", "Leadership oversight", "Capable, compassionate and inclusive leaders", [R.r17], "Leaders know what is happening in the service and act on it.", ["Management reports", "Manager spot checks"], ["leadership", "oversight", "manager"], ["AUDIT", "EVIDENCE_DOCUMENT"]],
  ["W03", "Organisational culture", "Shared direction and culture", [R.r17], "Staff understand the service's values and feel able to speak up.", ["Values statement", "Staff survey", "Speak-up policy"], ["culture", "values", "speak up", "whistleblow"], ["POLICY", "EVIDENCE_DOCUMENT"]],
  ["W04", "Policy management", "Governance, management and sustainability", [R.r17], "Policies are current, approved and read by the staff they apply to.", ["Policy register", "Staff sign-off records"], ["policy"], ["POLICY"], true],
  ["W05", "Internal audits", "Governance, management and sustainability", [R.r17], "There is a programme of audits and findings are followed through.", ["Audit schedule", "Completed audits", "Action plans"], ["audit"], ["AUDIT", "ACTION"], true],
  ["W06", "Quality assurance", "Learning, improvement and innovation", [R.r17], "Quality is monitored and used to improve the service.", ["Quality reports", "Spot checks"], ["quality"], ["AUDIT", "EVIDENCE_DOCUMENT"]],
  ["W07", "Risk management", "Governance, management and sustainability", [R.r17], "Organisational risks are recorded, owned, reviewed and reduced.", ["Risk register", "Risk reviews"], ["risk register", "risk"], ["ACTION", "EVIDENCE_DOCUMENT"], true],
  ["W08", "Incident learning", "Learning, improvement and innovation", [R.r17, R.r20], "Trends in incidents are reviewed and lessons acted on.", ["Incident trend reviews", "RCA reports"], ["incident", "trend", "lesson"], ["RCA", "INCIDENT", "EVIDENCE_DOCUMENT"]],
  ["W09", "Complaints and improvement trends", "Learning, improvement and innovation", [R.r16, R.r17], "Complaint themes are reviewed and lead to change.", ["Complaints analysis", "Improvement plans"], ["complaint", "trend"], ["INCIDENT", "RCA", "ACTION", "EVIDENCE_DOCUMENT"]],
  ["W10", "Staff supervision and development", "Capable, compassionate and inclusive leaders", [R.r18], "Staff receive regular supervision and appraisal.", ["Supervision records", "Appraisals"], ["supervision", "appraisal"], ["TRAINING", "EVIDENCE_DOCUMENT"]],
  ["W11", "Workforce feedback", "Freedom to speak up", [R.r17], "Staff views are sought and acted on.", ["Staff surveys", "Team meeting minutes"], ["staff survey", "staff feedback", "team meeting"], ["EVIDENCE_DOCUMENT"]],
  ["W12", "Management meetings", "Governance, management and sustainability", [R.r17], "Regular management meetings review quality, risk and performance, with minutes and actions.", ["Meeting minutes", "Action logs"], ["minutes", "meeting"], ["EVIDENCE_DOCUMENT", "ACTION"]],
  ["W13", "Regulatory compliance", "Governance, management and sustainability", [R.r17, R.n18], "Notifications are made when required and regulatory changes are acted on.", ["Notification log", "Regulatory update decisions"], ["notification", "regulat"], ["POLICY", "EVIDENCE_DOCUMENT", "RCA"], true],
  ["W14", "Service improvement", "Learning, improvement and innovation", [R.r17], "There is a live improvement plan and progress is tracked.", ["Improvement plan", "Verified actions"], ["improvement"], ["ACTION", "EVIDENCE_DOCUMENT"]],
  ["W15", "Lessons learned from RCA investigations", "Learning, improvement and innovation", [R.r17, R.r20], "Root cause analyses lead to actions whose effect is checked.", ["Closed RCAs with effectiveness reviews"], ["root cause", "lesson"], ["RCA", "ACTION"], true],
];

const build = (kq: CqcKq, rows: Row[]): CriterionSeed[] =>
  rows.map(([code, title, qs, regs, guidance, examples, keywords, kinds, essential]) => ({ code, keyQuestion: kq, title, qualityStatement: qs, regulations: regs, guidance, evidenceExamples: examples, keywords, discoveryKinds: kinds, essential: essential ?? false }));

export const CQC_CRITERIA_V1: CriterionSeed[] = [...build("SAFE", SAFE), ...build("EFFECTIVE", EFFECTIVE), ...build("CARING", CARING), ...build("RESPONSIVE", RESPONSIVE), ...build("WELL_LED", WELL_LED)];
