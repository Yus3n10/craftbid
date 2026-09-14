import { INTEREST_WEIGHTS, type InterestSignal } from "@craftbid/shared";
import { DbError } from "../../db/query.js";
import * as repo from "./interests.repository.js";

export type InterestSubject =
  | { postId: string }
  | { shareId: string }
  | { postingId: string }
  | { categorySlugs: readonly string[] };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof DbError && error.isUniqueViolation;
}

async function bump(userId: string, subject: InterestSubject, weight: number): Promise<void> {
  if ("postId" in subject) return repo.bumpTarget(userId, "post", subject.postId, weight);
  if ("shareId" in subject) return repo.bumpTarget(userId, "share", subject.shareId, weight);
  if ("postingId" in subject) return repo.bumpTarget(userId, "posting", subject.postingId, weight);
  return repo.bumpSlugs(userId, subject.categorySlugs, weight);
}

/**
 * Notes that someone showed interest in a craft, for ordering their own feed.
 *
 * Called after the action it follows has succeeded, and it never throws: a
 * reaction or a bid must not fail because a ranking hint could not be written.
 * Two first-time bumps of the same craft at once can both take MERGE's insert
 * branch, so a duplicate-key error is retried once, when the row exists.
 */
export async function recordInterest(
  userId: string,
  signal: InterestSignal,
  subject: InterestSubject,
): Promise<void> {
  const weight = INTEREST_WEIGHTS[signal];
  try {
    try {
      await bump(userId, subject, weight);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await bump(userId, subject, weight);
    }
  } catch (error) {
    console.error("Interest was not recorded", error);
  }
}

/**
 * Opening a craft's list, counted on its first page only, so paging through
 * one craft is one signal rather than one per page.
 */
export async function noteBrowsing(
  userId: string | undefined,
  categorySlug: string | undefined,
  offset: number,
): Promise<void> {
  if (!userId || !categorySlug || offset !== 0) return;
  await recordInterest(userId, "browse", { categorySlugs: [categorySlug] });
}

export const scoresFor = repo.scores;
