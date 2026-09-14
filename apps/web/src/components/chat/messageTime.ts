/**
 * When a message was sent: the time today, the day and time this week, and
 * the date after that. Chat is read in order, so a relative "3h" would make
 * neighbouring messages hard to place.
 */
export function messageTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) {
    return date.toLocaleString("en-PH", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });
}
