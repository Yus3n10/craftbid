import type {
  AdminBugReportDto,
  AdminContentItemDto,
  AdminOverviewDto,
  AdminUserRowDto,
  AdminUsersQuery,
  ModerationAction,
  ModerationActionDto,
  ModerationRule,
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserStatus,
} from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue } from "../../db/query.js";

/** Read queries for the admin screen. Every change goes through the moderation service. */

export async function overview(): Promise<AdminOverviewDto> {
  const row = await db.one<{
    openReports: number;
    openBugReports: number;
    openProblems: number;
    suspendedAccounts: number;
    unconfirmedAccounts: number;
    actionsThisWeek: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM bug_reports WHERE status = 'open') AS open_bug_reports,
       (SELECT COUNT(*) FROM commission_problems WHERE status = 'open') AS open_problems,
       (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_accounts,
       (SELECT COUNT(*) FROM users WHERE status <> 'deleted' AND email_verified_at IS NULL) AS unconfirmed_accounts,
       (SELECT COUNT(*) FROM moderation_actions WHERE created_at > SYSTIMESTAMP - INTERVAL '7' DAY) AS actions_this_week
     FROM dual`,
  );
  return {
    openReports: Number(row?.openReports ?? 0),
    openBugReports: Number(row?.openBugReports ?? 0),
    openProblems: Number(row?.openProblems ?? 0),
    suspendedAccounts: Number(row?.suspendedAccounts ?? 0),
    unconfirmedAccounts: Number(row?.unconfirmedAccounts ?? 0),
    actionsThisWeek: Number(row?.actionsThisWeek ?? 0),
  };
}

interface UserRow {
  id: Buffer;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isStaff: number;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  bio: string | null;
}

const USER_COLUMNS = `id, username, display_name, email, role, status, is_staff, created_at, email_verified_at, bio`;

function mapUserRow(row: UserRow): AdminUserRowDto {
  return {
    id: bufToUuid(row.id)!,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    isStaff: row.isStaff === 1,
    createdAt: row.createdAt.toISOString(),
    emailConfirmedAt: row.emailVerifiedAt ? row.emailVerifiedAt.toISOString() : null,
  };
}

export async function listUsers(query: AdminUsersQuery): Promise<{ items: AdminUserRowDto[]; total: number }> {
  const where: string[] = [];
  const binds: Record<string, BindValue> = {};
  if (query.q) {
    where.push("(UPPER(username) LIKE :q OR UPPER(display_name) LIKE :q OR UPPER(email) LIKE :q)");
    // % and _ are LIKE wildcards; a search is always a plain substring.
    binds.q = `%${query.q.toUpperCase().replace(/[%_]/g, "")}%`;
  }
  if (query.email === "confirmed") where.push("email_verified_at IS NOT NULL");
  if (query.email === "unconfirmed") where.push("email_verified_at IS NULL");
  if (query.status) {
    where.push("status = :status");
    binds.status = query.status;
  }
  if (query.role) {
    where.push("role = :role");
    binds.role = query.role;
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM users ${whereClause}`, binds),
    db.many<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users ${whereClause}
        ORDER BY created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset: query.offset, limit: query.limit },
    ),
  ]);
  return { items: rows.map(mapUserRow), total: Number(count?.cnt ?? 0) };
}

