import type {
  ApplicationDto,
  ApplicationStatus,
  CreateApplicationInput,
  Paginated,
} from "@craftbid/shared";
import {
  formatPeso,
  DOWN_PAYMENT_PERCENT,
  splitDownPayment,
} from "@craftbid/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { DbError, withTransaction } from "../../db/query.js";
import { recordInterest } from "../interests/interests.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import * as commissionsRepo from "../commissions/commissions.repository.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as repo from "./applications.repository.js";
import * as users from "../users/users.repository.js";

/**
 * Submits a bid.
 *
 * A bid may be below the client's starting budget, but then it must say why.
 * That is decided against the posting row read inside the transaction, so a
 * concurrent edit cannot slip past, and a CHECK constraint on the row holds the
 * same rule, so no future code path can store a lower bid without a reason.
 */
export async function apply(
  postingId: string,
  artistId: string,
  input: CreateApplicationInput,
): Promise<ApplicationDto> {
  const id = newId();

  try {
    await withTransaction(async (tx) => {
      const posting = await postingsRepo.findOwnership(postingId, tx);
      if (!posting) throw notFound("That posting does not exist.");

      if (posting.status !== "open") {
        throw badRequest("This posting is no longer accepting applications.");
      }

      // A suspended client's request stays up but takes no bids until the
      // suspension is lifted.
      const owner = await users.findById(posting.clientId, tx);
      if (owner?.status !== "active") {
        throw badRequest("This request is paused and is not taking bids right now.");
      }

      const below = input.proposedPriceCentavos < posting.minBudgetCentavos;
      if (below && !input.belowBudgetReason) {
        const message = `Your price is below the client's starting budget of ${formatPeso(
          posting.minBudgetCentavos,
        )}. Tell them why.`;
        throw badRequest(message, { belowBudgetReason: message });
      }

      await repo.insertApplication(
        {
          id,
          postingId,
          artistId,
          proposedPriceCentavos: input.proposedPriceCentavos,
          // Copied so the bid is judged against the starting budget that
          // was advertised when it was made.
          minPriceAtApplyCentavos: posting.minBudgetCentavos,
          // Dropped at or above the budget: a reason typed before raising the
          // price explains nothing about the price that was sent.
          belowBudgetReason: below ? input.belowBudgetReason! : null,
          coverLetter: input.coverLetter,
        },
        tx,
      );

      await repo.attachSamples(id, input.samplePostIds, artistId, tx);

      await notifications.notify(
        {
          userId: posting.clientId,
          type: "application_received",
          payload: { postingId, applicationId: id },
        },
        tx,
      );
    });
  } catch (error) {
    if (error instanceof DbError && error.isUniqueViolation) {
      if (error.constraintName === "UQ_APPLICATIONS_POSTING_ARTIST") {
        throw conflict("You have already applied to this posting.");
      }
    }
    throw error;
  }
  await recordInterest(artistId, "bid", { postingId });

  const application = await repo.findById(id);
  if (!application) throw notFound();
  return application;
}

/**
 * Loads an application and confirms the caller is the client who owns the
 * posting it was submitted to.
 */
async function loadForClient(applicationId: string, clientId: string) {
  const context = await repo.findContext(applicationId);
  // 404 rather than 403: a 403 would confirm the id belongs to a real
  // application on someone else's posting.
  if (!context || context.clientId !== clientId) {
    throw notFound("That application does not exist.");
  }
  return context;
}

/**
 * Accepts one application and settles everything that follows from it, in a
 * single transaction: the other bids are declined, a commission opens, and the
 * posting stops accepting applications. A partial version of this state, such
 * as an accepted bid with the posting still open, would let a second artist
 * apply to work already awarded.
 */
