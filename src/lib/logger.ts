import pino from "pino";

// Structured JSON logs. Never log policy bodies, personal data or secrets.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.SERVICE_NAME ?? "evantix-care" },
  redact: ["password", "passwordHash", "token", "*.apiKey", "headers.authorization", "headers.cookie"],
});
