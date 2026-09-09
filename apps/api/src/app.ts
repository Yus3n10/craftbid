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
import { CRAFT_CATEGORIES, UPLOAD } from "@craftbid/shared";
import { config } from "./config.js";
import { DbError } from "./db/query.js";
import { AppError } from "./lib/errors.js";
import { localStorageRoot } from "./lib/storage/local.js";
import authPlugin from "./plugins/auth.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { imageRoutes } from "./modules/images/images.routes.js";
import { postingRoutes } from "./modules/postings/postings.routes.js";
import { applicationRoutes } from "./modules/applications/applications.routes.js";
import { commissionRoutes } from "./modules/commissions/commissions.routes.js";
import { postRoutes } from "./modules/posts/posts.routes.js";
import { socialRoutes } from "./modules/social/social.routes.js";
import { searchRoutes } from "./modules/search.routes.js";
import { communityRoutes } from "./modules/community.routes.js";

/** One entry of Fastify's `error.validation` array. */
interface ValidationEntry {
  instancePath?: string;
  message?: string;
  params?: { issue?: { path?: (string | number)[]; message?: string } };
}

export interface BuildAppOptions {
  /**
   * Defaults to on everywhere except tests, which register dozens of accounts
   * and would otherwise trip the registration limiter. The limiter itself is
   * covered by rate-limit.test.ts, which builds an app with this forced on.
   */
  enableRateLimit?: boolean;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const enableRateLimit = options.enableRateLimit ?? !config.isTest;
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

  /**
   * A POST with no body is ordinary for an action like logout or refresh, but
   * Fastify's default JSON parser rejects an empty body with a 400 before the
   * route is ever reached. Treating it as an absent body lets the route's own
   * optional schema decide, instead of every bodyless action needing the
   * caller to remember to send `{}`.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (text.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        done(error as Error);
      }
    },
  );

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

  /**
   * CSRF defence for cookie-authenticated writes.
   *
   * Session cookies are SameSite=None in production, because the web app and
   * the API are on different registrable domains and a Lax cookie is never
   * sent between them. That alone would let any site trigger a state-changing
   * request with the user's session attached. CORS is not the protection
   * people assume: it governs reading the response, not sending the request,
   * and multipart uploads are a "simple" request that never triggers a
   * preflight at all.
   *
   * So a mutation carrying a browser Origin must carry one we allow. Requests
   * bearing an Authorization header are exempt: a token has to be attached
   * deliberately by script, which is the thing forgery cannot do, and the
   * desktop build legitimately calls from tauri://localhost.
   */
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.headers.authorization) return;

    const origin = request.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) {
      return reply.code(403).send({
        error: {
          code: "forbidden",
          message: "This request did not come from an allowed origin.",
        },
      });
    }
  });

  if (enableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: "1 minute",
    });
  }

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
  app.get("/health", async (request, reply) => {
    const { db } = await import("./db/query.js");

    let database: "reachable" | "unreachable" = "unreachable";
    try {
      await db.one(`SELECT 1 AS ok FROM dual`);
      database = "reachable";
    } catch (error) {
      // Logged rather than swallowed. A health check that hides why it is
      // unhealthy is worse than no health check: the first deploy failure
      // reported nothing at all.
      request.log.error({ err: error }, "Health check could not reach database");
    }

    // Deliberately 200 even when the database is unreachable. The host gates a
    // deploy on this endpoint, and Always Free Autonomous Database stops itself
    // when idle, so a 503 here would refuse to bring the service up precisely
    // when the keep-alive needs to reach it to wake the database — a deadlock
    // that resolves itself only by hand. Report the degradation in the body and
    // let the caller decide.
    return reply.send({ status: "ok", database });
  });

  app.get("/categories", async () => CRAFT_CATEGORIES);

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(userRoutes);
  await app.register(imageRoutes);
  await app.register(postingRoutes);
  await app.register(applicationRoutes);
  await app.register(commissionRoutes);
  await app.register(postRoutes);
  await app.register(socialRoutes);
  await app.register(searchRoutes);
  await app.register(communityRoutes);

  return app;
}
