/**
 * Registered manager interview preparation. Original CSB questions and model answers, based on
 * the public CQC regulations, quality statements and registration guidance. Model answers are
 * a starting point: a strong answer always uses the manager's own service and real examples.
 */

export type InterviewTopic = { key: string; subject: string; questions: { q: string; a: string }[]; policies: string[] };

export const INTERVIEW: InterviewTopic[] = [
  {
    key: "activities",
    subject: "Regulated activities and your service",
    policies: ["CSB-GOV-005"],
    questions: [
      { q: "Which regulated activities will {{company_name}} carry on, and why those?", a: "Name each activity exactly as registered (for example personal care) and link it to what you actually do. Explain who you support, where, and the needs you will and will not meet. Show you know that starting a different activity, such as nursing care, needs a change to registration first." },
      { q: "What is the difference between your role and the nominated individual's?", a: "The registered manager runs the regulated activity day to day and is legally accountable for the quality and safety of care at the location. The nominated individual ({{nominated_individual}}) represents the provider and supervises how the activity is managed. Explain how you meet, what you report and how disagreements are escalated." },
    ],
  },
  {
    key: "sop",
    subject: "Statement of purpose",
    policies: ["CSB-TPL-005", "CSB-GOV-005"],
    questions: [
      { q: "What is a statement of purpose, and can you talk me through yours?", a: "It is a legal document describing the provider, the regulated activities, the people the service is for, where it is delivered and its aims. Summarise yours in your own words without reading it, and explain how it shapes what you will and will not accept as a referral." },
      { q: "When would you update it?", a: "Whenever something it describes changes, such as the people you support, services offered, locations or key contacts. You send CQC the updated version within 28 days of the change, and keep a dated copy on file." },
    ],
  },
  {
    key: "kloe",
    subject: "Key questions and quality statements",
    policies: ["CSB-GOV-001"],
    questions: [
      { q: "What are CQC's five key questions? Give an example of how you would evidence each.", a: "Safe, effective, caring, responsive and well-led. Give one concrete example for each: safe through risk assessments and safeguarding training; effective through assessment and MCA-compliant consent; caring through feedback and observation of dignity; responsive through person-centred care plans and complaint learning; well-led through audits, action plans and staff meetings." },
      { q: "How will you know whether you are meeting the quality statements day to day?", a: "Describe your governance cycle: a schedule of audits, monthly review of incidents, complaints and feedback, an action plan with owners and dates, and a regular report to the provider. Mention how you use a requirements register or policy system to keep track." },
    ],
  },
  {
    key: "notifications",
    subject: "Statutory notifications",
    policies: ["CSB-INC-002"],
    questions: [
      { q: "What must {{company_name}} tell CQC about, and how quickly?", a: "Deaths of people using the service, serious injuries, abuse or allegations of abuse, incidents reported to or investigated by the police, events that stop the service running safely, and Deprivation of Liberty applications and outcomes for care homes. Notifications are sent without delay. Give one example of each from your experience." },
      { q: "Who sends notifications if you are on leave?", a: "Name the deputy who has access and has been shown how. Explain how you check afterwards that nothing was missed, for example by reviewing the incident log against the notifications sent." },
    ],
  },
  {
    key: "safeguarding",
    subject: "Safeguarding adults",
    policies: ["CSB-SAF-001", "CSB-SAF-002"],
    questions: [
      { q: "A carer tells you a person has unexplained bruising. What happens next?", a: "Make sure the person is safe and gets medical attention if needed. Record what was seen and said, with a body map. Speak with the person about what they want. Refer to the local authority safeguarding team at {{local_authority}} and contact the police if a crime may have happened. Notify CQC, and follow up on the outcome and learning." },
      { q: "How do you know your team would recognise and report abuse?", a: "Training at induction and refreshers, checks in supervision, scenario questions in team meetings, a visible reporting flowchart with contact numbers, and audits of how concerns were handled. Staff also know they can whistleblow to the local authority or CQC." },
    ],
  },
  {
    key: "mca",
    subject: "Mental Capacity Act and deprivation of liberty",
    policies: ["CSB-MCA-001", "CSB-MCA-002"],
    questions: [
      { q: "Tell me about the five principles of the Mental Capacity Act.", a: "Assume capacity unless proven otherwise; give all practicable help before deciding someone lacks capacity; an unwise decision does not mean a lack of capacity; anything done for someone who lacks capacity must be in their best interests; and choose the option that is least restrictive of their rights and freedom." },
      { q: "When would you need authorisation to deprive someone of their liberty?", a: "When a person who lacks capacity to consent to their care arrangements is under continuous supervision and control and is not free to leave. In a care home you apply to the local authority under the Deprivation of Liberty Safeguards. In the community the route is through the Court of Protection, usually led by the commissioner." },
    ],
  },
  {
    key: "recruitment",
    subject: "Recruitment and DBS",
    policies: ["CSB-REC-001", "CSB-CHK-002"],
    questions: [
      { q: "Talk me through the checks you complete before someone starts work.", a: "Application with full employment history and explanations for gaps, interview, two references including the most recent care employer, enhanced DBS with adult barred list, right to work, identity, health declaration and proof of qualifications. Show the file checklist you use and who signs it off." },
      { q: "A DBS check comes back with a conviction. What do you do?", a: "Do not decide automatically. Discuss it with the applicant, consider the nature, relevance and age of the offence and the role, and record a risk assessment and decision signed by a senior manager. If in doubt, take advice. A barred person must never work in regulated activity." },
    ],
  },
  {
    key: "training",
    subject: "Staffing, training and supervision",
    policies: ["CSB-TRN-001", "CSB-TRN-002", "CSB-GOV-002"],
    questions: [
      { q: "How will you decide how many staff you need?", a: "Use each person's assessed needs and dependency, the layout or travel time, and times of day when demand peaks. Explain how you review it when needs change, and what you do when staff call in sick." },
      { q: "How will you make sure staff are competent, not just trained?", a: "Induction against the Care Certificate standards, shadow shifts, observed competency checks for tasks like medicines and moving and handling, a training matrix showing when refreshers are due, and regular supervision and appraisal." },
    ],
  },
  {
    key: "medicines",
    subject: "Medicines",
    policies: ["CSB-MED-001", "CSB-MED-004"],
    questions: [
      { q: "How will you keep medicines safe?", a: "A medicines policy, trained and competency-assessed staff, accurate medicines administration records, safe storage, clear protocols for when-required medicines, monthly audits and a no-blame approach to reporting errors so you can learn from them." },
      { q: "What would you do after a medicines error?", a: "Check the person is safe and get clinical advice. Record and report it, tell the person or family under the duty of candour where harm occurred, investigate the cause, support and retrain the staff member, and share the learning." },
    ],
  },
  {
    key: "complaints",
    subject: "Complaints and duty of candour",
    policies: ["CSB-COM-001", "CSB-DOC-001"],
    questions: [
      { q: "How do people raise a complaint, and what happens to it?", a: "Explain the accessible ways people can complain, your acknowledgement and response timescales, how you investigate fairly and how you tell people about the Local Government and Social Care Ombudsman if they are unhappy with the outcome. Show how learning from complaints changes practice." },
      { q: "What does the duty of candour mean in practice?", a: "When a notifiable safety incident happens, tell the person or their representative as soon as reasonably possible, apologise, explain what you know, offer support, follow up in writing and keep records. It sits within a wider culture of being open whenever things go wrong." },
    ],
  },
  {
    key: "governance",
    subject: "Leadership and governance",
    policies: ["CSB-GOV-001", "CSB-GOV-007"],
    questions: [
      { q: "How will you know the quality of care is good when you are not there?", a: "Spot checks, including out of hours, feedback from people and families, call monitoring or daily records review, audit results, and staff who feel able to tell you about problems. Describe how findings become actions that are followed through." },
      { q: "How do you create an open culture?", a: "Lead by example, act on concerns quickly and visibly, thank staff for raising issues, hold regular team meetings, publicise whistleblowing routes and make learning from incidents about systems, not blame." },
    ],
  },
  {
    key: "person-centred",
    subject: "Person-centred care and equality",
    policies: ["CSB-CP-001", "CSB-EQ-001"],
    questions: [
      { q: "How do you involve people in planning their care?", a: "Assess with the person and the people who matter to them, record what is important to them in their own words, agree goals together and review regularly. Use accessible formats and advocates where needed." },
      { q: "How do you meet people's protected characteristics and cultural needs?", a: "Ask about them during assessment, reflect them in care plans (such as food, faith, language, gender of carer), train staff in equality and challenge discrimination. Give an example of a reasonable adjustment you have made." },
    ],
  },
];
