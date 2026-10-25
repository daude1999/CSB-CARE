/**
 * Original starter policy templates written for Evantix Care.
 * They are NOT professionally reviewed, legally verified or approved. Providers
 * must adapt and approve them through their own governance before use.
 */

export interface TemplateSection {
  key: string;
  heading: string;
  body: string;
  isLocal?: boolean;
}

export interface TemplateDef {
  ref: string;
  title: string;
  category: string;
  description: string;
  serviceTypes: string[];
  sections: TemplateSection[];
}

const ALL = ["RESIDENTIAL", "NURSING", "DOMICILIARY", "SUPPORTED_LIVING"];

const localContacts = (what: string): TemplateSection => ({
  key: "local.contacts",
  heading: "Local contacts and reporting routes",
  isLocal: true,
  body: `[Complete locally] List the names, roles and telephone numbers your staff should use for ${what}, including out-of-hours arrangements. Evantix never changes this section automatically.`,
});

const review = (months = 12): TemplateSection => ({
  key: "review",
  heading: "Review arrangements",
  body: `This policy is reviewed at least every ${months} months, and sooner if legislation, regulator guidance or our own learning from incidents, complaints or audits indicates a change is needed. The policy owner records each review, including when no change was required.`,
});

function generic(
  ref: string,
  title: string,
  category: string,
  purpose: string,
  statement: string,
  procedure: string,
  extra: Partial<Record<"responsibilities" | "escalation" | "records" | "training" | "monitoring" | "definitions", string>> = {},
  serviceTypes = ALL,
): TemplateDef {
  const sections: TemplateSection[] = [
    { key: "purpose", heading: "Purpose", body: purpose },
    { key: "scope", heading: "Scope", body: "This policy applies to everyone who works for or on behalf of the organisation, including employees, agency workers, volunteers and students, in every service the organisation registers or operates." },
  ];
  if (extra.definitions) sections.push({ key: "definitions", heading: "Definitions", body: extra.definitions });
  sections.push(
    { key: "responsibilities", heading: "Responsibilities", body: extra.responsibilities ?? "The registered manager is accountable for implementing this policy in their service. Senior staff support colleagues to follow it day to day. Every worker is responsible for reading the policy, following it and raising concerns when practice falls short." },
    { key: "statement", heading: "Policy statement", body: statement },
    { key: "procedure", heading: "Procedure", body: procedure },
  );
  if (extra.escalation) sections.push({ key: "escalation", heading: "Escalation and reporting", body: extra.escalation });
  sections.push(localContacts(title.toLowerCase()));
  sections.push(
    { key: "records", heading: "Record keeping", body: extra.records ?? "Records are factual, dated, signed or electronically attributed, and stored securely in line with our data protection and record retention policies." },
    { key: "training", heading: "Training requirements", body: extra.training ?? "Staff receive training on this policy during induction and refresher training at intervals set in the training matrix. Managers check understanding through supervision." },
    { key: "monitoring", heading: "Monitoring and audit", body: extra.monitoring ?? "Compliance with this policy is checked through the internal audit programme, supervision and review of incidents and complaints. Findings lead to recorded actions with named owners and due dates." },
    review(),
  );
  return { ref, title, category, description: `Starter template: ${purpose.split(".")[0]}. Not professionally reviewed; adapt before approval.`, serviceTypes, sections };
}

