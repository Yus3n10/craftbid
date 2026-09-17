/**
 * Failed sign-ins counted per account, on top of the per-address route limit.
 *
 * The route limit stops one address hammering the login form. It does nothing
 * against someone who spreads guesses at one account across many addresses,
 * so failures are also counted against the email: after MAX_FAILURES within
 * WINDOW_MS the account refuses sign-in attempts, the right password included,
 * until the oldest failure ages out.
 *
 * The cost is that a stranger can hold one account's sign-in shut by guessing
 * wrong on purpose. That is bounded to fifteen minutes at a time, and OWASP's
 * guidance accepts it over an unthrottled guessing oracle.
 *
 * Kept in memory: the API runs as one process, and a restart forgetting
 * counts only gives a guesser one fresh window.
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
/** A ceiling on memory if many addresses are tried; the oldest are dropped. */
const MAX_TRACKED = 10_000;

export interface LoginThrottle {
  isLocked(email: string, now?: number): boolean;
  recordFailure(email: string, now?: number): void;
  clear(email: string): void;
}

export function createLoginThrottle(): LoginThrottle {
  const failures = new Map<string, number[]>();

  function recent(email: string, now: number): number[] {
    const kept = (failures.get(email) ?? []).filter((at) => now - at < WINDOW_MS);
    if (kept.length === 0) failures.delete(email);
    else failures.set(email, kept);
    return kept;
  }

  return {
    isLocked(email, now = Date.now()) {
      return recent(email, now).length >= MAX_FAILURES;
    },
    recordFailure(email, now = Date.now()) {
      const kept = recent(email, now);
      kept.push(now);
      failures.delete(email);
      failures.set(email, kept);
      if (failures.size > MAX_TRACKED) {
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
      }
    },
    clear(email) {
      failures.delete(email);
    },
  };
}
