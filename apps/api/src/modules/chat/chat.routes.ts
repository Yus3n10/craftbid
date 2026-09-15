import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  UPLOAD,
  idParamSchema,
  messagesQuerySchema,
  openConversationSchema,
  sendMessageSchema,
  uuidSchema,
} from "@craftbid/shared";
import { z } from "zod";
import { badRequest } from "../../lib/errors.js";
import * as service from "./chat.service.js";

const fileParams = z.object({ id: uuidSchema, fileId: uuidSchema });

/**
 * Chat. Signed in only; who may see which conversation is the service's job.
 * The page polls, so the reads are cheap and the writes are rate limited.
 */
export const chatRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/conversations",
    {
      preHandler: fastify.requireAuth,
      schema: { body: openConversationSchema },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => service.open(request.user!.id, request.body),
  );

  app.get("/conversations", { preHandler: fastify.requireAuth }, async (request) => ({
    items: await service.list(request.user!.id),
  }));

  app.get("/conversations/unread", { preHandler: fastify.requireAuth }, async (request) => ({
    unread: await service.unread(request.user!.id),
  }));

  app.get(
    "/conversations/:id",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request) => service.get(request.user!.id, request.params.id),
  );

  app.get(
    "/conversations/:id/messages",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema, querystring: messagesQuerySchema } },
    async (request) => ({
      items: await service.messages(request.user!.id, request.params.id, request.query.after),
    }),
  );

  app.post(
    "/conversations/:id/messages",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: sendMessageSchema },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) =>
      reply.code(201).send(
        await service.send(request.user!.id, request.params.id, {
          ...(request.body.body ? { body: request.body.body } : {}),
          ...(request.body.fileId ? { fileId: request.body.fileId } : {}),
        }),
      ),
  );

  app.post(
    "/conversations/:id/files",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: UPLOAD.maxBytes, files: 1 } });
      if (!file) throw badRequest("No file was uploaded.");
      const buffer = await file.toBuffer();
      // A stream that hit the limit is flagged, not thrown.
      if (file.file.truncated) {
        throw badRequest(`Images must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`);
      }
      return reply.code(201).send(await service.uploadImage(request.user!.id, request.params.id, buffer));
    },
  );

  app.get(
    "/conversations/:id/files/:fileId",
    { preHandler: fastify.requireAuth, schema: { params: fileParams } },
    async (request, reply) => {
      const image = await service.readImage(request.user!.id, request.params.id, request.params.fileId);
      return reply
        .header("content-type", image.contentType)
        // Private to two people: never kept by a shared cache or on disk.
        .header("cache-control", "private, no-store")
        .header("content-disposition", "inline")
        .send(image.body);
    },
  );

  app.post(
    "/conversations/:id/read",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.markRead(request.user!.id, request.params.id);
      return reply.code(204).send();
    },
  );
};
