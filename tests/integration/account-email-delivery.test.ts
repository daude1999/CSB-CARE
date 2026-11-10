import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { ACCOUNT_EMAIL_LIMITS, deliverAccountLink, deliveryMessage } from "@/server/admin/account-delivery";
import { createResetLink, describeToken, inviteMember, redeemToken, revokeInvite } from "@/server/admin/users";
import { LogEmailProvider, SmtpEmailProvider, setEmailProvider, type MailTransport } from "@/server/notifications/email";
import { enqueue } from "@/server/jobs/queue";
import { GET as health } from "@/app/api/health/route";
import { BROOKFIELD, ctxFor, resetDb, seedAll } from "../helpers";

/**
 * Invitation and password reset emails against a real database, with nodemailer's in-memory transport standing in
 * for the mail server: nothing leaves the machine. Covers the email itself, the copy-link fallback, the hourly
 * limits and what the audit log and the application log keep.
 */
const ORIGIN = "https://csb.example.test";
const admin = () => ctxFor("manager@care-solution.demo", BROOKFIELD);
const actor = async () => ({ userId: (await admin()).userId, level: "admin" as const });
let orgId = "";

interface Sent { from: string; to: string; subject: string; text: string; html?: string }
/** A mock mail server: records what nodemailer was asked to send, and builds the real message without sending it. */
function mockTransport(opts: { fail?: boolean } = {}) {
  const sent: Sent[] = [];
  const real = nodemailer.createTransport({ jsonTransport: true });
  const transport: MailTransport = {
    async sendMail(mail) {
      if (opts.fail) throw Object.assign(new Error("Connection refused by smtp.example.test for sam@example.test"), { name: "SmtpDown" });
      sent.push(mail);
      return real.sendMail(mail);
    },
  };
  setEmailProvider(new SmtpEmailProvider(transport));
  return sent;
}

beforeAll(async () => {
  await resetDb();
  await seedAll({ simulatedChange: false, care: true });
  orgId = (await db.organisation.findUniqueOrThrow({ where: { slug: BROOKFIELD } })).id;
}, 180_000);

afterEach(() => setEmailProvider(new LogEmailProvider()));

describe("invitation email", () => {
  it("emails the invited person a branded message whose link accepts the invitation", async () => {
    const sent = mockTransport();
    const r = await inviteMember(await admin(), { email: "Ida.Invited@Example.test", name: "Ida Invited", roles: ["CARE_COORDINATOR"] });
    const d = await deliverAccountLink({ tokenId: r.inviteId, token: r.token, origin: `${ORIGIN}/`, actor: await actor() });
    expect(d).toEqual({ emailed: true });
    expect(deliveryMessage("invite", d)).toBe("Invitation created and emailed. You can also copy the link below.");

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    // The address comes from the stored invitation (normalised), not from anything the caller passes.
    expect(mail.to).toBe("ida.invited@example.test");
    expect(mail.subject).toBe("You have been invited to join Care Solution Bureau (DEMO) on CSB");
    const link = `${ORIGIN}/account/${r.token}`;
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`<a href="${link}"`);
    expect(mail.html).toContain("Hello Ida Invited,");
    expect(mail.text).toMatch(/expires in 7 days/);

    // The emailed link is the working one.
    const emailed = /https:\/\/csb\.example\.test\/account\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    expect((await describeToken(emailed))?.kind).toBe("INVITE");
    await redeemToken(emailed, { password: "a long enough password 2026", name: "Ida Invited" });
    expect(await db.membership.count({ where: { organisationId: orgId, user: { email: "ida.invited@example.test" } } })).toBe(1);

    // The audit log says an email was sent and to whom; it never holds the link or its token.
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "account.email.sent", entityId: r.inviteId } });
    expect(log).toMatchObject({ organisationId: orgId, actorId: (await admin()).userId, entityType: "AccountToken" });
    expect(log.data).toEqual({ kind: "invite", by: "admin", recipient: "ida.invited@example.test" });
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: r.inviteId } }))).not.toContain(r.token);
  });

  it("falls back to the copy link when no mail server is configured, and sends nothing", async () => {
    const log = new LogEmailProvider();
    setEmailProvider(log);
    const r = await inviteMember(await admin(), { email: "nomail@example.test", name: "No Mail", roles: ["STAFF"] });
    const d = await deliverAccountLink({ tokenId: r.inviteId, token: r.token, origin: ORIGIN, actor: await actor() });
    expect(d).toEqual({ emailed: false, why: "not-configured" });
    expect(deliveryMessage("invite", d)).toBe("Invitation created. Copy the link below.");
    expect(log.outbox).toHaveLength(0);
    // The link the administrator copies still works.
    expect((await describeToken(r.token))?.kind).toBe("INVITE");
  });

  it("falls back to the copy link when the mail server fails, and logs no address or link", async () => {
    mockTransport({ fail: true });
    const r = await inviteMember(await admin(), { email: "sam@example.test", name: "Sam Fail", roles: ["STAFF"] });
    const d = await deliverAccountLink({ tokenId: r.inviteId, token: r.token, origin: ORIGIN, actor: await actor() });
    expect(d).toEqual({ emailed: false, why: "failed" });
    expect(deliveryMessage("invite", d)).toBe("Invitation created. The email could not be sent. Copy the link below.");
    const failed = await db.auditLog.findFirstOrThrow({ where: { action: "account.email.failed", entityId: r.inviteId } });
    expect(failed.data).toEqual({ kind: "invite", by: "admin" });
    expect((await describeToken(r.token))?.kind).toBe("INVITE");
  });

  it("does not email a revoked invitation", async () => {
    const sent = mockTransport();
    const r = await inviteMember(await admin(), { email: "revoked.mail@example.test", name: "Revoked", roles: ["STAFF"] });
    await revokeInvite(await admin(), r.inviteId);
    expect(await deliverAccountLink({ tokenId: r.inviteId, token: r.token, origin: ORIGIN, actor: await actor() })).toEqual({ emailed: false, why: "failed" });
    expect(sent).toHaveLength(0);
  });
});

