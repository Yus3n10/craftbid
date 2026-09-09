import type { CreateReportInput, ReportTargetType } from "@craftbid/shared";
import { newId, uuidToBuf } from "../../db/ids.js";
import { DbError, db } from "../../db/query.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";

/**
 * Somewhere for abuse reports to land.
 *
 * Deliberately not a moderation system: there is no queue tooling, no
 * automated action, and no appeals flow. The brief asked for sensible
 * extension points rather than an anti-fraud platform, and a table plus an
 * endpoint is what a human reviewer needs to start from.
 */
const TARGET_TABLES: Record<ReportTargetType, string> = {
  posting: "postings",
  user: "users",
  artist_post: "artist_posts",
  application: "applications",
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
