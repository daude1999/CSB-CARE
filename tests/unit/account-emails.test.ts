import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { invitationEmail, passwordResetEmail } from "@/server/notifications/account-emails";
import { SmtpEmailProvider } from "@/server/notifications/email";

const ORIGIN = "https://csb.example.test";
const LINK = `${ORIGIN}/account/abcDEF123_-abcDEF123_-abcDEF123`;

describe("account email templates", () => {
  it("invitation: text and HTML parts say the same thing and both carry the link", () => {
    const m = invitationEmail({ name: "Sam New", organisation: "Example Care Ltd", link: LINK, expiresInDays: 7, origin: ORIGIN });
    expect(m.subject).toBe("You have been invited to join Example Care Ltd on CSB");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("Hello Sam New,");
      expect(part).toContain("invited to join Example Care Ltd");
      expect(part).toContain(LINK);
      expect(part).toContain("works once and expires in 7 days");
      expect(part).toContain("Care Solution Bureau CIC");
    }
    expect(m.html).toContain(`<a href="${LINK}"`);
    expect(m.html).toContain("Accept invitation");
    expect(m.html).toContain(`src="${ORIGIN}/csb-logo.png" alt="CSB Care Solution Bureau"`);
    expect(m.html).toMatch(/^<!doctype html>/);
    // Email clients drop stylesheets and scripts, so there are none.
    expect(m.html).not.toMatch(/<style|<script|<link /i);
  });

  it("password reset: text and HTML parts, with the expiry and what to do if unexpected", () => {
    const m = passwordResetEmail({ name: "Sam New", link: LINK, expiresInHours: 1, origin: ORIGIN });
    expect(m.subject).toBe("Reset your CSB password");
    for (const part of [m.text, m.html]) {
      expect(part).toContain(LINK);
      expect(part).toContain("works once and expires in 1 hour.");
      expect(part).toContain("tell your administrator");
    }
    expect(m.html).toContain("Choose a new password");
  });

  it("escapes names so they cannot add markup, and keeps the subject on one line", () => {
    const m = invitationEmail({ name: '<img src=x onerror="alert(1)">', organisation: "A & B <script>Care</script>\r\nBcc: someone@example.test", link: LINK, expiresInDays: 2, origin: ORIGIN });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(m.html).toContain("A &amp; B &lt;script&gt;Care&lt;/script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

describe("SMTP provider with a mock transport", () => {
  it("sends both parts through nodemailer", async () => {
    // nodemailer's own in-memory transport: builds the real message and sends it nowhere.
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const provider = new SmtpEmailProvider(transport);
    const m = passwordResetEmail({ name: "Sam New", link: LINK, expiresInHours: 24, origin: ORIGIN });
    const sent: { to: string; subject: string; text: string; html?: string }[] = [];
    const spy: typeof transport.sendMail = ((mail: { to: string; subject: string; text: string; html?: string }) => { sent.push(mail); return transport.sendMail(mail); }) as typeof transport.sendMail;
    const r = await new SmtpEmailProvider({ sendMail: spy }).send({ to: "sam.new@example.test", ...m });
    expect(r.messageId).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "sam.new@example.test", subject: "Reset your CSB password", text: m.text, html: m.html });
    // And the plain provider path works without the spy.
    expect((await provider.send({ to: "sam.new@example.test", subject: "Plain", text: "Text only" })).messageId).toBeTruthy();
  });
});
