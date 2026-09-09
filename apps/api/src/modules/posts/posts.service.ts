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
  return post;
}

export async function getPost(id: string): Promise<ArtistPostDto> {
  const post = await repo.findById(id);
  if (!post) throw notFound("That post does not exist.");
  return post;
}

export async function listPosts(filter: {
  artist?: string;
  category?: string;
  limit: number;
  offset: number;
}): Promise<Paginated<ArtistPostDto>> {
  const { items, total } = await repo.list({
    ...(filter.artist ? { artistUsername: filter.artist } : {}),
    ...(filter.category ? { categorySlug: filter.category } : {}),
    limit: filter.limit,
    offset: filter.offset,
  });
  return { items, total, limit: filter.limit, offset: filter.offset };
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
  return post;
}

export async function deletePost(postId: string, artistId: string): Promise<void> {
  await loadOwned(postId, artistId);
  await withTransaction((tx) => repo.removePost(postId, tx));
}
