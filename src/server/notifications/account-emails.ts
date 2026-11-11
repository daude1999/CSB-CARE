/**
 * The two account emails: an invitation to join an organisation and a password reset. Each has a plain-text part and
 * a branded HTML part that say the same thing. They carry the person's name, the organisation's name and a one-time
 * link, and nothing about care records.
 *
 * Email clients ignore stylesheets and web fonts, so the HTML uses a table and inline styles only. The logo is the
 * platform's own `/csb-logo.png`; the heading text stands in when a client blocks images.
 */
export interface AccountEmail {
  subject: string;
  text: string;
  html: string;
}

const INK = "#0f2a4f";
const BODY = "#26304a";
const MUTED = "#5b6478";
const LINE = "#e3e6ee";
const PAGE = "#f5f6f9";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Names go into a subject line and a greeting: strip line breaks so nobody can add headers or extra lines. */
const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

function layout(o: { origin: string; heading: string; paragraphs: string[]; button: string; link: string; footer: string[] }): string {
  const link = escapeHtml(o.link);
  const p = (text: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${BODY};">${escapeHtml(text)}</p>`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};">
<tr><td style="padding:24px 32px;border-bottom:2px solid ${INK};">
<img src="${escapeHtml(o.origin)}/csb-logo.png" alt="CSB Care Solution Bureau" height="40" style="display:block;height:40px;width:auto;border:0;color:${INK};font-size:16px;font-weight:600;">
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:${INK};">${escapeHtml(o.heading)}</h1>
${o.paragraphs.map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${INK};">
<a href="${link}" style="display:inline-block;padding:12px 24px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(o.button)}</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${MUTED};">If the button does not work, copy this address into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${link}" style="color:${INK};">${link}</a></p>
${o.footer.map((f) => `<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(f)}</p>`).join("\n")}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${MUTED};">
CSB All In One Platform, Care Solution Bureau CIC. This is an automatic message; replies are not read.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function textOf(o: { greeting: string; paragraphs: string[]; link: string; footer: string[] }): string {
  return [o.greeting, ...o.paragraphs, o.link, ...o.footer, "CSB All In One Platform, Care Solution Bureau CIC. This is an automatic message; replies are not read."].join("\n\n");
}

export function invitationEmail(o: { name: string; organisation: string; link: string; expiresInDays: number; origin: string }): AccountEmail {
  const name = oneLine(o.name);
  const organisation = oneLine(o.organisation);
  const paragraphs = [`You have been invited to join ${organisation} on the CSB All In One Platform.`, "Use the link below to accept the invitation and choose your password."];
  const footer = [`The link works once and expires in ${plural(o.expiresInDays, "day")}.`, "If you were not expecting this invitation, you can ignore this email. Nothing happens until the link is used."];
  return {
    subject: `You have been invited to join ${organisation} on CSB`,
    text: textOf({ greeting: `Hello ${name},`, paragraphs, link: o.link, footer }),
    html: layout({ origin: o.origin, heading: `Join ${organisation}`, paragraphs: [`Hello ${name},`, ...paragraphs], button: "Accept invitation", link: o.link, footer }),
  };
}

export function passwordResetEmail(o: { name: string; link: string; expiresInHours: number; origin: string }): AccountEmail {
  const name = oneLine(o.name);
  const paragraphs = ["A password reset was requested for your CSB account.", "Use the link below to choose a new password. Your other sessions are signed out when you do."];
  const footer = [`The link works once and expires in ${plural(o.expiresInHours, "hour")}.`, "If you did not expect this, do not use the link and tell your administrator."];
  return {
    subject: "Reset your CSB password",
    text: textOf({ greeting: `Hello ${name},`, paragraphs, link: o.link, footer }),
    html: layout({ origin: o.origin, heading: "Reset your password", paragraphs: [`Hello ${name},`, ...paragraphs], button: "Choose a new password", link: o.link, footer }),
  };
}
