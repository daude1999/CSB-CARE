/** The policy library's top-level areas: each groups related categories, shown as one tab on the My Policies page. */
export const POLICY_AREAS = [
  { key: "governance", label: "Governance", categories: ["GOVERNANCE", "RISK", "RECORDS", "COMPLAINTS", "CANDOUR", "WHISTLEBLOWING", "EQUALITY"] },
  { key: "safeguarding", label: "Safeguarding", categories: ["SAFEGUARDING", "CONSENT", "INCIDENTS"] },
  { key: "care", label: "Care Planning", categories: ["CARE", "END_OF_LIFE", "FOOD", "WELLBEING"] },
  { key: "clinical", label: "Clinical Care", categories: ["CLINICAL", "IPC", "MENTAL_HEALTH"] },
  { key: "medicines", label: "Medicines", categories: ["MEDICINES"] },
  { key: "health-safety", label: "Health and Safety", categories: ["HEALTH_SAFETY"] },
  { key: "people", label: "Human Resources", categories: ["WORKFORCE", "RECRUITMENT", "TRAINING"] },
  { key: "information", label: "Information", categories: ["DATA_PROTECTION"] },
  { key: "services", label: "Service Types", categories: ["CARE_HOMES", "HOME_CARE", "SUPPORTED_LIVING", "LEARNING_DISABILITY", "DEMENTIA"] },
] as const;

export type PolicyAreaKey = (typeof POLICY_AREAS)[number]["key"];
