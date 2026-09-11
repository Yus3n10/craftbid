/**
 * The site's Worker: the built SPA, the API behind /api, and a heartbeat.
 *
 * Static assets are matched before this script runs, except for /api/*, which
 * wrangler.jsonc lists under `run_worker_first`. That listing is not optional.
 * With `not_found_handling: "single-page-application"`, a path with no file
 * behind it is answered with index.html before any script sees it, so without
 * the listing every API call would get the app's HTML back.
 */
import { isApiPath, proxyToApi } from "./api-proxy.ts";
import { keepApiAwake, type ScheduledController } from "./keepalive.ts";

interface Env {
  /** The API's own origin. Set in wrangler.jsonc, not a secret. */
  API_ORIGIN: string;
  /** Bound by Cloudflare so this script can still serve the built site. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (isApiPath(new URL(request.url).pathname)) {
      return proxyToApi(request, env.API_ORIGIN);
    }
    // Anything else that reaches here gets exactly what the asset server
    // would have given it, so routing through the script changes nothing.
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await keepApiAwake(env.API_ORIGIN);
  },
};
