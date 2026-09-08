import type {
  CreatePostingInput,
  Paginated,
  PostingDto,
  PostingListQuery,
  UpdatePostingInput,
} from "@raxtan/shared";
import { LIMITS } from "@raxtan/shared";
import { newId } from "../../db/ids.js";
import { withTransaction } from "../../db/query.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import * as imagesRepo from "../images/images.repository.js";
import type { AuthUser } from "../../plugins/auth.plugin.js";
import * as repo from "./postings.repository.js";

async function assertOwnsImages(ids: string[], ownerId: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const owned = await imagesRepo.findOwnedByIds(unique, ownerId);
  if (owned.length !== unique.length) {
    throw forbidden("One of those images does not belong to you.");
  }
}

export async function createPosting(
  clientId: string,
  input: CreatePostingInput,
): Promise<PostingDto> {
  if (input.imageIds.length > LIMITS.postingImages.max) {
    throw badRequest(`A posting can have at most ${LIMITS.postingImages.max} images.`);
  }
  await assertOwnsImages(input.imageIds, clientId);

  const id = newId();
  await withTransaction(async (tx) => {
    await repo.insertPosting(
      {
        id,
        clientId,
        title: input.title,
        description: input.description,
        categorySlug: input.categorySlug,
        minBudgetCentavos: input.minBudgetCentavos,
        ...(input.requirements ? { requirements: input.requirements } : {}),
        ...(input.deadline ? { deadline: input.deadline } : {}),
      },
      tx,
    );
    await repo.attachImages(id, input.imageIds, tx);
  });

  const posting = await repo.findById(id);
  if (!posting) throw notFound();
  return posting;
}

export async function getPosting(
  id: string,
  viewer?: AuthUser,
): Promise<PostingDto> {
  const posting = await repo.findById(id);
  if (!posting) throw notFound("That posting does not exist.");

  // Tells an artist's UI whether to offer "Apply" or link to their existing
  // application, without a second round trip.
  if (viewer?.role === "artist") {
    const applicationId = await repo.findViewerApplicationId(id, viewer.id);
    if (applicationId) posting.viewerApplicationId = applicationId;
  }

  // The commission id is private to the two parties; it is the key to the
  // private commission record.
  const isParticipant =
    viewer?.id === posting.client.id ||
    (viewer !== undefined && posting.viewerApplicationId !== undefined);
  if (!isParticipant) {
    delete posting.commissionId;
  }

  return posting;
}

export async function listPostings(
  query: PostingListQuery & { clientId?: string },
): Promise<Paginated<PostingDto>> {
  const { items, total } = await repo.list(query);
  return { items, total, limit: query.limit, offset: query.offset };
}

/**
 * Loads a posting and confirms the caller owns it.
 *
 * Returns 404 rather than 403 for someone else's posting id, so the endpoint
 * cannot be used to test whether an id exists.
 */
async function loadOwned(postingId: string, clientId: string) {
  const posting = await repo.findOwnership(postingId);
  if (!posting) throw notFound("That posting does not exist.");
  if (posting.clientId !== clientId) throw notFound("That posting does not exist.");
  return posting;
}

export async function updatePosting(
  postingId: string,
  clientId: string,
  input: UpdatePostingInput,
): Promise<PostingDto> {
  const existing = await loadOwned(postingId, clientId);

  if (existing.status !== "open") {
    throw badRequest(
      "This posting can no longer be edited because an artist has already been selected.",
    );
  }

  if (input.minBudgetCentavos !== undefined) {
    // Artists priced their bids against the advertised minimum. Moving it after
    // the fact would invalidate offers that were made in good faith.
    const applications = await repo.countApplications(postingId);
    if (applications > 0 && input.minBudgetCentavos !== existing.minBudgetCentavos) {
      throw badRequest(
        "The minimum budget cannot be changed once artists have applied.",
        { minBudgetCentavos: "Artists have already applied at the current minimum." },
      );
    }
  }

  if (input.imageIds) {
    if (input.imageIds.length > LIMITS.postingImages.max) {
      throw badRequest(`A posting can have at most ${LIMITS.postingImages.max} images.`);
    }
    await assertOwnsImages(input.imageIds, clientId);
  }

  await withTransaction(async (tx) => {
    await repo.updatePosting(
      postingId,
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categorySlug !== undefined ? { categorySlug: input.categorySlug } : {}),
        ...(input.minBudgetCentavos !== undefined
          ? { minBudgetCentavos: input.minBudgetCentavos }
          : {}),
        ...(input.requirements !== undefined
          ? { requirements: input.requirements ?? null }
          : {}),
        ...(input.deadline !== undefined ? { deadline: input.deadline ?? null } : {}),
      },
      tx,
    );
    if (input.imageIds) {
      await repo.attachImages(postingId, input.imageIds, tx);
    }
  });

  const updated = await repo.findById(postingId);
  if (!updated) throw notFound();
  return updated;
}

export async function cancelPosting(
  postingId: string,
  clientId: string,
): Promise<PostingDto> {
  const existing = await loadOwned(postingId, clientId);

  if (existing.status === "completed") {
    throw badRequest("A completed posting cannot be cancelled.");
  }
  if (existing.status === "cancelled") {
    throw badRequest("This posting is already cancelled.");
  }

  await withTransaction(async (tx) => {
    await repo.setStatus(postingId, "cancelled", tx);
    // Accepted applications are left alone: cancelling mid-commission is
    // handled through the commission, which owns that state.
    await repo.rejectPendingApplications(postingId, tx);
  });

  const updated = await repo.findById(postingId);
  if (!updated) throw notFound();
  return updated;
}
