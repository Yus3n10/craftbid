import type {
  ArtistPostDto,
  CreateArtistPostInput,
  Paginated,
} from "@craftbid/shared";
import { LIMITS } from "@craftbid/shared";
import { newId } from "../../db/ids.js";
import { withTransaction } from "../../db/query.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import * as imagesRepo from "../images/images.repository.js";
import * as repo from "./posts.repository.js";
import * as social from "../social/social.repository.js";

async function assertOwnsImages(ids: string[], ownerId: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const owned = await imagesRepo.findOwnedByIds(unique, ownerId);
  if (owned.length !== unique.length) {
    // Without this an artist could pass another artist's image id and present
    // their work as their own.
    throw forbidden("One of those images does not belong to you.");
  }
}

export async function createPost(
  artistId: string,
  input: CreateArtistPostInput,
): Promise<ArtistPostDto> {
  if (input.imageIds.length > LIMITS.artistPostImages.max) {
    throw badRequest(`A post can have at most ${LIMITS.artistPostImages.max} images.`);
  }
  await assertOwnsImages(input.imageIds, artistId);

  const id = newId();
  await withTransaction(async (tx) => {
    await repo.insertPost(
      {
        id,
        artistId,
        caption: input.caption,
        ...(input.description ? { description: input.description } : {}),
        ...(input.categorySlug ? { categorySlug: input.categorySlug } : {}),
      },
      tx,
    );
    await repo.attachImages(id, input.imageIds, tx);
  });

  const post = await repo.findById(id);
  if (!post) throw notFound();
  // A newly created post has no reactions yet, but it still has to come back
  // shaped like every other post or the client has to special-case it.
  const [decorated] = await social.decorate([post], artistId);
  return decorated!;
}

export async function getPost(
  id: string,
  viewerId: string | null = null,
): Promise<ArtistPostDto> {
  const post = await repo.findById(id);
  if (!post) throw notFound("That post does not exist.");
  const [decorated] = await social.decorate([post], viewerId);
  return decorated!;
}

export async function listPosts(
  filter: {
    artist?: string;
    category?: string;
    limit: number;
    offset: number;
  },
  viewerId: string | null = null,
): Promise<Paginated<ArtistPostDto>> {
  const { items, total } = await repo.list({
    ...(filter.artist ? { artistUsername: filter.artist } : {}),
    ...(filter.category ? { categorySlug: filter.category } : {}),
    limit: filter.limit,
    offset: filter.offset,
  });
  return {
    items: await social.decorate(items, viewerId),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

/**
 * The feed.
 *
 * Same posts as the discovery list, but able to narrow to what the reader
 * saved, which is the one view that cannot be served from the public listing
 * because it depends on who is asking.
 */
export async function feed(
  filter: { category?: string; saved?: boolean; limit: number; offset: number },
  viewerId: string | null,
): Promise<Paginated<ArtistPostDto>> {
  if (!filter.saved) {
    return listPosts(
      {
        ...(filter.category ? { category: filter.category } : {}),
        limit: filter.limit,
        offset: filter.offset,
      },
      viewerId,
    );
  }

  if (!viewerId) {
    return { items: [], total: 0, limit: filter.limit, offset: filter.offset };
  }

  const { ids, total } = await social.savedPostIds(
    viewerId,
    filter.limit,
    filter.offset,
  );

  // Loaded one at a time and then re-ordered, because the ordering that
  // matters here is when the reader saved it, not when it was posted.
  const loaded = await Promise.all(ids.map((id) => repo.findById(id)));
  const items = loaded.filter((post): post is repo.UndecoratedPost => post !== null);

  return {
    items: await social.decorate(items, viewerId),
    total,
    limit: filter.limit,
    offset: filter.offset,
  };
}

async function loadOwned(postId: string, artistId: string) {
  const owner = await repo.findOwner(postId);
  if (!owner || owner.artistId !== artistId || owner.status === "removed") {
    throw notFound("That post does not exist.");
  }
  return owner;
}

export async function updatePost(
  postId: string,
  artistId: string,
  input: Partial<CreateArtistPostInput>,
): Promise<ArtistPostDto> {
  await loadOwned(postId, artistId);

  if (input.imageIds) {
    if (input.imageIds.length === 0) {
      throw badRequest("A post needs at least one image.");
    }
    if (input.imageIds.length > LIMITS.artistPostImages.max) {
      throw badRequest(`A post can have at most ${LIMITS.artistPostImages.max} images.`);
    }
    await assertOwnsImages(input.imageIds, artistId);
  }

  await withTransaction(async (tx) => {
    await repo.updatePost(
      postId,
      {
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.description !== undefined
          ? { description: input.description ?? null }
          : {}),
        ...(input.categorySlug !== undefined
          ? { categorySlug: input.categorySlug }
          : {}),
      },
      tx,
    );
    if (input.imageIds) {
      await repo.attachImages(postId, input.imageIds, tx);
    }
  });

  const post = await repo.findById(postId);
  if (!post) throw notFound();
  const [decorated] = await social.decorate([post], artistId);
  return decorated!;
}

export async function deletePost(postId: string, artistId: string): Promise<void> {
  await loadOwned(postId, artistId);
  await withTransaction((tx) => repo.removePost(postId, tx));
}