export async function findUser(id: string): Promise<(AdminUserRowDto & { bio: string | null }) | null> {
  const row = await db.one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = :id`, { id: uuidToBuf(id) });
  return row ? { ...mapUserRow(row), bio: row.bio } : null;
}

interface ActionRow {
  id: Buffer;
  action: ModerationAction;
  targetType: string;
  targetId: Buffer;
  subjectUserId: Buffer | null;
  subjectUsername: string | null;
  staffId: Buffer;
  staffUsername: string;
  rule: ModerationRule | null;
  note: string | null;
  createdAt: Date;
}

const ACTION_SELECT = `
  SELECT m.id, m.action, m.target_type, m.target_id, m.subject_user_id, su.username AS subject_username,
         m.staff_id, st.username AS staff_username, m.rule, m.note, m.created_at
    FROM moderation_actions m
    JOIN users st ON st.id = m.staff_id
    LEFT JOIN users su ON su.id = m.subject_user_id
`;

function mapAction(row: ActionRow): ModerationActionDto {
  return {
    id: bufToUuid(row.id)!,
    action: row.action,
    targetType: row.targetType,
    targetId: bufToUuid(row.targetId)!,
    subjectUser: row.subjectUserId ? { id: bufToUuid(row.subjectUserId)!, username: row.subjectUsername ?? "" } : null,
    staff: { id: bufToUuid(row.staffId)!, username: row.staffUsername },
    rule: row.rule,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listActions(
  limit: number,
  offset: number,
  subjectUserId?: string,
): Promise<{ items: ModerationActionDto[]; total: number }> {
  const where = subjectUserId ? "WHERE m.subject_user_id = :subject" : "";
  const binds: Record<string, BindValue> = subjectUserId ? { subject: uuidToBuf(subjectUserId) } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM moderation_actions m ${where}`, binds),
    db.many<ActionRow>(
      `${ACTION_SELECT} ${where} ORDER BY m.created_at DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return { items: rows.map(mapAction), total: Number(count?.cnt ?? 0) };
}

export async function reportsAgainst(userId: string) {
  const rows = await db.many<{ id: Buffer; reason: string; status: ReportStatus; createdAt: Date }>(
    `SELECT r.id, r.reason, r.status, r.created_at
       FROM reports r
      WHERE (r.target_type = 'user' AND r.target_id = :id)
         OR (r.target_type = 'artist_post' AND r.target_id IN (SELECT id FROM artist_posts WHERE artist_id = :id))
         OR (r.target_type = 'posting' AND r.target_id IN (SELECT id FROM postings WHERE client_id = :id))
         OR (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM post_comments WHERE author_id = :id))
         OR (r.target_type = 'application' AND r.target_id IN (SELECT id FROM applications WHERE artist_id = :id))
      ORDER BY r.created_at DESC
      FETCH FIRST 50 ROWS ONLY`,
    { id: uuidToBuf(userId) },
  );
  return rows.map((row) => ({
    id: bufToUuid(row.id)!,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

function hrefFor(kind: string, id: string, postId: string | null, username: string | null): string | null {
  if (kind === "artist_post") return `/posts/${id}`;
  if (kind === "posting") return `/postings/${id}`;
  if (kind === "comment") return postId ? `/posts/${postId}` : null;
  if (kind === "user") return username ? `/artists/${username}` : null;
  return null;
}

export async function recentContent(userId: string): Promise<AdminContentItemDto[]> {
  const rows = await db.many<{
    id: Buffer;
    kind: AdminContentItemDto["kind"];
    text: string;
    createdAt: Date;
    removed: number;
    postId: Buffer | null;
  }>(
    `SELECT id, kind, text, created_at, removed, post_id FROM (
       SELECT id, CAST('artist_post' AS VARCHAR2(12)) AS kind, CAST(caption AS VARCHAR2(2000 CHAR)) AS text, created_at,
              CASE WHEN status = 'removed' THEN 1 ELSE 0 END AS removed, CAST(NULL AS RAW(16)) AS post_id
         FROM artist_posts WHERE artist_id = :id
       UNION ALL
       SELECT id, 'posting', title, created_at, CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END, NULL
         FROM postings WHERE client_id = :id
       UNION ALL
       SELECT id, 'comment', body, created_at, CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END, post_id
         FROM post_comments WHERE author_id = :id
     ) ORDER BY created_at DESC FETCH FIRST 30 ROWS ONLY`,
    { id: uuidToBuf(userId) },
  );
  return rows.map((row) => {
    const id = bufToUuid(row.id)!;
    const removed = row.removed === 1;
    return {
      id,
      kind: row.kind,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
      removed,
      href: removed ? null : hrefFor(row.kind, id, bufToUuid(row.postId), null),
    };
  });
}

export interface ReportRow {
  id: Buffer;
  targetType: ReportTargetType;
  targetId: Buffer;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporterId: Buffer;
  reporterUsername: string;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolverUsername: string | null;
}

export async function listReports(status: string | undefined, limit: number, offset: number) {
  const where = status ? "WHERE r.status = :status" : "";
  const binds: Record<string, BindValue> = status ? { status } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM reports r ${where}`, binds),
    db.many<ReportRow>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
              rp.id AS reporter_id, rp.username AS reporter_username,
              r.resolution_note, r.resolved_at, rs.username AS resolver_username
         FROM reports r
         JOIN users rp ON rp.id = r.reporter_id
         LEFT JOIN users rs ON rs.id = r.resolved_by
         ${where}
        ORDER BY r.created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return { rows, total: Number(count?.cnt ?? 0) };
}

