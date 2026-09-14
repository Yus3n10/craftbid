import type { AdminReportDto, AdminUserDetailDto } from "@craftbid/shared";
import { bufToUuid } from "../../db/ids.js";
import { notFound } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import * as repo from "./admin.repository.js";

export const overview = repo.overview;
export const listUsers = repo.listUsers;
export const listBugs = repo.listBugs;

export function listActions(limit: number, offset: number) {
  return repo.listActions(limit, offset);
}

export async function listReports(status: string | undefined, limit: number, offset: number) {
  const { rows, total } = await repo.listReports(status, limit, offset);
  const items: AdminReportDto[] = await Promise.all(
    rows.map(async (row) => ({
      id: bufToUuid(row.id)!,
      targetType: row.targetType,
      targetId: bufToUuid(row.targetId)!,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reporter: { id: bufToUuid(row.reporterId)!, username: row.reporterUsername },
      target: await repo.reportTarget(row.targetType, row.targetId),
      resolution: row.resolvedAt
        ? { note: row.resolutionNote, at: row.resolvedAt.toISOString(), by: row.resolverUsername ?? "" }
        : null,
    })),
  );
  return { items, total };
}

export async function userDetail(id: string): Promise<AdminUserDetailDto> {
  const user = await repo.findUser(id);
  if (!user) throw notFound("That account does not exist.");
  const [history, reportsAgainst, recentContent] = await Promise.all([
    repo.listActions(50, 0, id),
    repo.reportsAgainst(id),
    repo.recentContent(id),
  ]);
  return { ...user, history: history.items, reportsAgainst, recentContent };
}

export async function bugScreenshot(id: string): Promise<Buffer> {
  const key = await repo.bugScreenshotKey(id);
  if (!key) throw notFound("That bug report has no screenshot.");
  const body = await getStorage().getPrivate(key);
  if (!body) throw notFound("That screenshot is no longer stored.");
  return body;
}