export async function accept(
  applicationId: string,
  clientId: string,
): Promise<ApplicationDto> {
  const context = await loadForClient(applicationId, clientId);

  if (context.status !== "pending") {
    throw badRequest(`This application has already been ${context.status}.`);
  }
  if (context.postingStatus !== "open") {
    throw badRequest("An artist has already been selected for this posting.");
  }

  const bidder = await users.findById(context.artistId);
  if (bidder?.status !== "active") {
    throw badRequest("This artist's account is paused, so their bid cannot be accepted right now.");
  }

  try {
    await withTransaction(async (tx) => {
      // Both checks above were read before this transaction. Claiming the bid
      // and the request here, conditionally, is what stops a withdrawal or a
      // decline that lands in between from being overwritten.
      //
      // The request row first, then bids: cancelling a request locks in the
      // same order, and the opposite order deadlocked the two.
      if (!(await postingsRepo.transitionStatus(context.postingId, "open", "in_progress", tx))) {
        throw conflict("This request is no longer open. Refresh to see where it stands.");
      }
      if (!(await repo.transitionStatus(applicationId, "pending", "accepted", tx))) {
        throw conflict("This bid changed a moment ago. Refresh to see where it stands.");
      }

      // Collected before they are rejected, so each artist can be told.
      const losingArtists = await tx.many<{ artistId: Buffer }>(
        `SELECT artist_id FROM applications
          WHERE posting_id = :postingId AND status = 'pending' AND id <> :id`,
        {
          postingId: uuidToBuf(context.postingId),
          id: uuidToBuf(applicationId),
        },
      );

      await postingsRepo.rejectPendingApplications(
        context.postingId,
        tx,
        applicationId,
      );

      const commissionId = newId();
      await commissionsRepo.insertCommission(
        {
          id: commissionId,
          postingId: context.postingId,
          applicationId,
          clientId,
          artistId: context.artistId,
          agreedPriceCentavos: context.proposedPriceCentavos,
          payment: splitDownPayment(context.proposedPriceCentavos, DOWN_PAYMENT_PERCENT),
        },
        tx,
      );

      await notifications.notify(
        {
          userId: context.artistId,
          type: "application_accepted",
          payload: { postingId: context.postingId, applicationId, commissionId },
        },
        tx,
      );

      for (const row of losingArtists) {
        await notifications.notify(
          {
            userId: bufToUuid(row.artistId)!,
            type: "application_rejected",
            payload: { postingId: context.postingId },
          },
          tx,
        );
      }
    });
  } catch (error) {
    // The partial unique index is the last line of defence against two
    // simultaneous accepts on the same posting.
    if (
      error instanceof DbError &&
      error.isUniqueViolation &&
      (error.constraintName === "UX_APPLICATIONS_ONE_ACCEPTED" ||
        error.constraintName === "UQ_COMMISSIONS_POSTING")
    ) {
      throw conflict("An artist has already been selected for this posting.");
    }
    throw error;
  }

  const application = await repo.findById(applicationId);
  if (!application) throw notFound();
  return application;
}

export async function reject(
  applicationId: string,
  clientId: string,
): Promise<ApplicationDto> {
  const context = await loadForClient(applicationId, clientId);

  if (context.status !== "pending") {
    throw badRequest(`This application has already been ${context.status}.`);
  }

  await withTransaction(async (tx) => {
    if (!(await repo.transitionStatus(applicationId, "pending", "rejected", tx))) {
      throw conflict("This bid changed a moment ago. Refresh to see where it stands.");
    }
    await notifications.notify(
      {
        userId: context.artistId,
        type: "application_rejected",
        payload: { postingId: context.postingId, applicationId },
      },
      tx,
    );
  });

  const application = await repo.findById(applicationId);
  if (!application) throw notFound();
  return application;
}

export async function withdraw(
  applicationId: string,
  artistId: string,
): Promise<ApplicationDto> {
  const context = await repo.findContext(applicationId);
  if (!context || context.artistId !== artistId) {
    throw notFound("That application does not exist.");
  }

  if (context.status === "accepted") {
    throw badRequest(
      "This application was accepted. Cancel the commission instead of withdrawing.",
    );
  }
  if (context.status !== "pending") {
    throw badRequest(`This application has already been ${context.status}.`);
  }

  await withTransaction(async (tx) => {
    if (!(await repo.transitionStatus(applicationId, "pending", "withdrawn", tx))) {
      throw conflict("This bid changed a moment ago. Refresh to see where it stands.");
    }
  });

  const application = await repo.findById(applicationId);
  if (!application) throw notFound();
  return application;
}

/** The applications on a posting. Visible only to the client who posted it. */
export async function listForPosting(
  postingId: string,
  clientId: string,
  options: { status?: ApplicationStatus; limit: number; offset: number },
): Promise<Paginated<ApplicationDto>> {
  const posting = await postingsRepo.findOwnership(postingId);
  if (!posting) throw notFound("That posting does not exist.");
  if (posting.clientId !== clientId) {
    throw forbidden("Only the client who created this posting can see its applications.");
  }

  const { items, total } = await repo.listForPosting(postingId, options);
  return { items, total, limit: options.limit, offset: options.offset };
}

export async function listMine(
  artistId: string,
  options: { status?: ApplicationStatus; limit: number; offset: number },
): Promise<Paginated<ApplicationDto>> {
  const { items, total } = await repo.listForArtist(artistId, options);
  return { items, total, limit: options.limit, offset: options.offset };
}

export async function getApplication(
  applicationId: string,
  viewer: { id: string; role: string },
): Promise<ApplicationDto> {
  const context = await repo.findContext(applicationId);
  if (!context) throw notFound("That application does not exist.");

  // Only the two parties to a bid can read it: its price and cover letter are
  // competitive information.
  const allowed =
    context.artistId === viewer.id || context.clientId === viewer.id;
  if (!allowed) throw notFound("That application does not exist.");

  const application = await repo.findById(applicationId);
  if (!application) throw notFound();
  return application;
}
