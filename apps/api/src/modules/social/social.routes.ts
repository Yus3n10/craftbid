import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  activityQuerySchema,
  createCommentSchema,
  idParamSchema,
  setReactionSchema,
  sharePostSchema,
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
      preHandler: fastify.requireVerified,
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
      preHandler: fastify.requireVerified,
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

  // --- A share's own reactions and comments --------------------------------------
  app.put(
    "/shares/:id/reaction",
    {
      preHandler: fastify.requireVerified,
      schema: { params: idParamSchema, body: setReactionSchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      await service.reactToShare(request.params.id, request.user!.id, request.body.kind);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/shares/:id/reaction",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.unreactToShare(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );

  app.get(
    "/shares/:id/comments",
    { schema: { params: idParamSchema } },
    async (request) => service.listShareComments(request.params.id, request.user?.id ?? null),
  );

  app.post(
    "/shares/:id/comments",
    {
      preHandler: fastify.requireVerified,
      schema: { params: idParamSchema, body: createCommentSchema },
      config: { rateLimit: { max: 20, timeWindow: "5 minutes" } },
    },
    async (request, reply) =>
      reply.code(201).send(await service.addShareComment(request.params.id, request.user!.id, request.body.body)),
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
    { preHandler: fastify.requireVerified, schema: { params: idParamSchema } },
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

  // PUT because sharing again edits the caption rather than adding a second
  // share, so repeating the request leaves the same state.
  app.put(
    "/posts/:id/share",
    {
      preHandler: fastify.requireVerified,
      schema: { params: idParamSchema, body: sharePostSchema },
      config: { rateLimit: { max: 30, timeWindow: "5 minutes" } },
    },
    async (request, reply) => {
      await service.share(request.params.id, request.user!.id, request.body.caption);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/posts/:id/share",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.unshare(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );

  // Always the caller's own history: there is no parameter naming whose.
  app.get(
    "/me/activity",
    { preHandler: fastify.requireAuth, schema: { querystring: activityQuerySchema } },
    async (request) =>
      service.activity(request.user!.id, {
        ...(request.query.kind ? { kind: request.query.kind } : {}),
        limit: request.query.limit,
        offset: request.query.offset,
      }),
  );
};
