import { runChatFileCleanup } from "./chat-file-cleanup.js";
import { runChatNudges } from "./chat-nudges.js";
import { runOwnerSummary } from "./owner-summary.js";

/**
 * Scheduled work, run inside the API process.
 *
 * No separate scheduler: the Cloudflare keep-alive pings this API every ten
 * minutes, so the free Render instance never sleeps long enough to miss a
 * five-minute tick, and nothing new needs a secret or a service. Every job
 * claims its own work in the database, so a tick that overlaps a restart, or
 * runs twice, does nothing twice.
 */

const TICK_MS = 5 * 60_000;
const FIRST_TICK_MS = 30_000;

interface Logger {
  info(message: string): void;
  error(error: unknown, message: string): void;
}

const JOBS: [string, (now: Date) => Promise<unknown>][] = [
  ["owner summary", (now) => runOwnerSummary(now)],
  ["unread chat notices", runChatNudges],
  ["abandoned chat images", runChatFileCleanup],
];

export function startJobs(log: Logger): () => void {
  let running = false;

  async function tick(): Promise<void> {
    // A slow tick (a cold database, a slow email) is not stacked on.
    if (running) return;
    running = true;
    try {
      for (const [name, job] of JOBS) {
        try {
          const outcome = await job(new Date());
          if (outcome === "sent" || (typeof outcome === "number" && outcome > 0)) {
            log.info(`Job ${name}: ${String(outcome)}`);
          }
        } catch (error) {
          // One failing job never stops the others, or the next tick.
          log.error(error, `Job ${name} failed`);
        }
      }
    } finally {
      running = false;
    }
  }

  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), TICK_MS);
  first.unref();
  interval.unref();

  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