describe("password reset email", () => {
  it("emails the member a reset link that works once", async () => {
    const sent = mockTransport();
    const invite = await inviteMember(await admin(), { email: "rita.reset@example.test", name: "Rita Reset", roles: ["STAFF"] });
    await redeemToken(invite.token, { password: "a long enough password 2026", name: "Rita Reset" });
    const m = await db.membership.findFirstOrThrow({ where: { organisationId: orgId, user: { email: "rita.reset@example.test" } } });

    const r = await createResetLink(await admin(), m.id);
    const d = await deliverAccountLink({ tokenId: r.tokenId, token: r.token, origin: ORIGIN, actor: await actor() });
    expect(d).toEqual({ emailed: true });
    expect(deliveryMessage("reset", d, "rita.reset@example.test")).toBe("Password reset link created and emailed to rita.reset@example.test. You can also copy the link below.");
    const mail = sent.at(-1)!;
    expect(mail).toMatchObject({ to: "rita.reset@example.test", subject: "Reset your CSB password" });
    expect(mail.text).toContain(`${ORIGIN}/account/${r.token}`);
    expect(mail.html).toContain("Choose a new password");
    expect(mail.text).toMatch(/expires in 24 hours/);

    await redeemToken(r.token, { password: "another long password 2026" });
    await expect(redeemToken(r.token, { password: "a third long password 2026" })).rejects.toThrow(/expired or has already been used/);
  });
});

