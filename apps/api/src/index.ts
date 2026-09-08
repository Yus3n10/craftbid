import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closePool, initPool } from "./db/pool.js";

async function main(): Promise<void> {
  await initPool();

  const app = await buildApp();

  // Free hosts stop a container with SIGTERM. Draining first means in-flight
  // requests finish instead of failing at the client.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void (async () => {
        app.log.info(`${signal} received, shutting down`);
        await app.close();
        await closePool();
        process.exit(0);
      })();
    });
  }

  await app.listen({ port: config.server.port, host: config.server.host });
}

main().catch((error: unknown) => {
  console.error("Failed to start:", error);
  process.exit(1);
});
