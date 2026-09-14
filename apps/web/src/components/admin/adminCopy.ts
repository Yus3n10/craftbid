import type { ModerationAction, UserStatus } from "@craftbid/shared";

export const ACTION_LABEL: Record<ModerationAction, string> = {
  warn: "Warned",
  suspend: "Suspended",
  unsuspend: "Unsuspended",
  remove_account: "Removed account",
  remove_post: "Removed post",
  remove_posting: "Removed request",
  remove_comment: "Removed comment",
  resolve_report: "Resolved report",
  dismiss_report: "Dismissed report",
  resolve_bug: "Resolved bug report",
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  deleted: "Removed",
};

export const REPORT_REASON_LABEL: Record<string, string> = {
  harassment: "Bullying or harassment",
  inappropriate: "Sexual or inappropriate",
  scam: "Scam or fraud",
  stolen_work: "Stolen work",
  spam: "Spam",
  other: "Something else",
};

export const TARGET_LABEL: Record<"artist_post" | "posting" | "comment" | "user" | "application", string> = {
  artist_post: "Post",
  posting: "Request",
  comment: "Comment",
  user: "Profile",
  application: "Bid",
};

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