describe("email limits", () => {
  it(`stops after ${ACCOUNT_EMAIL_LIMITS.perRecipientPerHour} account emails to one address in an hour, and still gives the link`, async () => {
    const sent = mockTransport();
    const results = [];
    let last = { inviteId: "", token: "" };
    for (let i = 0; i <= ACCOUNT_EMAIL_LIMITS.perRecipientPerHour; i++) {
      last = await inviteMember(await admin(), { email: "many@example.test", name: "Many Mails", roles: ["STAFF"] });
      results.push(await deliverAccountLink({ tokenId: last.inviteId, token: last.token, origin: ORIGIN, actor: await actor() }));
    }
    expect(results.slice(0, ACCOUNT_EMAIL_LIMITS.perRecipientPerHour).every((r) => r.emailed)).toBe(true);
    expect(results.at(-1)).toEqual({ emailed: false, why: "limit" });
    expect(sent.filter((m) => m.to === "many@example.test")).toHaveLength(ACCOUNT_EMAIL_LIMITS.perRecipientPerHour);
    expect(deliveryMessage("invite", results.at(-1)!)).toMatch(/hourly email limit has been reached\. Copy the link below\./);
    const blocked = await db.auditLog.findFirstOrThrow({ where: { action: "account.email.blocked", entityId: last.inviteId } });
    expect(blocked.data).toEqual({ kind: "invite", by: "admin", reason: "recipient limit" });
    // The refused email's link is still valid for the administrator to pass on.
    expect((await describeToken(last.token))?.kind).toBe("INVITE");
    // Someone else can still be emailed.
    const other = await inviteMember(await admin(), { email: "other@example.test", name: "Other Person", roles: ["STAFF"] });
    expect(await deliverAccountLink({ tokenId: other.inviteId, token: other.token, origin: ORIGIN, actor: await actor() })).toEqual({ emailed: true });
  });

  it(`stops one administrator after ${ACCOUNT_EMAIL_LIMITS.perSenderPerHour} emails in an hour`, async () => {
    const sent = mockTransport();
    const me = await actor();
    const already = await db.auditLog.count({ where: { action: "account.email.sent", actorId: me.userId } });
    // Earlier sends in this file count too; top the hour up to the limit with entries for made-up addresses.
    for (let i = already; i < ACCOUNT_EMAIL_LIMITS.perSenderPerHour; i++) {
      await db.auditLog.create({ data: { organisationId: orgId, actorId: me.userId, action: "account.email.sent", entityType: "AccountToken", entityId: `fill-${i}`, data: { kind: "invite", by: "admin", recipient: `fill-${i}@example.test` } } });
    }
    const r = await inviteMember(await admin(), { email: "over.sender@example.test", name: "Over Limit", roles: ["STAFF"] });
    expect(await deliverAccountLink({ tokenId: r.inviteId, token: r.token, origin: ORIGIN, actor: me })).toEqual({ emailed: false, why: "limit" });
    expect(sent).toHaveLength(0);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "account.email.blocked", entityId: r.inviteId } })).data).toMatchObject({ reason: "sender limit" });
  });
});

describe("/api/health job queue backlog", () => {
  const read = async () => (await (await health()).json()) as { status: string; queueHealthy: boolean; queue: { waiting: number; running: number; oldestWaitingMinutes: number | null; failedLast24Hours: number; givenUp: number } };

  it("reports how many jobs wait and how long the oldest has waited, with no job content", async () => {
    await db.backgroundJob.deleteMany({});
    expect(await read()).toMatchObject({ status: "ok", queueHealthy: true, queue: { waiting: 0, running: 0, oldestWaitingMinutes: null, failedLast24Hours: 0, givenUp: 0 } });

    await enqueue("maintenance.tick", {}, { idempotencyKey: "health-test-1" });
    const fresh = await read();
    expect(fresh.queue.waiting).toBe(1);
    expect(fresh.queue.oldestWaitingMinutes).toBe(0);
    expect(fresh.queueHealthy).toBe(true);

    // A job due 45 minutes ago and still waiting: the queue is not being worked.
    await db.backgroundJob.updateMany({ data: { runAfter: new Date(Date.now() - 45 * 60_000) } });
    const stale = await read();
    expect(stale.status).toBe("ok");
    expect(stale.queue.oldestWaitingMinutes).toBe(45);
    expect(stale.queueHealthy).toBe(false);

    // A job given up on after every retry also makes the queue unhealthy.
    await db.backgroundJob.updateMany({ data: { status: "DEAD", runAfter: new Date() } });
    const dead = await read();
    expect(dead.queue).toMatchObject({ waiting: 0, givenUp: 1, failedLast24Hours: 1 });
    expect(dead.queueHealthy).toBe(false);
    expect(Object.keys(dead).sort()).toEqual(["database", "queue", "queueHealthy", "status", "workerHealthy", "workerHeartbeatAgeSeconds"]);
    await db.backgroundJob.deleteMany({});
  });
});
