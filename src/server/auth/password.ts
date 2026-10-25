import bcrypt from "bcryptjs";

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 10) throw new Error("Password must be at least 10 characters");
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // constant-ish time when the user has no password (SSO-only accounts)
    await bcrypt.compare(pw, "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.ZWh5R1oQ1XoV4Bk2m7x0d1Yc5x3u");
    return false;
  }
  return bcrypt.compare(pw, hash);
}
