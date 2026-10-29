import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Key safe codes are encrypted at rest (AES-256-GCM). The key comes from KEYSAFE_SECRET. Outside production a
 * fixed development key is used so demos work; in production a missing secret refuses to store or reveal codes.
 */
function key() {
  const secret = process.env.KEYSAFE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production" && process.env.CSB_ALLOW_DEV_KEYSAFE !== "true") throw new Error("KEYSAFE_SECRET is not configured");
    return createHash("sha256").update("csb-development-keysafe-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptKeySafe(code: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(code, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptKeySafe(cipher: string) {
  const [v, iv, tag, body] = cipher.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised key safe format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
