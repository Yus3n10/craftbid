import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  // A sibling of the public root, not inside it: the public root is served as
  // static files, so anything under it would have a URL.
  const privateRoot = localPrivateStorageRoot();

  /**
   * Keys are generated server-side, but resolving them here anyway means a key
   * containing "../" could never escape the storage root even if some future
   * code path let a user influence one.
   */
  function safePath(key: string, base = root): string {
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) {
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

    async putPrivate(key, body, _contentType) {
      const path = safePath(key, privateRoot);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },

    async getPrivate(key) {
      try {
        return await readFile(safePath(key, privateRoot));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async removePrivate(key) {
      await rm(safePath(key, privateRoot), { force: true });
    },
  };
}

export function localPrivateStorageRoot(): string {
  return resolve(process.cwd(), `${config.storage.localDir}-private`);
}

export function localStorageRoot(): string {
  return resolve(process.cwd(), config.storage.localDir);
}

export function localStoragePath(...parts: string[]): string {
  return join(localStorageRoot(), ...parts);
}
