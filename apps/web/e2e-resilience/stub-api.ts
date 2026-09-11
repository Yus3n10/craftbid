/**
 * Shared by the specs in this suite: recognising and answering API calls
 * without an API.
 */

/** Where `vite preview` serves the build. Must match the config's baseURL. */
export const SITE_ORIGIN = "http://localhost:4178";

/**
 * The API path a request is for, or null when it is not an API call.
 *
 * The production build calls the API at /api on the site's own origin, where
 * the Worker forwards it. Matching on the path alone would not be enough:
 * `/postings` is both an endpoint and a route in this app, and a pattern
 * written against the bare path answered the browser's own navigation to
 * /postings with a page of JSON, leaving no #root to look at. So a same-origin
 * request counts only under /api, and is compared with that prefix removed.
 *
 * A request to another origin is also treated as the API, for a build made
 * with a cross-origin API URL. An unstubbed call does not fail a test, it
 * quietly makes it prove nothing, so both shapes are recognised.
 */
export function apiPath(url: URL): string | null {
  if (url.origin !== SITE_ORIGIN) return url.pathname;
  return url.pathname.startsWith("/api/") ? url.pathname.slice("/api".length) : null;
}

export function isApiCall(url: URL, path: RegExp): boolean {
  const p = apiPath(url);
  return p !== null && path.test(p);
}

export const SIGNED_OUT = {
  status: 401,
  contentType: "application/json",
  body: JSON.stringify({
    error: { code: "unauthorised", message: "Not signed in" },
  }),
};

export const EMPTY_PAGE = {
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 }),
};
