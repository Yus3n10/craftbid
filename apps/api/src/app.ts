import { mkdir } from "node:fs/promises";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { CRAFT_CATEGORIES, UPLOAD } from "@raxtan/shared";
import { config } from "./config.js";
import { DbError } from "./db/query.js";
import { AppError } from "./lib/errors.js";
import { localStorageRoot } from "./lib/storage/local.js";
import authPlugin from "./plugins/auth.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { imageRoutes } from "./modules/images/images.routes.js";

/** One entry of Fastify's `error.validation` array. */
interface ValidationEntry {
  instancePath?: string;
  message?: string;
  params?: { issue?: { path?: (string | number)[]; message?: string } };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.isProduction ? "info" : "debug",
          // Never let a password or token reach the log, even on an error path.
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body.password",
            "req.body.currentPassword",
            "req.body.newPassword",
          ],
        },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    // Images are served from this origin but loaded by the web app on another,
    // which the default "same-origin" policy would block.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    // Required for the session cookies to be sent cross-origin.
    credentials: true,
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: UPLOAD.maxBytes, files: 1, fields: 10 },
  });

  await app.register(authPlugin);

  // In development the API also serves the uploaded bytes. In production the
  // storage driver returns a CDN URL and nothing is served from here.
  if (config.storage.driver === "local") {
    const root = localStorageRoot();
    await mkdir(root, { recursive: true });
    await app.register(fastifyStatic, {
      root,
      prefix: "/media/",
      decorateReply: false,
    });
  }

  /**
   * Every deliberate failure is an AppError. Anything else is a bug, and is
   * logged in full but answered with a generic message: driver text and stack
   * traces frequently name tables, columns and constraints.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(error.toResponse());
    }

    // Body/params that failed a Zod schema, surfaced per field for forms.
    const validation = (error as { validation?: ValidationEntry[] }).validation;
    if (validation || error instanceof ZodError) {
      const fields: Record<string, string> = {};

      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          const path = issue.path.join(".");
          if (path && !fields[path]) fields[path] = issue.message;
        }
      }

      // Fastify wraps schema failures into its own array rather than rethrowing
      // the ZodError. The type provider tucks the original issue inside
      // `params.issue`; `instancePath` is the fallback for any other validator.
      for (const entry of validation ?? []) {
        const path =
          entry.params?.issue?.path?.join(".") ??
          entry.instancePath?.replace(/^\//, "").replace(/\//g, ".");
        const message = entry.params?.issue?.message ?? entry.message;
        if (path && message && !fields[path]) fields[path] = message;
      }

      return reply.code(400).send({
        error: {
          code: "validation_failed",
          message: "Please check the highlighted fields.",
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
        },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: "rate_limited",
          message: "Too many attempts. Please try again shortly.",
        },
      });
    }

    request.log.error(
      { err: error, isDbError: error instanceof DbError },
      "Unhandled error",
    );

    return reply.code(500).send({
      error: { code: "internal_error", message: "Something went wrong on our end." },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      error: { code: "not_found", message: "Not found." },
    }),
  );

  /**
   * Doubles as the target for the scheduled keep-alive. Oracle's Always Free
   * Autonomous Database stops after seven idle days and is deleted after
   * ninety, so it deliberately touches the database rather than only reporting
   * that the process is up.
   */
  app.get("/health", async (_request, reply) => {
    const { db } = await import("./db/query.js");
    try {
      await db.one(`SELECT 1 AS ok FROM dual`);
      return reply.send({ status: "ok", database: "reachable" });
    } catch {
      return reply
        .code(503)
        .send({ status: "degraded", database: "unreachable" });
    }
  });

  app.get("/categories", async () => CRAFT_CATEGORIES);

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(userRoutes);
  await app.register(imageRoutes);

  return app;
}
