import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import { newId } from "../db/ids.js";
import { db } from "../db/query.js";
import { setStorage, type ObjectStorage } from "../lib/storage/index.js";

/**
 * Integration tests run against the real Oracle in docker-compose, never a
 * mock. The constraints being tested here (the partial unique index, the
 * minimum-price CHECK, the composite uniques) exist only in the database, so a
 * mocked repository would assert nothing about the behaviour that matters.
 */

/** Storage is faked: the tests are about records, not bytes on disk. */
const memoryStorage: ObjectStorage = {
  name: "memory",
  async put() {},
  async remove() {},
  urlFor: (key) => `https://test.local/${key}`,
};

let app: FastifyInstance | undefined;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!app) {
    setStorage(memoryStorage);
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeTestApp(): Promise<void> {
  await app?.close();
  app = undefined;
}

/**
 * Deletes every row while leaving the schema and the seeded categories.
 *
 * Order matters: children before parents. USERS and IMAGES reference each
 * other, so the avatar and cover columns are nulled before either is emptied.
 */
export async function resetData(): Promise<void> {
  const statements = [
    `DELETE FROM reviews`,
    `DELETE FROM application_samples`,
    `DELETE FROM commissions`,
    `DELETE FROM applications`,
    `DELETE FROM posting_images`,
    `DELETE FROM postings`,
    `DELETE FROM artist_post_images`,
    `DELETE FROM artist_posts`,
    `DELETE FROM notifications`,
    `DELETE FROM reports`,
    `DELETE FROM external_links`,
    `DELETE FROM artist_skills`,
    `DELETE FROM artist_categories`,
    `DELETE FROM artist_profiles`,
    `DELETE FROM refresh_tokens`,
    `UPDATE users SET avatar_image_id = NULL, cover_image_id = NULL`,
    `DELETE FROM images`,
    `DELETE FROM users`,
  ];
  for (const statement of statements) {
    await db.run(statement);
  }
}

export interface Session {
  id: string;
  username: string;
  token: string;
  role: "client" | "artist";
}

let counter = 0;

/** Registers a user and returns a session with a bearer token. */
export async function registerUser(
  role: "client" | "artist",
  overrides: Partial<{ username: string; email: string; displayName: string }> = {},
): Promise<Session> {
  const instance = await getTestApp();
  counter += 1;
  const username = overrides.username ?? `${role}${counter}test`;

  const response = await instance.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: overrides.email ?? `${username}@example.com`,
      username,
      password: "a sufficiently long password",
      displayName: overrides.displayName ?? `Test ${role} ${counter}`,
      role,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`registerUser failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as {
    user: { id: string; username: string };
    accessToken: string;
  };
  return { id: body.user.id, username: body.user.username, token: body.accessToken, role };
}

export function authHeaders(session: Session): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

/**
 * Inserts an image row directly, attributed to the given owner.
 *
 * Going around the upload route on purpose: these tests are about who may
 * attach an image, not about decoding one. Upload validation has its own tests.
 */
export async function seedImage(ownerId: string): Promise<string> {
  const { uuidToBuf } = await import("../db/ids.js");
  const id = newId();
  await db.run(
    `INSERT INTO images (id, owner_id, object_key, content_type, byte_size, width, height)
     VALUES (:id, :ownerId, :key, 'image/webp', 1024, 800, 600)`,
    {
      id: uuidToBuf(id),
      ownerId: uuidToBuf(ownerId),
      key: `${ownerId}/${id}.webp`,
    },
  );
  return id;
}

export interface PostingOptions {
  minBudgetCentavos?: number;
  categorySlug?: string;
  title?: string;
  imageIds?: string[];
}

export async function createPosting(
  client: Session,
  options: PostingOptions = {},
): Promise<{ id: string; minBudgetCentavos: number }> {
  const instance = await getTestApp();
  const response = await instance.inject({
    method: "POST",
    url: "/postings",
    headers: authHeaders(client),
    payload: {
      title: options.title ?? "Custom Crochet Wedding Bouquet",
      description:
        "I would like a handmade crochet bouquet for my wedding, white roses with light blue accents.",
      categorySlug: options.categorySlug ?? "crochet",
      minBudgetCentavos: options.minBudgetCentavos ?? 150_000,
      imageIds: options.imageIds ?? [],
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createPosting failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { id: string; minBudgetCentavos: number };
  return { id: body.id, minBudgetCentavos: body.minBudgetCentavos };
}

export async function applyToPosting(
  artist: Session,
  postingId: string,
  proposedPriceCentavos: number,
  samplePostIds: string[] = [],
): Promise<LightMyRequestResponse> {
  const instance = await getTestApp();
  return instance.inject({
    method: "POST",
    url: `/postings/${postingId}/applications`,
    headers: authHeaders(artist),
    payload: {
      proposedPriceCentavos,
      coverLetter:
        "I have made several bridal bouquets in this style and would love to make yours.",
      samplePostIds,
    },
  });
}

export async function createArtistPost(artist: Session, caption = "Bridal bouquet") {
  const instance = await getTestApp();
  const imageId = await seedImage(artist.id);
  const response = await instance.inject({
    method: "POST",
    url: "/posts",
    headers: authHeaders(artist),
    payload: { caption, categorySlug: "crochet", imageIds: [imageId] },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createArtistPost failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as { id: string };
}

/** Runs a posting all the way to a completed commission. */
export async function completeCommission(client: Session, artist: Session) {
  const instance = await getTestApp();
  const posting = await createPosting(client);
  const application = await applyToPosting(artist, posting.id, 200_000);
  const applicationId = (application.json() as { id: string }).id;

  await instance.inject({
    method: "POST",
    url: `/applications/${applicationId}/accept`,
    headers: authHeaders(client),
  });

  const postingAfter = await instance.inject({
    method: "GET",
    url: `/postings/${posting.id}`,
    headers: authHeaders(client),
  });
  const commissionId = (postingAfter.json() as { commissionId: string }).commissionId;

  await instance.inject({
    method: "POST",
    url: `/commissions/${commissionId}/complete`,
    headers: authHeaders(client),
  });

  return { postingId: posting.id, applicationId, commissionId };
}
