/**
 * Original starter policy templates written for Evantix Care.
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

export type { TemplateDef, TemplateSection, TemplateVersion } from "./library/build";

export const TEMPLATES = buildTemplates([...SAFEGUARDING, ...MEDICINES, ...IPC, ...CARE, ...CLINICAL, ...CONSENT_EOL, ...GOVERNANCE, ...WORKFORCE, ...SAFETY]);
