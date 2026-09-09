import sharp from "sharp";
import { UPLOAD } from "@craftbid/shared";
import { newId } from "../../db/ids.js";
import { badRequest } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import * as repo from "./images.repository.js";

/**
 * Detects the real format from the file's leading bytes.
 *
 * The browser-supplied Content-Type is attacker-controlled and means nothing:
 * anyone can label a script "image/png". Only the bytes decide.
 */
function sniffFormat(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)) {
    return "png";
  }

  // "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export interface ProcessedImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

/**
 * Validates, normalises and stores one upload.
 *
 * Everything is re-encoded to WebP rather than stored as received. That gives
 * three things at once: metadata including GPS EXIF is dropped, since a photo
 * of a handmade piece is usually taken at the maker's home; a malformed file
 * that merely looks like an image fails here rather than in a browser; and the
 * bytes shrink, which matters when the storage tier is free.
 */
export async function processUpload(
  ownerId: string,
  buffer: Buffer,
): Promise<ProcessedImage> {
  if (buffer.length === 0) {
    throw badRequest("That file is empty.");
  }
  if (buffer.length > UPLOAD.maxBytes) {
    throw badRequest(
      `Images must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`,
    );
  }

  const format = sniffFormat(buffer);
  if (!format) {
    throw badRequest("That file is not a JPEG, PNG or WebP image.");
  }

  let pipeline: sharp.Sharp;
  let metadata: sharp.Metadata;
  try {
    // limitInputPixels caps decoded size, so a small file that expands to an
    // enormous bitmap cannot exhaust memory on a 512 MB host.
    pipeline = sharp(buffer, { limitInputPixels: 50_000_000, failOn: "error" });
    metadata = await pipeline.metadata();
  } catch {
    throw badRequest("That image could not be read. It may be corrupted.");
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < UPLOAD.minDimension || height < UPLOAD.minDimension) {
    throw badRequest(
      `Images must be at least ${UPLOAD.minDimension}x${UPLOAD.minDimension} pixels.`,
    );
  }
  if (width > UPLOAD.maxDimension || height > UPLOAD.maxDimension) {
    throw badRequest(
      `Images must be no larger than ${UPLOAD.maxDimension}x${UPLOAD.maxDimension} pixels.`,
    );
  }

  const output = await pipeline
    .rotate() // apply the EXIF orientation before that metadata is discarded
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const id = newId();
  // The key is derived server-side. A client-supplied filename never reaches
  // the storage path, so there is nothing to traverse with.
  const key = `${ownerId}/${id}.webp`;

  const storage = getStorage();
  await storage.put(key, output.data, "image/webp");

  try {
    await repo.insertImage({
      id,
      ownerId,
      objectKey: key,
      contentType: "image/webp",
      byteSize: output.data.byteLength,
      width: output.info.width,
      height: output.info.height,
    });
  } catch (error) {
    // Do not leave bytes behind that no row points at.
    await storage.remove(key).catch(() => {});
    throw error;
  }

  return {
    id,
    url: storage.urlFor(key),
    width: output.info.width,
    height: output.info.height,
  };
}
