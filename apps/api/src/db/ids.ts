import { v7 as uuidv7 } from "uuid";

/**
 * Public identifiers are UUIDv7 stored as Oracle `RAW(16)`.
 *
 * v7 rather than v4 because it is time-ordered: new rows land at the right edge
 * of the primary-key index instead of scattering across it, which keeps inserts
 * from fragmenting the B-tree. And a UUID rather than a sequence because these
 * appear in URLs, where a sequential id would let anyone enumerate every
 * posting and user on the platform.
 */

export function newId(): string {
  return uuidv7();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Converts a canonical UUID string into the 16 raw bytes Oracle stores. */
export function uuidToBuf(uuid: string): Buffer {
  if (!isUuid(uuid)) {
    throw new TypeError(`Not a valid UUID: ${uuid}`);
  }
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** Converts Oracle's RAW(16) buffer back to a canonical UUID string. */
export function bufToUuid(buf: Buffer | null | undefined): string | null {
  if (!buf) return null;
  const hex = buf.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
