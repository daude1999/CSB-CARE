/**
 * Original starter policy templates written for CSB.
 * They are NOT professionally reviewed, legally verified or approved. Providers
 * must adapt and approve them through their own governance before use.
 *
 * The content lives in ./library, one file per domain.
 */
import { buildTemplates } from "./library/build";
import { SAFEGUARDING } from "./library/safeguarding";
import { MEDICINES } from "./library/medicines";
import { IPC } from "./library/ipc";
import { CARE } from "./library/care";
import { CLINICAL } from "./library/clinical";
import { CONSENT_EOL } from "./library/consent-eol";
import { GOVERNANCE } from "./library/governance";
import { WORKFORCE } from "./library/workforce";
import { SAFETY } from "./library/safety";
import { SPECIALIST } from "./library/specialist";
import { SETTINGS } from "./library/settings";
import { CLINICAL_EXTRA } from "./library/clinical-extra";
import { WORKFORCE_EXTRA } from "./library/workforce-extra";
import { GOVERNANCE_EXTRA } from "./library/governance-extra";
import { FORMS, TEMPLATES_PACK } from "./library/forms";
import { AUDITS, CHECKLISTS, RISK_ASSESSMENTS } from "./library/checks";

export type { TemplateDef, TemplateSection, TemplateVersion } from "./library/build";

export const TEMPLATES = buildTemplates(
  [...SAFEGUARDING, ...MEDICINES, ...IPC, ...CARE, ...CLINICAL, ...CONSENT_EOL, ...GOVERNANCE, ...WORKFORCE, ...SAFETY,
    ...SPECIALIST, ...SETTINGS, ...CLINICAL_EXTRA, ...WORKFORCE_EXTRA, ...GOVERNANCE_EXTRA],
  [...FORMS, ...TEMPLATES_PACK, ...RISK_ASSESSMENTS, ...CHECKLISTS, ...AUDITS],
);
