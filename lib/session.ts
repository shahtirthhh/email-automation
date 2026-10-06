/**
 * Single-password gate for the whole app. This file is imported by proxy.ts, so it only
 * uses Web Crypto and must not import server-only modules.
 */
export const SESSION_COOKIE = "ea_session";

export function appPassword(): string | null {
  return process.env.APP_PASSWORD?.trim() || null;
}

/** With no password set, the app is open in development and locked in production. */
export function isLockedOut(): boolean {
  return !appPassword() && process.env.NODE_ENV === "production";
}

export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("email-automation-session"),
  );
  return Buffer.from(signature).toString("hex");
}

export async function isValidSession(
  cookieValue: string | undefined,
): Promise<boolean> {
  const password = appPassword();
  if (!password) return !isLockedOut();
  return Boolean(cookieValue) && cookieValue === (await sessionToken(password));
}
