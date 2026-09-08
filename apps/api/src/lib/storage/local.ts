import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { config } from "../../config.js";
import type { ObjectStorage } from "./index.js";

/**
 * Writes uploads to the local filesystem and serves them back through the API.
 *
 * Development only. Config refuses to boot with this driver when
 * NODE_ENV=production, because free container hosts have ephemeral disks and
 * every uploaded image would vanish on the next deploy.
 */
export function createLocalStorage(): ObjectStorage {
  const root = resolve(process.cwd(), config.storage.localDir);

  /**
   * Keys are generated server-side, but resolving them here anyway means a key
   * containing "../" could never escape the storage root even if some future
   * code path let a user influence one.
   */
  function safePath(key: string): string {
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`);
    }
    return full;
  }

  return {
    name: "local",

    async put(key, body, _contentType) {
      const path = safePath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },

    async remove(key) {
      await rm(safePath(key), { force: true });
    },

    urlFor(key) {
      return `${config.storage.publicBaseUrl}/${key}`;
    },
  };
}

export function localStorageRoot(): string {
  return resolve(process.cwd(), config.storage.localDir);
}

export function localStoragePath(...parts: string[]): string {
  return join(localStorageRoot(), ...parts);
}
