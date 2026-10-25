import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<{ messageId: string }>;
}

/** Development provider: logs metadata only (no body) and keeps an in-memory outbox for tests. */
export class LogEmailProvider implements EmailProvider {
  name = "log";
  outbox: EmailMessage[] = [];
  async send(msg: EmailMessage) {
    this.outbox.push(msg);
    logger.info({ to: msg.to, subject: msg.subject }, "email (log provider)");
    return { messageId: `log-${Date.now()}-${this.outbox.length}` };
  }
}

class SmtpEmailProvider implements EmailProvider {
  name = "smtp";
  private transport;
  constructor() {
    this.transport = import("nodemailer").then((m) =>
      m.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      }),
    );
  }
  async send(msg: EmailMessage) {
    const t = await this.transport;
    const info = await t.sendMail({ from: process.env.EMAIL_FROM ?? "Evantix Care <no-reply@evantix.example>", to: msg.to, subject: msg.subject, text: msg.text });
    return { messageId: info.messageId };
  }
}

let provider: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (!provider) provider = process.env.EMAIL_PROVIDER === "smtp" ? new SmtpEmailProvider() : new LogEmailProvider();
  return provider;
}
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}
