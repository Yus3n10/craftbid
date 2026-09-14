import { bugReportFieldsSchema } from "@craftbid/shared";
import { newId } from "../../db/ids.js";
import { badRequest } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import { normaliseImage } from "../images/images.service.js";
import * as repo from "./bug-reports.repository.js";

const TOO_SHORT = "Say what went wrong in at least a sentence.";

export async function create(
  reporterId: string,
  fields: Record<string, string>,
  screenshot: Buffer | null,
): Promise<{ id: string }> {
  const parsed = bugReportFieldsSchema.safeParse(fields);
  if (!parsed.success) throw badRequest(TOO_SHORT, { description: TOO_SHORT });

  const id = newId();
  const storage = getStorage();
  let screenshotKey: string | null = null;
  if (screenshot) {
    // Re-encoded like every upload, which drops EXIF and anything hidden in
    // the file, and private, because a screenshot can show someone's details.
    const image = await normaliseImage(screenshot);
    screenshotKey = `bug-reports/${id}.webp`;
    await storage.putPrivate(screenshotKey, image.data, "image/webp");
  }

  try {
    await repo.insert({ id, reporterId, ...parsed.data, screenshotKey });
  } catch (error) {
    if (screenshotKey) await storage.removePrivate(screenshotKey).catch(() => {});
    throw error;
  }
  return { id };
}
