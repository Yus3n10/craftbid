import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@craftbid/shared";
import { config } from "../config.js";

/**
 * Two-token scheme.
 *
 * The access token is a short-lived signed JWT the API can verify without
 * touching the database. The refresh token is an opaque random string whose
 * SHA-256 is what the database stores, so a leaked dump yields no usable
 * sessions, and it rotates on every refresh so a stolen one has a short life.
 *
 * Both are delivered as httpOnly cookies. A token readable from JavaScript is
 * a token any XSS can exfiltrate.
 */

export const ACCESS_COOKIE = "craftbid_at";
export const REFRESH_COOKIE = "craftbid_rt";

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("craftbid")
    .setAudience("craftbid-api")
    .setExpirationTime(config.auth.accessTokenTtl)
    .sign(config.auth.jwtSecret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, config.auth.jwtSecret, {
      issuer: "craftbid",
      audience: "craftbid-api",
    });
    if (typeof payload.sub !== "string") return null;
    if (payload.role !== "client" && payload.role !== "artist") return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    // Expired, tampered with, or wrong key. The caller treats all three the
    // same: no session.
    return null;
  }
}

/**
 * Parses the "15m" / "2h" / "30s" form jose accepts, so the access cookie can
 * be given the same lifetime as the token inside it. A cookie that outlives
 * its token just produces confusing 401s on an apparently valid session.
 */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`Cannot parse duration "${value}". Use forms like 15m or 2h.`);
  }
  const amount = Number(match[1]);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return amount * multipliers[match[2] as keyof typeof multipliers];
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + config.auth.refreshTokenTtlDays);
  return expiry;
}

/**
 * SameSite=lax rather than strict so that following a link into the site keeps
 * the user signed in. Secure is off in development because localhost is plain
 * http and the browser would otherwise silently drop the cookie.
 */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
