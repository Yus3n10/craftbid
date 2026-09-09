import type {
  CommissionDto,
  CommissionStatus,
  CreateReviewInput,
  Paginated,
  ReviewDto,
} from "@craftbid/shared";
import { newId } from "../../db/ids.js";
import { DbError, withTransaction } from "../../db/query.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as reviewsRepo from "../reviews/reviews.repository.js";
import * as repo from "./commissions.repository.js";

/**
 * A commission is private to its two parties. Anyone else asking for it by id
 * gets a 404, which also avoids confirming that the id is real.
 */
async function loadParticipant(commissionId: string, userId: string) {
  const context = await repo.findContext(commissionId);
  if (!context) throw notFound("That commission does not exist.");
  if (context.clientId !== userId && context.artistId !== userId) {
    throw notFound("That commission does not exist.");
  }
  return context;
}

export async function getCommission(
  commissionId: string,
  userId: string,
): Promise<CommissionDto> {
  await loadParticipant(commissionId, userId);
  const commission = await repo.findById(commissionId, userId);
  if (!commission) throw notFound("That commission does not exist.");
  return commission;
}

export async function listMine(
  userId: string,
  options: { status?: CommissionStatus; limit: number; offset: number },
): Promise<Paginated<CommissionDto>> {
  const { items, total } = await repo.listForUser(userId, options);
  return { items, total, limit: options.limit, offset: options.offset };
}

/**
 * The client marks the work delivered.
 *
 * Only the client can, because they are the one who can tell whether they
 * received what they paid for. Completing also closes the posting and is what
 * unlocks reviews for both sides.
 */
export async function complete(
  commissionId: string,
  userId: string,
): Promise<CommissionDto> {
  const context = await loadParticipant(commissionId, userId);

  if (context.clientId !== userId) {
    throw badRequest("Only the client can mark a commission as complete.");
  }
  if (context.status !== "active") {
    throw badRequest(`This commission is already ${context.status}.`);
  }

  await withTransaction(async (tx) => {
    await repo.complete(commissionId, tx);
    await postingsRepo.setStatus(context.postingId, "completed", tx);
    await notifications.notify(
      {
        userId: context.artistId,
        type: "commission_completed",
        payload: { commissionId, postingId: context.postingId },
      },
      tx,
    );
  });

  return getCommission(commissionId, userId);
}

/**
 * Either party can call off an active commission. The posting is closed rather
 * than reopened: the other applicants were already declined, and silently
 * resurrecting their bids would be worse than asking the client to post again.
 */
export async function cancel(
  commissionId: string,
  userId: string,
): Promise<CommissionDto> {
  const context = await loadParticipant(commissionId, userId);

  if (context.status !== "active") {
    throw badRequest(`This commission is already ${context.status}.`);
  }

  await withTransaction(async (tx) => {
    await repo.cancel(commissionId, tx);
    await postingsRepo.setStatus(context.postingId, "cancelled", tx);
    await notifications.notify(
      {
        userId: context.clientId === userId ? context.artistId : context.clientId,
        type: "commission_completed",
        payload: { commissionId, cancelled: true },
      },
      tx,
    );
  });

  return getCommission(commissionId, userId);
}

/**
 * Writes a review.
 *
 * Eligibility is narrow on purpose: you must have been one of the two parties
 * to a commission that actually completed, and you get one review. That makes a
 * rating impossible to manufacture without a real, finished piece of work
 * behind it, which is the whole basis of the reputation shown on a profile.
 */
export async function createReview(
  commissionId: string,
  reviewerId: string,
  input: CreateReviewInput,
): Promise<ReviewDto> {
  const context = await loadParticipant(commissionId, reviewerId);

  if (context.status !== "completed") {
    throw badRequest("You can only leave a review once the commission is complete.");
  }

  const revieweeId =
    context.clientId === reviewerId ? context.artistId : context.clientId;

  const id = newId();
  try {
    await withTransaction(async (tx) => {
      await reviewsRepo.insertReview(
        {
          id,
          commissionId,
          reviewerId,
          revieweeId,
          rating: input.rating,
          ...(input.body ? { body: input.body } : {}),
        },
        tx,
      );
      await notifications.notify(
        {
          userId: revieweeId,
          type: "review_received",
          payload: { commissionId, reviewId: id },
        },
        tx,
      );
    });
  } catch (error) {
    if (
      error instanceof DbError &&
      error.isUniqueViolation &&
      error.constraintName === "UQ_REVIEWS_COMMISSION_REVIEWER"
    ) {
      throw conflict("You have already reviewed this commission.");
    }
    throw error;
  }

  const commission = await repo.findById(commissionId, reviewerId);
  const review = commission?.reviews.find((r) => r.id === id);
  if (!review) throw notFound();
  return review;
}
