import pino from "pino";
import { currentRequestId } from "@/lib/request-context";

/**
 * Fields that hold care-record or personal content. A log line must never carry them, so pino replaces their values
 * with "[Redacted]" wherever they appear at the top of a logged object or up to two levels inside it. This is a
 * safety net, not a licence: code should still log ids and counts only.
 */
export const REDACTED_FIELDS = [
  // secrets and sign-in material
  "password", "passwordHash", "token", "tokenHash", "apiKey", "secret", "authorization", "cookie", "resetLink", "inviteLink", "link",
  // who a person is
  "firstName", "lastName", "preferredName", "fullName", "serviceUserName", "staffName", "dateOfBirth", "dob", "nhsNumber", "niNumber", "nationalInsuranceNumber", "gender", "pronouns",
  // where they are and how to reach or enter
  "address", "addressLine1", "addressLine2", "town", "postcode", "phone", "altPhone", "mobile", "email", "accessNotes", "keySafe", "keySafeCode", "keySafeCipher",
  // care and health content
  "communicationNeeds", "carePreferences", "riskSummary", "diagnosis", "diagnoses", "conditions", "allergies", "medication", "medications", "dose", "carePlan", "supportPlan", "safeguarding",
  "notes", "note", "narrative", "description", "summary", "body", "content", "text", "extractedText", "transcript", "answer", "answers", "formData", "prompt", "messages",
  // other people and references
  "contacts", "nextOfKin", "emergencyContact", "gp", "externalReference", "referenceValue", "dbsNumber", "bankAccount", "sortCode",
] as const;

/** Top level, one level down and two levels down (pino's wildcard covers one level per star). */
export const REDACT_PATHS = REDACTED_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]).concat(["headers.authorization", "headers.cookie", "*.headers.authorization", "*.headers.cookie"]);

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.SERVICE_NAME ?? "csb-care" },
  redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
  /** Adds the request id (src/lib/request-context.ts) to every line written while a request is handled. */
  mixin() {
    const requestId = currentRequestId();
    return requestId ? { requestId } : {};
  },
};

// Structured JSON logs. Never log policy bodies, personal data or secrets.
export const logger = pino(loggerOptions);
