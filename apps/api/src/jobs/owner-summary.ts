import { config } from "../config.js";
import { db } from "../db/query.js";
import { getMailer, type Mailer } from "../lib/mail/index.js";
import { claimRun, lastRunAt, releaseRun } from "./job-runs.repository.js";

/**
 * The owner's daily summary: one email at 4 PM Manila time listing the user
 * reports, bug reports and commission problems that came in since the last
 * summary.
 *
 * On a day when nothing came in, no email is sent at all, to keep within
 * Brevo's free daily limit; the run is still recorded, so the next summary
 * starts from here. It goes to OWNER_ALERT_EMAIL only.
 */

const JOB = "owner-summary";
const SEND_HOUR = 16;
const MANILA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const LIST_LIMIT = 10;

export type SummaryOutcome = "not_yet" | "already_ran" | "nothing_new" | "no_recipient" | "sent";

function manilaParts(now: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(MANILA.formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

interface Section {
  count: number;
  lines: string[];
}

const REPORT_REASON: Record<string, string> = {
  harassment: "Bullying or harassment",
  inappropriate: "Sexual or inappropriate",
  scam: "Scam or fraud",
  stolen_work: "Stolen work",
  spam: "Spam",
  other: "Something else",
};

const PROBLEM_REASON: Record<string, string> = {
  payment_not_received: "Payment not received",
  work_not_delivered: "Work not delivered",
  not_as_agreed: "Not as agreed",
  stopped_responding: "Stopped responding",
  other: "Other",
};

const oneLine = (text: string | null, max = 160) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

async function collect(since: Date, until: Date): Promise<{ reports: Section; bugs: Section; problems: Section }> {
  const window = { since, until };
  const [reportCount, reports, bugCount, bugs, problemCount, problems] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM reports WHERE created_at > :since AND created_at <= :until`, window),
    db.many<{ targetType: string; reason: string; details: string | null; reporter: string }>(
      `SELECT r.target_type, r.reason, r.details, u.username AS reporter
         FROM reports r JOIN users u ON u.id = r.reporter_id
        WHERE r.created_at > :since AND r.created_at <= :until
        ORDER BY r.created_at FETCH FIRST ${LIST_LIMIT} ROWS ONLY`,
      window,
    ),
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM bug_reports WHERE created_at > :since AND created_at <= :until`, window),
    db.many<{ description: string; pageUrl: string | null; reporter: string }>(
      `SELECT b.description, b.page_url, u.username AS reporter
         FROM bug_reports b JOIN users u ON u.id = b.reporter_id
        WHERE b.created_at > :since AND b.created_at <= :until
        ORDER BY b.created_at FETCH FIRST ${LIST_LIMIT} ROWS ONLY`,
      window,
    ),
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM commission_problems WHERE created_at > :since AND created_at <= :until`, window),
    db.many<{ reason: string; details: string; title: string; openedBy: string }>(
      `SELECT pr.reason, pr.details, p.title, u.username AS opened_by
         FROM commission_problems pr
         JOIN commissions cm ON cm.id = pr.commission_id
         JOIN postings p ON p.id = cm.posting_id
         JOIN users u ON u.id = pr.opened_by
        WHERE pr.created_at > :since AND pr.created_at <= :until
        ORDER BY pr.created_at FETCH FIRST ${LIST_LIMIT} ROWS ONLY`,
      window,
    ),
  ]);

  return {
    reports: {
      count: Number(reportCount?.cnt ?? 0),
      lines: reports.map(
        (row) => `${REPORT_REASON[row.reason] ?? row.reason} (${row.targetType}), from @${row.reporter}${row.details ? `: ${oneLine(row.details)}` : ""}`,
      ),
    },
    bugs: {
      count: Number(bugCount?.cnt ?? 0),
      lines: bugs.map((row) => `@${row.reporter}${row.pageUrl ? ` on ${row.pageUrl}` : ""}: ${oneLine(row.description)}`),
    },
    problems: {
      count: Number(problemCount?.cnt ?? 0),
      lines: problems.map((row) => `${PROBLEM_REASON[row.reason] ?? row.reason} on "${row.title}", from @${row.openedBy}: ${oneLine(row.details)}`),
    },
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function compose(date: string, data: Awaited<ReturnType<typeof collect>>) {
  const base = config.mail.publicWebUrl;
  const sections = [
    { title: "Reports", noun: "report", tab: "reports", section: data.reports },
    { title: "Bug reports", noun: "bug report", tab: "bugs", section: data.bugs },
    { title: "Commission problems", noun: "commission problem", tab: "problems", section: data.problems },
  ].filter((entry) => entry.section.count > 0);

  const subject = `Craftbid, ${date}: ${sections.map((entry) => plural(entry.section.count, entry.noun)).join(", ")}`;

  const text = [
    "What came in since the last summary:",
    "",
    ...sections.flatMap((entry) => [
      `${entry.title} (${entry.section.count})`,
      ...entry.section.lines.map((line) => `- ${line}`),
      ...(entry.section.count > entry.section.lines.length ? [`- and ${entry.section.count - entry.section.lines.length} more`] : []),
      `Open: ${base}/admin?tab=${entry.tab}`,
      "",
    ]),
  ].join("\n");

  const html = [
    "<p>What came in since the last summary:</p>",
    ...sections.map(
      (entry) =>
        `<h3>${escapeHtml(entry.title)} (${entry.section.count})</h3><ul>${entry.section.lines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul><p><a href="${escapeHtml(`${base}/admin?tab=${entry.tab}`)}">Open in the admin screen</a></p>`,
    ),
  ].join("");

  return { subject, text, html };
}

export async function runOwnerSummary(
  now: Date,
  options: { recipient?: string | undefined; mailer?: Mailer } = {},
): Promise<SummaryOutcome> {
  const recipient = "recipient" in options ? options.recipient : config.mail.ownerAlertEmail;
  const { date, hour } = manilaParts(now);
  if (hour < SEND_HOUR) return "not_yet";

  // Read before claiming, or this run's own claim would be "the last run".
  const previous = await lastRunAt(JOB);
  if (!(await claimRun(JOB, date, now))) return "already_ran";

  const since = previous ?? new Date(now.getTime() - 24 * 3_600_000);
  const data = await collect(since, now);
  if (data.reports.count + data.bugs.count + data.problems.count === 0) return "nothing_new";

  if (!recipient) {
    console.warn("Owner summary has something to send but OWNER_ALERT_EMAIL is not set.");
    return "no_recipient";
  }

  const message = compose(date, data);
  try {
    await (options.mailer ?? getMailer()).send({ to: recipient, ...message });
  } catch (error) {
    // Given back so the next tick, five minutes on, tries again today.
    await releaseRun(JOB, date);
    throw error;
  }
  return "sent";
}
