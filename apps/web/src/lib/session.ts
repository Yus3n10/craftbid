/**
 * Two ways to carry a session, chosen at build time.
 *
 * The web build uses httpOnly cookies: nothing is readable from JavaScript, so
 * an XSS cannot steal a session, and SameSite=lax gives CSRF protection.
 *
 * The desktop build cannot use them. Tauri serves the bundled app from
 * `tauri://localhost`, which makes every API call cross-site, and cross-site
 * cookies would require SameSite=None on the web app too. Weakening the
 * browser's CSRF posture to suit the desktop wrapper is the wrong trade, so
 * the desktop build sends bearer tokens instead. That path is the reason
 * /auth/login and /auth/register return the tokens in the body as well as
 * setting cookies.
 *
 * Storing a token in the desktop build's localStorage is acceptable in a way
 * it would not be on the web: the webview loads only our own bundled assets,
 * so there is no third-party script to steal it.
 */
export const BEARER_MODE = import.meta.env.VITE_AUTH_MODE === "bearer";

const ACCESS_KEY = "craftbid.accessToken";
const REFRESH_KEY = "craftbid.refreshToken";

/**
 * Whether this browser has ever held a session.
 *
 * The session cookies are httpOnly, so the client cannot look at them to find
 * out whether it has one. Without that, a 401 on the first /auth/me of a visit
 * was indistinguishable from an expired access token, and the client answered
 * every one of them by attempting a refresh. For a signed-out visitor -- which
 * is every first-time visitor, and the whole audience the landing page exists
 * for -- that refresh cannot possibly succeed, and it is a full round trip to
 * Render before the app can even decide to render the signed-out header.
 *
 * A flag written on sign-in and cleared on sign-out settles it. Being wrong is
 * cheap in both directions: a stale flag costs the one doomed refresh this
 * avoids, and a missing one signs the reader out a little early, which the
 * next sign-in fixes. Nothing is authorised by it and nothing sensitive is in
 * it, so it is a hint, not a credential.
 */
const SEEN_KEY = "craftbid.hadSession";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable or full. A session that does not survive a
    // restart is better than a crash on startup.
  }
}

export function getAccessToken(): string | null {
  return BEARER_MODE ? read(ACCESS_KEY) : null;
}

export function getRefreshToken(): string | null {
  return BEARER_MODE ? read(REFRESH_KEY) : null;
}

export function storeTokens(tokens: {
  accessToken?: string;
  refreshToken?: string;
}): void {
  write(SEEN_KEY, "1");
  if (!BEARER_MODE) return;
  if (tokens.accessToken) write(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) write(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  write(SEEN_KEY, null);
  if (!BEARER_MODE) return;
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}

/**
 * True when a refresh is worth attempting at all.
 *
 * In bearer mode the stored token answers it outright. In cookie mode the flag
 * is the only evidence available, and its absence means no session was ever
 * established here.
 */
export function mayHaveSession(): boolean {
  if (BEARER_MODE) return read(REFRESH_KEY) !== null;
  return read(SEEN_KEY) !== null;
}
