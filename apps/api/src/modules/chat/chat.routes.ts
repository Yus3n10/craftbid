import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  idParamSchema,
  messagesQuerySchema,
  openConversationSchema,
  sendMessageSchema,
} from "@craftbid/shared";
import * as service from "./chat.service.js";

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
      reply.code(201).send(await service.send(request.user!.id, request.params.id, request.body.body)),
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