/**
 * What a report points at, as it is now: one small query per target type,
 * picked from this fixed map, so no table name comes from the request.
 */
const TARGET_QUERIES: Record<ReportTargetType, string> = {
  artist_post: `SELECT p.caption AS text, CASE WHEN p.status = 'removed' THEN 1 ELSE 0 END AS removed,
                       u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
                  FROM artist_posts p JOIN users u ON u.id = p.artist_id WHERE p.id = :id`,
  posting: `SELECT p.title AS text, CASE WHEN p.removed_at IS NOT NULL THEN 1 ELSE 0 END AS removed,
                   u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
              FROM postings p JOIN users u ON u.id = p.client_id WHERE p.id = :id`,
  comment: `SELECT c.body AS text, CASE WHEN c.removed_at IS NOT NULL THEN 1 ELSE 0 END AS removed,
                   u.id AS owner_id, u.username AS owner_username, c.post_id
              FROM post_comments c JOIN users u ON u.id = c.author_id WHERE c.id = :id`,
  user: `SELECT u.display_name || ' (@' || u.username || ')' AS text, CASE WHEN u.status = 'deleted' THEN 1 ELSE 0 END AS removed,
                u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
           FROM users u WHERE u.id = :id`,
  application: `SELECT a.cover_letter AS text, 0 AS removed,
                       u.id AS owner_id, u.username AS owner_username, CAST(NULL AS RAW(16)) AS post_id
                  FROM applications a JOIN users u ON u.id = a.artist_id WHERE a.id = :id`,
};

export async function reportTarget(type: ReportTargetType, targetId: Buffer) {
  const row = await db.one<{ text: string; removed: number; ownerId: Buffer; ownerUsername: string; postId: Buffer | null }>(
    TARGET_QUERIES[type],
    { id: targetId },
  );
  if (!row) return null;
  const removed = row.removed === 1;
  return {
    text: row.text,
    removed,
    href: removed ? null : hrefFor(type, bufToUuid(targetId)!, bufToUuid(row.postId), row.ownerUsername),
    owner: { id: bufToUuid(row.ownerId)!, username: row.ownerUsername },
  };
}

export async function listBugs(
  status: string | undefined,
  limit: number,
  offset: number,
): Promise<{ items: AdminBugReportDto[]; total: number }> {
  const where = status ? "WHERE b.status = :status" : "";
  const binds: Record<string, BindValue> = status ? { status } : {};
  const [count, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM bug_reports b ${where}`, binds),
    db.many<{
      id: Buffer;
      description: string;
      pageUrl: string | null;
      userAgent: string | null;
      screenshotKey: string | null;
      status: "open" | "resolved";
      createdAt: Date;
      reporterId: Buffer;
      reporterUsername: string;
      reporterEmail: string;
    }>(
      `SELECT b.id, b.description, b.page_url, b.user_agent, b.screenshot_key, b.status, b.created_at,
              u.id AS reporter_id, u.username AS reporter_username, u.email AS reporter_email
         FROM bug_reports b JOIN users u ON u.id = b.reporter_id
         ${where}
        ORDER BY b.created_at DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset, limit },
    ),
  ]);
  return {
    total: Number(count?.cnt ?? 0),
    items: rows.map((row) => ({
      id: bufToUuid(row.id)!,
      description: row.description,
      pageUrl: row.pageUrl,
      userAgent: row.userAgent,
      hasScreenshot: Boolean(row.screenshotKey),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reporter: { id: bufToUuid(row.reporterId)!, username: row.reporterUsername, email: row.reporterEmail },
    })),
  };
}

export async function bugScreenshotKey(id: string): Promise<string | null> {
  const row = await db.one<{ screenshotKey: string | null }>(
    `SELECT screenshot_key FROM bug_reports WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row?.screenshotKey ?? null;
}

export async function setStaff(email: string, isStaff: boolean): Promise<boolean> {
  const changed = await db.run(`UPDATE users SET is_staff = :flag WHERE email = :email`, {
    flag: isStaff ? 1 : 0,
    email: email.toLowerCase(),
  });
  return changed === 1;
}

export async function listStaff(): Promise<{ email: string; username: string; status: string }[]> {
  return db.many<{ email: string; username: string; status: string }>(
    `SELECT email, username, status FROM users WHERE is_staff = 1 ORDER BY username`,
  );
}
