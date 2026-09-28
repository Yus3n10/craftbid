import { newId, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export type MailKind = "verification" | "password_reset" | "account_exists" | "owner_summary";
export type MailStatus = "sent" | "failed";

export interface MailLogRow {
  kind: string;
  recipient: string;
  subject: string;
  status: MailStatus;
  error: string | null;
  driver: string;
  createdAt: Date;
}

/** Column widths from migration 024. Longer values are cut, never refused. */
const LIMITS = { recipient: 320, subject: 200, error: 500 } as const;

function trim(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export async function recordMail(
  entry: {
    kind: MailKind;
    recipient: string;
    subject: string;
    status: MailStatus;
    error?: string | undefined;
    driver: string;
  },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO mail_log (id, kind, recipient, subject, status, error, driver)
     VALUES (:id, :kind, :recipient, :subject, :status, :error, :driver)`,
    {
      id: uuidToBuf(newId()),
      kind: entry.kind,
      recipient: trim(entry.recipient, LIMITS.recipient),
      subject: trim(entry.subject, LIMITS.subject),
      status: entry.status,
      error: entry.status === "failed" && entry.error ? trim(entry.error, LIMITS.error) : null,
      driver: entry.driver,
    },
  );
}

export function recentMail(limit = 50, q: Queryable = db): Promise<MailLogRow[]> {
  return q.many<MailLogRow>(
    `SELECT kind, recipient, subject, status, error, driver, created_at
       FROM mail_log
      ORDER BY created_at DESC
      FETCH FIRST :limit ROWS ONLY`,
    { limit },
  );
}

export async function failureCount(hours: number, q: Queryable = db): Promise<number> {
  const row = await q.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM mail_log
      WHERE status = 'failed' AND created_at > SYSTIMESTAMP - NUMTODSINTERVAL(:hours, 'HOUR')`,
    { hours },
  );
  return Number(row?.cnt ?? 0);
}

/** Old rows are history nobody reads. Called by the job runner. */
export function deleteMailLogOlderThan(days: number, q: Queryable = db): Promise<number> {
  return q.run(
    `DELETE FROM mail_log WHERE created_at < SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')`,
    { days },
  );
}
