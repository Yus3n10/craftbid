import { config } from "../../config.js";
import { createLocalStorage } from "./local.js";
import { createImageKitStorage } from "./imagekit.js";

/**
 * Image bytes live in object storage; the database holds only the key.
 *
 * The port exists because the free-tier landscape here is genuinely uncertain:
 * the local driver cannot be production (Render's disk is ephemeral and is
 * wiped on every deploy), and the eventual production driver depends on which
 * account the operator is willing to create. Swapping one is a config change,
 * not a code change.
 */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** The public URL a browser should load this object from. */
  urlFor(key: string): string;
}

let instance: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  if (instance) return instance;
  instance =
    config.storage.driver === "imagekit"
      ? createImageKitStorage()
      : createLocalStorage();
  return instance;
}

/** Test seam: lets a suite swap in a fake without touching real bytes. */
export function setStorage(storage: ObjectStorage | undefined): void {
  instance = storage;
}
