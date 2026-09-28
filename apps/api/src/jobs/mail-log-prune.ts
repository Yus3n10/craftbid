import { deleteMailLogOlderThan } from "../lib/mail/mail-log.repository.js";

/**
 * How long a send is worth remembering. Long enough to explain a report that
 * arrives weeks later, short enough that the table does not grow forever.
 */
export const MAIL_LOG_DAYS = 60;

export function runMailLogPrune(): Promise<number> {
  return deleteMailLogOlderThan(MAIL_LOG_DAYS);
}
