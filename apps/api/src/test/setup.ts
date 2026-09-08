import { afterAll, beforeAll } from "vitest";
import { closePool, initPool } from "../db/pool.js";
import { closeTestApp } from "./helpers.js";

// One connection pool per test file, opened before anything runs and drained
// afterwards so the process can exit cleanly.
beforeAll(async () => {
  await initPool();
});

afterAll(async () => {
  await closeTestApp();
  await closePool();
});
