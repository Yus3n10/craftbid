import type { ImageDto } from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";
import { getStorage } from "../../lib/storage/index.js";

export interface ImageRecord {
  id: string;
  ownerId: string;
  objectKey: string;
  width: number;
  height: number;
}

interface ImageRow {
  id: Buffer;
  ownerId: Buffer;
  objectKey: string;
  width: number;
  height: number;
}

function mapImage(row: ImageRow): ImageRecord {
  return {
    id: bufToUuid(row.id)!,
    ownerId: bufToUuid(row.ownerId)!,
    objectKey: row.objectKey,
    width: row.width,
    height: row.height,
  };
}

/** Turns a stored record into the shape the client renders. */
export function toDto(record: ImageRecord | null): ImageDto | null {
  if (!record) return null;
  return {
    id: record.id,
    url: getStorage().urlFor(record.objectKey),
    width: record.width,
    height: record.height,
  };
}

export async function insertImage(
  input: {
    id: string;
    ownerId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    width: number;
    height: number;
  },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO images (id, owner_id, object_key, content_type, byte_size, width, height)
     VALUES (:id, :ownerId, :objectKey, :contentType, :byteSize, :width, :height)`,
    {
      id: uuidToBuf(input.id),
      ownerId: uuidToBuf(input.ownerId),
      objectKey: input.objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
    },
  );
}

export async function findById(
  id: string,
  q: Queryable = db,
): Promise<ImageRecord | null> {
  const row = await q.one<ImageRow>(
    `SELECT id, owner_id, object_key, width, height FROM images WHERE id = :id`,
    { id: uuidToBuf(id) },
  );
  return row ? mapImage(row) : null;
}

/**
 * Loads images by id, keeping only those the given user owns.
 *
 * This is what stops one user attaching another user's image to their own
 * posting by passing its id. Callers compare the returned count against what
 * they asked for and reject the request on any shortfall.
 */
export async function findOwnedByIds(
  ids: string[],
  ownerId: string,
  q: Queryable = db,
): Promise<ImageRecord[]> {
  if (ids.length === 0) return [];

  const binds: Record<string, Buffer> = { ownerId: uuidToBuf(ownerId) };
  const placeholders = ids.map((id, index) => {
    binds[`id${index}`] = uuidToBuf(id);
    return `:id${index}`;
  });

  const rows = await q.many<ImageRow>(
    `SELECT id, owner_id, object_key, width, height
       FROM images
      WHERE owner_id = :ownerId
        AND id IN (${placeholders.join(", ")})`,
    binds,
  );
  return rows.map(mapImage);
}

/** Images uploaded but never attached to anything, older than a day. */
export async function findOrphans(q: Queryable = db): Promise<ImageRecord[]> {
  const rows = await q.many<ImageRow>(
    `SELECT i.id, i.owner_id, i.object_key, i.width, i.height
       FROM images i
      WHERE i.created_at < SYSTIMESTAMP - INTERVAL '1' DAY
        AND NOT EXISTS (SELECT 1 FROM posting_images pi WHERE pi.image_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM artist_post_images api WHERE api.image_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM users u
                         WHERE u.avatar_image_id = i.id OR u.cover_image_id = i.id)`,
  );
  return rows.map(mapImage);
}
