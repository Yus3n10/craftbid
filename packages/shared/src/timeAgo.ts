/**
 * How long ago something happened, in the words the cards and comments use.
 *
 * One copy for the whole app. There used to be four, and all of them floored
 * the raw difference: a timestamp from a server whose clock ran a few seconds
 * ahead of the phone's came out slightly in the future and read "-1 days ago".
 */

const MANILA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day an instant falls on in Manila, as a whole day number. */
function manilaDay(ms: number): number {
  const [year, month, day] = MANILA_DATE.format(ms).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

/**
 * "Today", "Yesterday", "5 days ago", then a date, or months with
 * `older: "months"`.
 *
 * Days are calendar days in Manila rather than 24-hour windows, so something
 * posted at 11 PM is "Yesterday" at 1 AM, as a person would say it.
 */
export function daysAgo(iso: string, options: { now?: number; older?: "date" | "months" } = {}): string {
  const now = options.now ?? Date.now();
  const at = Math.min(Date.parse(iso), now);
  const days = manilaDay(now) - manilaDay(at);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (options.older === "months") {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  return new Date(at).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "just now", "5m", "3h", "2d", then a date. For comments. */
export function shortAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return daysAgo(iso, { now });
}
