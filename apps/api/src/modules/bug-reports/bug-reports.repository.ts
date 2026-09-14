import { uuidToBuf } from "../../db/ids.js";
import { db } from "../../db/query.js";

export async function insert(input: {
  id: string;
  reporterId: string;
  description: string;
  pageUrl?: string;
  userAgent?: string;
  screenshotKey: string | null;
}): Promise<void> {
  await db.run(
    `INSERT INTO bug_reports (id, reporter_id, description, page_url, user_agent, screenshot_key)
     VALUES (:id, :reporterId, :description, :pageUrl, :userAgent, :screenshotKey)`,
    {
      id: uuidToBuf(input.id),
      reporterId: uuidToBuf(input.reporterId),
      description: input.description,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
      screenshotKey: input.screenshotKey,
    },
  );
}
