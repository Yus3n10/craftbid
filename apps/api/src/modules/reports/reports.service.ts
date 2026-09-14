import type { CreateReportInput, ReportTargetType } from "@craftbid/shared";
import { newId, uuidToBuf } from "../../db/ids.js";
import { DbError, db } from "../../db/query.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";

/**
 * Where reports land. Staff work through them on the admin screen
 * (modules/admin), and every action taken is recorded by modules/moderation.
 */
const TARGET_TABLES: Record<ReportTargetType, string> = {
  posting: "postings",
  user: "users",
  artist_post: "artist_posts",
  application: "applications",
  comment: "post_comments",
};

export async function createReport(
  reporterId: string,
  input: CreateReportInput,
): Promise<{ id: string }> {
  const table = TARGET_TABLES[input.targetType];

  // The table name comes from the map above, never from the request, so it is
  // not attacker-controlled despite being interpolated.
  const exists = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${table} WHERE id = :id`,
    { id: uuidToBuf(input.targetId) },
  );
  if (Number(exists?.cnt ?? 0) === 0) {
    throw notFound("That item does not exist.");
  }

  if (input.targetType === "user" && input.targetId === reporterId) {
    throw badRequest("You cannot report yourself.");
  }

  // Reporting your own work is not a report. The column name is one of two
  // literals, never taken from the request.
  if (input.targetType === "comment" || input.targetType === "artist_post") {
    const ownerColumn = input.targetType === "comment" ? "author_id" : "artist_id";
    const own = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ${table} WHERE id = :id AND ${ownerColumn} = :reporterId`,
      { id: uuidToBuf(input.targetId), reporterId: uuidToBuf(reporterId) },
    );
    if (Number(own?.cnt ?? 0) > 0) throw badRequest("You cannot report your own post or comment.");
  }

  // A bid is visible only to the client it went to; anyone else is told it
  // does not exist, exactly as the bid routes do.
  if (input.targetType === "application") {
    const receiver = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM applications a JOIN postings p ON p.id = a.posting_id
        WHERE a.id = :id AND p.client_id = :reporterId`,
      { id: uuidToBuf(input.targetId), reporterId: uuidToBuf(reporterId) },
    );
    if (Number(receiver?.cnt ?? 0) === 0) throw notFound("That item does not exist.");
  }

  const id = newId();
  try {
    await db.run(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details)
       VALUES (:id, :reporterId, :targetType, :targetId, :reason, :details)`,
      {
        id: uuidToBuf(id),
        reporterId: uuidToBuf(reporterId),
        targetType: input.targetType,
        targetId: uuidToBuf(input.targetId),
        reason: input.reason,
        details: input.details ?? null,
      },
    );
  } catch (error) {
    if (error instanceof DbError && error.isUniqueViolation) {
      throw conflict("You have already reported this.");
    }
    throw error;
  }

  return { id };
}