export const TEMPLATES: TemplateDef[] = [
  {
    ref: "EVX-SAF-001",
    title: "Safeguarding Adults",
    category: "SAFEGUARDING",
    description: "Starter template: how staff recognise, respond to and report concerns that an adult may be experiencing abuse or neglect. Not professionally reviewed; adapt before approval.",
    serviceTypes: ALL,
    sections: [
      { key: "purpose", heading: "Purpose", body: "This policy explains how we protect the people we support from abuse, neglect and exploitation, and what every member of staff must do when they are worried that someone is at risk." },
      { key: "scope", heading: "Scope", body: "It applies to all staff, volunteers and contractors, and covers concerns about people using our services wherever the concern arises, including in their own homes, in our care homes and in the community." },
      { key: "definitions", heading: "Definitions", body: "Abuse can be physical, sexual, psychological or emotional, financial or material, discriminatory, organisational, or take the form of neglect, self-neglect, domestic abuse or modern slavery. A safeguarding concern is any worry that an adult with care and support needs is experiencing, or is at risk of, abuse or neglect and cannot protect themselves." },
      { key: "responsibilities", heading: "Responsibilities", body: "The registered manager is the safeguarding lead for the service and makes sure concerns are referred and followed up. Shift leaders make sure people are safe in the moment and that the manager is informed. Every member of staff must act on concerns without delay and must never investigate allegations themselves." },
      { key: "statement", heading: "Policy statement", body: "We will listen to people, take every concern seriously and put the person's safety, wishes and wellbeing at the centre of our response. We work with the local authority, police and other partners and we share information lawfully when it is necessary to protect someone." },
      { key: "procedure.immediate", heading: "Responding to a concern", body: "Make sure the person is safe and get medical help if they need it. Listen calmly, do not ask leading questions and do not promise to keep secrets. Preserve any evidence. Tell the shift leader or manager straight away." },
      { key: "procedure.reporting", heading: "Reporting a concern", body: "The manager, or the most senior person on duty, must refer the concern to the local authority safeguarding team within 48 hours of becoming aware of it, or immediately if the person is in danger. Where a crime may have been committed, contact the police. Record the referral reference and the outcome of each contact." },
      { key: "procedure.notifications", heading: "Notifying the regulator", body: "The registered manager notifies the Care Quality Commission of abuse or allegations of abuse using the required statutory notification, without delay." },
      localContacts("safeguarding referrals"),
      { key: "records", heading: "Record keeping", body: "Record what was seen or said in the person's own words, the date and time, who was told and what action was taken. Keep safeguarding records secure and share them only with people who need them." },
      { key: "training", heading: "Training requirements", body: "All staff complete safeguarding adults training at induction and refresh it at least every two years. Managers complete additional training on leading safeguarding responses." },
      { key: "monitoring", heading: "Monitoring and audit", body: "The manager reviews all safeguarding concerns monthly to identify themes. The safeguarding practice audit checks that referrals were timely and that actions were completed." },
      review(),
    ],
  },
  {
    ref: "EVX-MED-001",
    title: "Medicines Management",
    category: "MEDICINES",
    description: "Starter template: safe ordering, storage, administration, recording and disposal of medicines. Not professionally reviewed; adapt before approval.",
    serviceTypes: ALL,
    sections: [
      { key: "purpose", heading: "Purpose", body: "This policy sets out how we support people with their medicines safely, respecting their right to manage their own medicines where they are able to." },
      { key: "scope", heading: "Scope", body: "It covers prescribed and over-the-counter medicines, including controlled drugs, homely remedies and medicines given covertly, in all of our services." },
      { key: "responsibilities", heading: "Responsibilities", body: "Only staff who have been trained and assessed as competent may administer medicines. The registered manager makes sure competency assessments are completed and recorded. Staff must report any error or near miss immediately." },
      { key: "statement", heading: "Policy statement", body: "Each person has a medicines care plan describing the support they need. We assess whether people can manage their own medicines and review that assessment when their needs change." },
      { key: "procedure.administration", heading: "Administering medicines", body: "Check the person's identity, the medicine, dose, route and time against the medicines administration record before giving any medicine. Record administration immediately afterwards. Never sign for a medicine you did not see taken." },
      { key: "procedure.storage", heading: "Storage", body: "Store medicines securely at the temperature stated by the manufacturer. Record fridge temperatures daily in care homes. Controlled drugs are stored and recorded in line with the legal requirements for the setting." },
      { key: "procedure.errors", heading: "Medicine errors and near misses", body: "If an error happens, make sure the person is safe and seek advice from a pharmacist, GP or NHS 111. Tell the manager, record the error and complete an incident report." },
      localContacts("medicines advice and pharmacy support"),
      { key: "records", heading: "Record keeping", body: "Medicines administration records are completed accurately at the time of administration and kept for the period set in our record retention schedule." },
      { key: "training", heading: "Training requirements", body: "Staff complete medicines training and a competency assessment before administering medicines, and are reassessed at least annually." },
      { key: "monitoring", heading: "Monitoring and audit", body: "Medicines audits are carried out monthly in care homes and at regular intervals in other services. Findings are recorded as actions." },
      review(),
    ],
  },
  generic(
    "EVX-IPC-001",
    "Infection Prevention and Control",
    "IPC",
    "This policy describes the measures we take to prevent and control infection, protecting the people we support, staff and visitors.",
    "We follow standard infection control precautions at all times and additional precautions when an infection is suspected or confirmed. We keep services clean and make sure staff have the equipment they need.",
    "Clean hands before and after contact with each person. Use personal protective equipment appropriate to the task. Report symptoms of infection in people or staff to the manager, who decides on isolation, cleaning and notification steps. Manage outbreaks in partnership with the local health protection team.",
    { escalation: "Suspected outbreaks are reported to the manager immediately and to the local health protection team as required." },
  ),
  generic(
    "EVX-COM-001",
    "Complaints",
    "COMPLAINTS",
    "This policy explains how people, families and representatives can raise a complaint and how we respond.",
    "We welcome complaints as a way to improve. Nobody will be treated less favourably for making a complaint. We aim to resolve concerns quickly and fairly.",
    "Acknowledge each complaint within three working days. Agree with the complainant how it will be handled and when they can expect a response. Investigate fairly, respond in writing with the outcome and explain how to take the complaint further, including to the Local Government and Social Care Ombudsman where applicable.",
  ),
  generic(
    "EVX-INC-001",
    "Incident Reporting",
    "INCIDENTS",
    "This policy sets out how incidents, accidents and near misses are reported, investigated and learned from.",
    "Every incident and near miss is reported so that we can keep people safe and learn. We operate an open, fair culture in which staff are supported to report.",
    "Make the situation safe and get help. Report the incident to the person in charge and record it on the incident system the same day. The manager reviews each incident, decides whether external notifications are needed and records actions taken.",
    { escalation: "The registered manager decides whether a statutory notification, safeguarding referral or RIDDOR report is required." },
  ),
  generic(
    "EVX-MCA-001",
    "Mental Capacity and Consent",
    "CONSENT",
    "This policy explains how we seek consent and support people to make their own decisions, and what we do when someone may lack capacity to make a specific decision.",
    "We assume people have capacity unless it is established that they do not. We give people all practicable support to make their own decisions and respect unwise decisions.",
    "Seek consent before providing care. Where there is reason to doubt someone's capacity for a specific decision, carry out and record a capacity assessment. Decisions made for a person who lacks capacity are made in their best interests and are the least restrictive option.",
  ),
  generic(
    "EVX-DOC-001",
    "Duty of Candour",
    "CANDOUR",
    "This policy describes how we are open and honest with people when things go wrong with their care.",
    "We are open with people about mistakes and incidents, we apologise and we explain what we are doing to put things right.",
    "When a notifiable safety incident occurs, tell the person or their representative as soon as reasonably practicable, apologise, provide the facts known at the time and follow this up in writing. Keep a record of all communications.",
  ),
  generic(
    "EVX-REC-001",
    "Recruitment and Staff Suitability",
    "RECRUITMENT",
    "This policy describes how we recruit safely and check that staff are suitable for their roles.",
    "We only employ people who have the qualifications, competence, skills and experience for their role and who are of good character.",
    "Obtain a full employment history and explain any gaps, references, proof of identity and right to work, and an appropriate Disclosure and Barring Service check before a new worker starts. Record recruitment decisions.",
  ),
  generic(
    "EVX-TRN-001",
    "Training and Staff Competence",
    "TRAINING",
    "This policy describes how we make sure staff have the training and competence to provide safe, effective care.",
    "Every role has defined training requirements. Staff do not carry out tasks they have not been trained and assessed to do.",
    "New staff complete an induction appropriate to their role. Training is tracked in the training matrix and refreshed when due. Supervisors observe practice and record competency assessments.",
  ),
  generic(
    "EVX-HS-001",
    "Health and Safety",
    "HEALTH_SAFETY",
    "This policy sets out how we manage health and safety risks for the people we support, staff and visitors.",
    "We identify hazards, assess risks and put proportionate controls in place. Staff must follow safe systems of work and report hazards.",
    "Carry out and review risk assessments for premises, work activities and individuals. Maintain equipment and keep test and inspection records. Report accidents and dangerous occurrences.",
  ),
  generic(
    "EVX-WB-001",
    "Whistleblowing and Speaking Up",
    "WHISTLEBLOWING",
    "This policy encourages staff to speak up about wrongdoing or poor practice and explains how concerns are handled.",
    "Staff who raise concerns in good faith will be supported and will not suffer detriment for doing so.",
    "Raise concerns with a line manager, a senior manager or the nominated individual. If that is not appropriate, staff can raise concerns with an external prescribed body. Concerns are acknowledged, investigated and the outcome is shared where possible.",
  ),
  generic(
    "EVX-DP-001",
    "Data Protection and Confidentiality",
    "DATA_PROTECTION",
    "This policy explains how we protect personal information and respect confidentiality.",
    "We process personal data lawfully, fairly and transparently, and only for the purposes we have explained. Special category data such as health information is handled with additional care.",
    "Access records only when needed for your role. Keep devices and paper records secure. Report actual or suspected data breaches to the manager immediately so they can be assessed and, where required, reported within the statutory time limit.",
  ),
  generic(
    "EVX-GOV-001",
    "Governance and Quality Assurance",
    "GOVERNANCE",
    "This policy describes how leaders monitor and improve the quality and safety of our services.",
    "We use audits, feedback, incident data and outcomes to understand quality and to drive improvement. Platform scores support, but never replace, professional judgement.",
    "Run the audit schedule, review results at governance meetings, record actions with owners and due dates, and check that actions are completed and effective.",
  ),
  generic(
    "EVX-RISK-001",
    "Risk Management",
    "RISK",
    "This policy describes how risks to people and to the organisation are identified, assessed and managed.",
    "We support positive risk-taking that respects people's choices while keeping them as safe as reasonably possible.",
    "Assess individual risks with the person, record agreed measures in their care plan and review them when circumstances change. Organisational risks are recorded on the risk register and reviewed by managers.",
  ),
  generic(
    "EVX-RK-001",
    "Record Keeping",
    "RECORDS",
    "This policy sets out how care records and other records are created, stored, retained and disposed of.",
    "Records are accurate, complete, contemporaneous and accessible to those who need them.",
    "Write records at the time or as soon as possible afterwards. Correct errors transparently without obscuring the original entry. Retain records for the periods in the retention schedule and dispose of them securely.",
  ),
  generic(
    "EVX-EQ-001",
    "Equality, Diversity and Human Rights",
    "EQUALITY",
    "This policy describes how we promote equality, respect diversity and uphold people's human rights.",
    "We treat everyone with dignity and respect and do not discriminate. We make reasonable adjustments and meet people's communication needs.",
    "Record people's communication needs and preferences in their care plan. Challenge discriminatory behaviour. Monitor complaints and feedback for equality themes.",
  ),
];
