import type {
  ApplicationDto,
  ApplicationStatus,
  CreateApplicationInput,
  Paginated,
} from "@raxtan/shared";
import { formatPeso } from "@raxtan/shared";
import { bufToUuid, newId, uuidToBuf } from "../../db/ids.js";
import { DbError, withTransaction } from "../../db/query.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import * as commissionsRepo from "../commissions/commissions.repository.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as repo from "./applications.repository.js";

/**
 * Submits a bid.
 *
 * The minimum-price rule is checked three times over, deliberately. Here for a
 * readable error; again against the posting row read inside the transaction, so
 * a concurrent edit cannot slip past; and finally by a CHECK constraint on the
 * row itself, which is the only one that cannot be bypassed by a future code
 * path that forgets the rule.
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

      if (input.proposedPriceCentavos < posting.minBudgetCentavos) {
        throw badRequest(
          `Your price must be at least ${formatPeso(posting.minBudgetCentavos)}.`,
          {
            proposedPriceCentavos: `The client's minimum is ${formatPeso(
              posting.minBudgetCentavos,
            )}.`,
          },
        );
      }

      await repo.insertApplication(
        {
          id,
          postingId,
          artistId,
          proposedPriceCentavos: input.proposedPriceCentavos,
          // Copied so the bid stays valid against the minimum that was
          // advertised when it was made.
          minPriceAtApplyCentavos: posting.minBudgetCentavos,
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

  try {
    await withTransaction(async (tx) => {
      // Collected before they are rejected, so each artist can be told.
      const losingArtists = await tx.many<{ artistId: Buffer }>(
        `SELECT artist_id FROM applications
          WHERE posting_id = :postingId AND status = 'pending' AND id <> :id`,
        {
          postingId: uuidToBuf(context.postingId),
          id: uuidToBuf(applicationId),
        },
      );

      await repo.setStatus(applicationId, "accepted", tx);
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
        },
        tx,
      );

      await postingsRepo.setStatus(context.postingId, "in_progress", tx);

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
    await repo.setStatus(applicationId, "rejected", tx);
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

  await withTransaction((tx) => repo.setStatus(applicationId, "withdrawn", tx));

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
