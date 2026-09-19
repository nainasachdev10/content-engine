/**
 * Single-admin auth for v1, structured for more users/roles later:
 * everything flows through a User record + signed session token, so adding a
 * user store (table/file) and role checks means touching only this module.
 *
 * Session token = base64url(payload).base64url(HMAC-SHA256(payload, secret))
 * Uses Web Crypto so the same code verifies in edge middleware and node routes.
 */

export interface User {
  username: string;
  role: "admin" | "viewer"; // future: viewer = approval-only collaborator
}

export interface Session extends User {
  exp: number; // unix seconds
}

const COOKIE = "engine_session";
const SESSION_DAYS = 7;

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const b64url = (buf: ArrayBuffer | Uint8Array): string =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .toString("base64url");

export async function signSession(user: User, secret: string): Promise<string> {
  const payload: Session = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      Buffer.from(sig, "base64url"),
      enc.encode(body)
    );
    if (!ok) return null;
    const session = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export const sessionCookieName = COOKIE;

/** v1 credential check: one admin, password from env. */
export function checkCredentials(password: string): User | null {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) throw new Error("DASHBOARD_PASSWORD is not set in the root .env");
  return password === expected ? { username: "admin", role: "admin" } : null;
}
