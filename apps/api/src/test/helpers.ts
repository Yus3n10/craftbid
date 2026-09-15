import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import { newId, uuidToBuf } from "../db/ids.js";
import { db } from "../db/query.js";
import { setStorage, type ObjectStorage } from "../lib/storage/index.js";

/**
 * Integration tests run against the real Oracle in docker-compose, never a
 * mock. The constraints being tested here (the partial unique index, the
 * minimum-price CHECK, the composite uniques) exist only in the database, so a
 * mocked repository would assert nothing about the behaviour that matters.
 */

/**
 * Storage is faked, but it keeps what it is given.
 *
 * Most suites only care that a record points at an object. The upload tests
 * care what the bytes became, since re-encoding and EXIF stripping are the
 * whole point of that endpoint, and discarding them here meant those could
 * never be asserted.
 */
const storedObjects = new Map<string, { body: Buffer; contentType: string }>();
/**
 * Kept apart from the public map on purpose, so a test can prove a receipt
 * went to private storage and never to anywhere with a URL.
 */
const privateObjects = new Map<string, { body: Buffer; contentType: string }>();

const memoryStorage: ObjectStorage = {
  name: "memory",
  async put(key, body, contentType) {
    storedObjects.set(key, { body, contentType });
  },
  async remove(key) {
    storedObjects.delete(key);
  },
  urlFor: (key) => `https://test.local/${key}`,
  async putPrivate(key, body, contentType) {
    privateObjects.set(key, { body, contentType });
  },
  async getPrivate(key) {
    return privateObjects.get(key)?.body ?? null;
  },
  async removePrivate(key) {
    privateObjects.delete(key);
  },
};

/** What was actually written for a key, for tests that assert on the bytes. */
export function storedObject(
  key: string,
): { body: Buffer; contentType: string } | undefined {
  return storedObjects.get(key);
}

export function storedPrivateObject(
  key: string,
): { body: Buffer; contentType: string } | undefined {
  return privateObjects.get(key);
}

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
    `DELETE FROM user_category_interest`,
    `DELETE FROM commission_problems`,
    `DELETE FROM commission_payments`,
    `DELETE FROM commission_files`,
    `DELETE FROM payout_accounts`,
    `DELETE FROM reviews`,
    `DELETE FROM application_samples`,
    `DELETE FROM commissions`,
    `DELETE FROM applications`,
    `DELETE FROM posting_images`,
    `DELETE FROM postings`,
    `DELETE FROM share_reactions`,
    `DELETE FROM post_comments`,
    `DELETE FROM artist_post_images`,
    `DELETE FROM artist_posts`,
    `DELETE FROM notifications`,
    `DELETE FROM messages`,
    `DELETE FROM chat_files`,
    `DELETE FROM conversations`,
    `DELETE FROM moderation_actions`,
    `DELETE FROM bug_reports`,
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
  belowBudgetReason?: string,
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
      ...(belowBudgetReason === undefined ? {} : { belowBudgetReason }),
    },
  });
}

