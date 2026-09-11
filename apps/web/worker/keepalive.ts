/**
 * A heartbeat for the API.
 *
 * Render stops a free service after fifteen minutes without a request, and the
 * next visitor waits thirty to sixty seconds while it starts again. That wait
 * is the slowest thing about this site and it lands on people arriving for the
 * first time.
 *
 * A Cloudflare cron trigger fixes it without another account or another bill:
 * the site is already deployed here, and the scheduler runs on Cloudflare's
 * side rather than depending on a workflow runner that may be delayed. GitHub's
 * scheduled workflows drift under load and stop entirely on a repository that
 * has been quiet, which is exactly when a marketplace would be cold.
 */

/**
 * Declared here rather than pulled from @cloudflare/workers-types. These files
 * sit outside the app's tsconfig and are bundled by esbuild, which strips
 * types without checking them, so a name imported from a package nothing
 * verifies would be a type that only looks real. Two fields is the whole
 * surface this uses.
 */
export interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

export async function keepApiAwake(apiOrigin: string): Promise<void> {
  // /health runs a real query, so this keeps the Oracle instance from its
  // idle timers as well as keeping the container up.
  const response = await fetch(`${apiOrigin}/health`, {
    // A waking container can take a while to answer; there is no user
    // waiting on this, so let it finish rather than retrying a cold start.
    signal: AbortSignal.timeout(90_000),
  });

  // Logged rather than thrown: a failed ping is worth seeing in `wrangler
  // tail`, but throwing would mark the cron run as failed and tell nobody.
  console.log(`keepalive: ${apiOrigin}/health -> ${response.status} ${await response.text()}`);
}
