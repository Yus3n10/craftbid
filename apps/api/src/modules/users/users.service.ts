import { AVATAR_CROP, COVER_CROP, fitsCropSpec, type CropSpec } from "@craftbid/shared";
import type {
  MeDto,
  PublicProfileDto,
  UpdateArtistProfileInput,
  UpdateProfileInput,
  ExternalLinkInput,
} from "@craftbid/shared";
import { bufToUuid } from "../../db/ids.js";
import { withTransaction } from "../../db/query.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import * as imagesRepo from "../images/images.repository.js";
import * as repo from "./profiles.repository.js";
import * as usersRepo from "./users.repository.js";
import { emailVerificationEnabled } from "../../lib/mail/index.js";

async function buildProfile(
  row: repo.ProfileRow,
): Promise<PublicProfileDto> {
  const userId = bufToUuid(row.id)!;

  const [links, rating, completedCommissions] = await Promise.all([
    repo.findLinks(userId),
    repo.findRating(userId),
    repo.countCompletedCommissions(userId),
  ]);

  const profile: PublicProfileDto = {
    id: userId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    avatar: repo.imageFrom(row.avatarId, row.avatarKey, row.avatarWidth, row.avatarHeight),
    cover: repo.imageFrom(row.coverId, row.coverKey, row.coverWidth, row.coverHeight),
    createdAt: row.createdAt.toISOString(),
    rating,
    completedCommissions,
    links,
    ...(row.bio ? { bio: row.bio } : {}),
    ...(row.region ? { region: row.region } : {}),
    ...(row.city ? { city: row.city } : {}),
  };

  if (row.role === "artist") {
    const [categories, skills] = await Promise.all([
      repo.findCategories(userId),
      repo.findSkills(userId),
    ]);
    profile.artist = {
      acceptingCommissions: row.acceptingCommissions === 1,
      categories,
      skills,
      ...(row.headline ? { headline: row.headline } : {}),
    };
  }

  return profile;
}

/** The authenticated user's own record. The only place an email is returned. */
export async function getMe(userId: string): Promise<MeDto> {
  const row = await repo.findProfileById(userId);
  if (!row) throw notFound("Account not found.");
  const profile = await buildProfile(row);
  return {
    ...profile,
    email: row.email,
    emailVerified: !emailVerificationEnabled() || row.emailVerifiedAt !== null,
    isStaff: row.isStaff === 1,
  };
}

export async function getPublicProfile(
  username: string,
): Promise<PublicProfileDto> {
  const row = await repo.findProfileByUsername(username);
  if (!row) throw notFound("That profile does not exist.");
  return buildProfile(row);
}

/**
 * Confirms the caller owns every image they are trying to attach.
 *
 * Without this, passing someone else's image id would silently graft their
 * artwork onto your profile or posting.
 */
async function assertOwnsImages(ids: string[], ownerId: string): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const owned = await imagesRepo.findOwnedByIds(unique, ownerId);
  if (owned.length !== unique.length) {
    throw forbidden("One of those images does not belong to you.");
  }
}

/**
 * A new profile picture must be square and a new cover three times as wide as
 * tall, the shapes the editor saves and the profile shows them in, so nothing
 * is stretched or cropped differently from what the person framed. Only a
 * change is checked: a picture already in place from before the editor stays.
 */
async function assertCropShape(userId: string, input: UpdateProfileInput): Promise<void> {
  const current = await usersRepo.findById(userId);
  const checks: { id: string | null | undefined; currentId: string | null | undefined; spec: CropSpec; name: string }[] = [
    { id: input.avatarImageId, currentId: current?.avatarImageId, spec: AVATAR_CROP, name: "profile picture" },
    { id: input.coverImageId, currentId: current?.coverImageId, spec: COVER_CROP, name: "cover photo" },
  ];
  for (const check of checks) {
    if (!check.id || check.id === check.currentId) continue;
    const image = await imagesRepo.findById(check.id);
    if (!image || !fitsCropSpec(image.width, image.height, check.spec)) {
      throw badRequest(`Crop the ${check.name} in the editor before saving it.`);
    }
  }
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<MeDto> {
  const imageIds = [input.avatarImageId, input.coverImageId].filter(
    (id): id is string => typeof id === "string",
  );
  await assertOwnsImages(imageIds, userId);
  await assertCropShape(userId, input);

  await repo.updateProfile(userId, {
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.bio !== undefined ? { bio: input.bio ?? null } : {}),
    ...(input.region !== undefined ? { region: input.region ?? null } : {}),
    ...(input.city !== undefined ? { city: input.city ?? null } : {}),
    ...(input.avatarImageId !== undefined
      ? { avatarImageId: input.avatarImageId ?? null }
      : {}),
    ...(input.coverImageId !== undefined
      ? { coverImageId: input.coverImageId ?? null }
      : {}),
  });

  return getMe(userId);
}

export async function updateArtistProfile(
  userId: string,
  input: UpdateArtistProfileInput,
): Promise<MeDto> {
  await withTransaction(async (tx) => {
    await repo.updateArtistProfile(
      userId,
      {
        ...(input.headline !== undefined ? { headline: input.headline ?? null } : {}),
        ...(input.acceptingCommissions !== undefined
          ? { acceptingCommissions: input.acceptingCommissions }
          : {}),
      },
      tx,
    );
    if (input.categorySlugs) {
      await repo.setCategories(userId, input.categorySlugs, tx);
    }
    if (input.skills) {
      await repo.setSkills(userId, input.skills, tx);
    }
  });

  return getMe(userId);
}

export async function setExternalLinks(
  userId: string,
  links: ExternalLinkInput[],
): Promise<MeDto> {
  // The schema already rejects non-https, but a duplicate platform entry would
  // render as two identical buttons on the profile.
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.platform}:${link.url.toLowerCase()}`;
    if (seen.has(key)) {
      throw badRequest("You have added the same link twice.");
    }
    seen.add(key);
  }

  await withTransaction((tx) =>
    repo.setLinks(
      userId,
      links.map((link) => ({
        platform: link.platform,
        url: link.url,
        ...(link.label ? { label: link.label } : {}),
      })),
      tx,
    ),
  );

  return getMe(userId);
}