export async function createArtistPost(artist: Session, caption = "Bridal bouquet", categorySlug = "crochet") {
  const instance = await getTestApp();
  const imageId = await seedImage(artist.id);
  const response = await instance.inject({
    method: "POST",
    url: "/posts",
    headers: authHeaders(artist),
    payload: { caption, categorySlug, imageIds: [imageId] },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createArtistPost failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as { id: string };
}

/**
 * A distinct test image. Each seed draws different stripes, so two seeds give
 * different bytes and different difference hashes, the way two real receipts
 * would, while one seed always gives the same picture.
 */
export async function testImage(seed: number, format: "png" | "jpeg" = "png"): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const width = 320;
  const height = 320;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.floor((x * (seed + 3) + y * ((seed % 5) + 1)) / 17) % 2;
      const offset = (y * width + x) * 3;
      pixels[offset] = band ? 230 : (seed * 37) % 200;
      pixels[offset + 1] = band ? 225 : (seed * 53) % 200;
      pixels[offset + 2] = band ? 215 : (seed * 71) % 200;
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : image.jpeg({ quality: 95 }).toBuffer();
}

/** Builds a multipart body by hand; inject takes a Buffer, not a FormData. */
export function multipartFile(file: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----craftbidtest";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="upload.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

export async function uploadCommissionFile(
  session: Session,
  commissionId: string,
  file: Buffer,
): Promise<LightMyRequestResponse> {
  const instance = await getTestApp();
  const body = multipartFile(file);
  return instance.inject({
    method: "POST",
    url: `/commissions/${commissionId}/files`,
    headers: { ...authHeaders(session), ...body.headers },
    payload: body.payload,
  });
}

/** Gives an artist a GCash account clients can pay. */
export async function addGcash(artist: Session, number = "09171234567"): Promise<void> {
  const instance = await getTestApp();
  const response = await instance.inject({
    method: "PUT",
    url: "/me/payout-accounts",
    headers: authHeaders(artist),
    payload: { accounts: [{ method: "gcash", accountName: "Nena Hooks", accountNumber: number }] },
  });
  if (response.statusCode !== 200) {
    throw new Error(`addGcash failed: ${response.statusCode} ${response.body}`);
  }
}

/** Posts a request, bids, accepts, and returns the new commission's id. */
export async function startCommission(
  client: Session,
  artist: Session,
  priceCentavos = 200_000,
): Promise<string> {
  const instance = await getTestApp();
  const posting = await createPosting(client);
  const application = await applyToPosting(artist, posting.id, priceCentavos);
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
  return (postingAfter.json() as { commissionId: string }).commissionId;
}

let receiptSeed = 1000;
let referenceSeed = 100_000_000;

/** A seed for a picture no other helper call has drawn. */
export function freshImageSeed(): number {
  receiptSeed += 1;
  return receiptSeed;
}

/**
 * The client records a GCash transfer for the amount due, with a fresh
 * receipt and reference number unless the test supplies its own.
 */
export async function submitGcashPayment(
  client: Session,
  commissionId: string,
  kind: "down" | "balance",
  overrides: Partial<{
    amountCentavos: number;
    referenceNumber: string;
    paidOn: string;
    receiptFileId: string;
    receipt: Buffer;
  }> = {},
): Promise<LightMyRequestResponse> {
  const instance = await getTestApp();
  let receiptFileId = overrides.receiptFileId;
  if (!receiptFileId) {
    const upload = await uploadCommissionFile(
      client,
      commissionId,
      overrides.receipt ?? (await testImage(freshImageSeed())),
    );
    if (upload.statusCode !== 201) {
      throw new Error(`receipt upload failed: ${upload.statusCode} ${upload.body}`);
    }
    receiptFileId = (upload.json() as { id: string }).id;
  }

  let amountCentavos = overrides.amountCentavos;
  if (amountCentavos === undefined) {
    const commission = await instance.inject({
      method: "GET",
      url: `/commissions/${commissionId}`,
      headers: authHeaders(client),
    });
    const tracking = (commission.json() as {
      paymentTracking: { downPaymentCentavos: number; balanceCentavos: number };
    }).paymentTracking;
    amountCentavos = kind === "down" ? tracking.downPaymentCentavos : tracking.balanceCentavos;
  }

  referenceSeed += 1;
  return instance.inject({
    method: "POST",
    url: `/commissions/${commissionId}/payments`,
    headers: authHeaders(client),
    payload: {
      kind,
      method: "gcash",
      amountCentavos,
      referenceNumber: overrides.referenceNumber ?? String(referenceSeed),
      paidOn: overrides.paidOn ?? new Date().toISOString().slice(0, 10),
      receiptFileId,
    },
  });
}

/** The id of the newest payment of a kind, as either party sees it. */
export async function latestPaymentId(
  session: Session,
  commissionId: string,
  kind: "down" | "balance",
): Promise<string> {
  const instance = await getTestApp();
  const response = await instance.inject({
    method: "GET",
    url: `/commissions/${commissionId}`,
    headers: authHeaders(session),
  });
  const payments = (response.json() as {
    paymentTracking: { payments: { id: string; kind: string }[] };
  }).paymentTracking.payments;
  const found = payments.find((payment) => payment.kind === kind);
  if (!found) throw new Error(`no ${kind} payment on ${commissionId}`);
  return found.id;
}

function expectStatus(response: LightMyRequestResponse, status: number, step: string): void {
  if (response.statusCode !== status) {
    throw new Error(`${step} failed: ${response.statusCode} ${response.body}`);
  }
}

/** The artist confirms the newest payment of a kind. */
export async function confirmPayment(
  artist: Session,
  commissionId: string,
  kind: "down" | "balance",
): Promise<LightMyRequestResponse> {
  const instance = await getTestApp();
  return instance.inject({
    method: "POST",
    url: `/commissions/${commissionId}/payments/${await latestPaymentId(artist, commissionId, kind)}/confirm`,
    headers: authHeaders(artist),
  });
}

/** The artist uploads one photo and marks the piece finished. */
export async function finishWork(artist: Session, commissionId: string): Promise<LightMyRequestResponse> {
  const instance = await getTestApp();
  const photo = await uploadCommissionFile(artist, commissionId, await testImage(freshImageSeed()));
  expectStatus(photo, 201, "finished photo");
  return instance.inject({
    method: "POST",
    url: `/commissions/${commissionId}/finished`,
    headers: authHeaders(artist),
    payload: { photoFileIds: [(photo.json() as { id: string }).id] },
  });
}

/**
 * Runs a posting all the way to a completed commission, through the payment
 * records a real pair would go through: down payment confirmed, finished photos,
 * balance confirmed, then the client completes.
 */
export async function completeCommission(
  client: Session,
  artist: Session,
): Promise<{ postingId: string; commissionId: string }> {
  const instance = await getTestApp();
  await addGcash(artist);
  const commissionId = await startCommission(client, artist);

  expectStatus(await submitGcashPayment(client, commissionId, "down"), 201, "down payment");
  expectStatus(await confirmPayment(artist, commissionId, "down"), 204, "confirm down payment");
  expectStatus(await finishWork(artist, commissionId), 204, "mark finished");
  expectStatus(await submitGcashPayment(client, commissionId, "balance"), 201, "balance");
  expectStatus(await confirmPayment(artist, commissionId, "balance"), 204, "confirm balance");
  expectStatus(
    await instance.inject({
      method: "POST",
      url: `/commissions/${commissionId}/complete`,
      headers: authHeaders(client),
    }),
    200,
    "complete",
  );

  const detail = await instance.inject({
    method: "GET",
    url: `/commissions/${commissionId}`,
    headers: authHeaders(client),
  });
  return { postingId: (detail.json() as { posting: { id: string } }).posting.id, commissionId };
}

export async function setStatus(userId: string, status: "active" | "suspended" | "deleted"): Promise<void> {
  await db.run(`UPDATE users SET status = :status WHERE id = :id`, { status, id: uuidToBuf(userId) });
}

export async function makeStaff(userId: string): Promise<void> {
  await db.run(`UPDATE users SET is_staff = 1 WHERE id = :id`, { id: uuidToBuf(userId) });
}

/** One person's craft interest scores, decayed to now, by slug. */
export async function interestOf(userId: string): Promise<Map<string, number>> {
  const { scoresFor } = await import("../modules/interests/interests.service.js");
  return scoresFor(userId);
}

/** Stores an interest score as if it had last been written `daysAgo` days ago. */
export async function setInterest(userId: string, slug: string, score: number, daysAgo = 0): Promise<void> {
  await db.run(
    `MERGE INTO user_category_interest t
     USING (SELECT id AS category_id FROM craft_categories WHERE slug = :slug) s
        ON (t.user_id = :userId AND t.category_id = s.category_id)
      WHEN MATCHED THEN UPDATE SET t.score = :score, t.updated_at = SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')
      WHEN NOT MATCHED THEN INSERT (user_id, category_id, score, updated_at)
           VALUES (:userId, s.category_id, :score, SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY'))`,
    { userId: uuidToBuf(userId), slug, score, days: daysAgo },
  );
}
