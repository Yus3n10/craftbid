/**
 * The API, served from the site's own origin.
 *
 * The web app is on craftbid.pgeagoni.workers.dev and the API on
 * craftbid-api.onrender.com, which are different sites, so the session
 * cookies the API set were third-party cookies. WebKit refuses those outright,
 * and WebKit is every browser on an iPhone, Messenger's in-app browser
 * included. On those devices sign-in answered 200, the browser stored nothing,
 * and the next request that needed the session came back 401: "My bids" said
 * "You need to sign in to do that" to someone who had just signed in, and
 * closing Messenger's browser lost a session that had never really existed.
 *
 * Answering /api/* from this Worker makes the same cookies first-party. The
 * API itself does not change: it still sets them, the Worker passes them
 * through, and the browser files them under the site the person is actually
 * looking at. No token is ever readable by page script.
 *
 * Kept free of Worker-only globals so the request-shaping logic can be tested
 * under plain Node.
 */

export const API_PREFIX = "/api";

/** True for /api and anything under it, and nothing that merely starts "api". */
export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

/**
 * Where a request to /api/... goes upstream.
 *
 * The path is set on a URL that already has the API's origin, rather than
 * resolved against it. Resolving `new URL(path, origin)` treats a path such as
 * "//attacker.example/x" as protocol-relative and swaps the host, which would
 * make this Worker an open proxy to anywhere. Assigning `pathname` cannot
 * change the host, whatever the path contains.
 */
export function upstreamUrl(requestUrl: string, apiOrigin: string): string {
  const incoming = new URL(requestUrl);
  const target = new URL(apiOrigin);
  target.pathname = incoming.pathname.slice(API_PREFIX.length) || "/";
  target.search = incoming.search;
  return target.toString();
}

/**
 * The headers the API should see.
 *
 * Everything the browser sent is kept, cookies and Origin included: the
 * session cookie is the point, and the API's CSRF check still needs the real
 * Origin to refuse a foreign one. What changes:
 *
 * - X-Forwarded-For is replaced, never appended to, with the address
 *   Cloudflare saw. A visitor-supplied value is a lie the rate limiter would
 *   otherwise believe. (The API keys limits on CF-Connecting-IP, which
 *   Cloudflare sets itself on this request; this is for logs.)
 * - X-Forwarded-Host and -Proto describe the site the browser was on.
 * - Host is dropped, so the runtime sets it from the upstream URL.
 */
export function upstreamHeaders(
  incoming: Headers,
  requestUrl: string,
  clientIp: string | null,
): Headers {
  const headers = new Headers(incoming);
  const url = new URL(requestUrl);

  headers.delete("host");
  headers.delete("x-forwarded-for");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

  return headers;
}

export interface UpstreamRequest {
  url: string;
  init: RequestInit & { cache: "no-store" };
}

/**
 * Everything needed to forward one request, without sending it.
 *
 * `cache: "no-store"` is load-bearing. Cloudflare can cache a subrequest's
 * response, and its cache key has no idea whose cookie was attached. The API
 * marks per-user reads private, but a shared cache is exactly the place a
 * mistake there would become one person's bookmarks shown to the next. With
 * no-store, a request to a host outside Cloudflare bypasses the cache
 * entirely, and the browser still gets the API's own Cache-Control headers to
 * apply to itself.
 *
 * `redirect: "manual"` hands any redirect back to the browser rather than
 * following it here, where it would be followed with the visitor's cookies to
 * wherever it pointed.
 */
export function buildUpstreamRequest(
  request: Request,
  apiOrigin: string,
  clientIp: string | null,
): UpstreamRequest {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return {
    url: upstreamUrl(request.url, apiOrigin),
    init: {
      method: request.method,
      headers: upstreamHeaders(request.headers, request.url, clientIp),
      body: hasBody ? request.body : null,
      redirect: "manual",
      cache: "no-store",
    },
  };
}

/**
 * An unreachable API, reported in the API's own error envelope so the web app
 * shows its ordinary "service is having trouble" message instead of choking on
 * an HTML error page.
 */
export function badGateway(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "bad_gateway",
        message: "The Craftbid service could not be reached. Try again in a moment.",
      },
    }),
    {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

export async function proxyToApi(
  request: Request,
  apiOrigin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { url, init } = buildUpstreamRequest(
    request,
    apiOrigin,
    request.headers.get("cf-connecting-ip"),
  );
  try {
    // Returned as is: status, body and every Set-Cookie header pass through.
    return await fetchImpl(url, init);
  } catch {
    return badGateway();
  }
}
