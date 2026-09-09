import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createCommentSchema,
  idParamSchema,
  setReactionSchema,
} from "@craftbid/shared";
import * as service from "./social.service.js";

/**
 * Reactions, comments and saves on portfolio posts.
 *
 * There is deliberately no equivalent for craft requests. Public commentary on
 * a request would let artists see who else is circling and price against each
 * other, which is the same harm the bid privacy rules exist to prevent.
 */
export const socialRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.put(
    "/posts/:id/reaction",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: setReactionSchema },
      // A reaction is one row and one click; the cap is only here to stop a
      // script cycling one post's counts thousands of times a minute.
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      await service.react(request.params.id, request.user!.id, request.body.kind);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/posts/:id/reaction",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.unreact(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );

  // Readable signed out, like the posts themselves.
  app.get(
    "/posts/:id/comments",
    { schema: { params: idParamSchema } },
    async (request) =>
      service.listComments(request.params.id, request.user?.id ?? null),
  );

  app.post(
    "/posts/:id/comments",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: createCommentSchema },
      // Comments are the cheapest way to spray a page with spam, so this is
      // tighter than the reaction limit.
      config: { rateLimit: { max: 20, timeWindow: "5 minutes" } },
    },
    async (request, reply) => {
      const comment = await service.addComment(
        request.params.id,
        request.user!.id,
        request.body.body,
      );
      return reply.code(201).send(comment);
    },
  );

  app.delete(
    "/comments/:id",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.removeComment(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );

  app.put(
    "/posts/:id/save",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.setSaved(request.params.id, request.user!.id, true);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/posts/:id/save",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.setSaved(request.params.id, request.user!.id, false);
      return reply.code(204).send();
    },
  );
};
