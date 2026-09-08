import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  artistPostListQuerySchema,
  createArtistPostSchema,
  idParamSchema,
  updateArtistPostSchema,
} from "@raxtan/shared";
import * as service from "./posts.service.js";

export const postRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Serves both the public discovery feed and, filtered by `artist`, the
  // portfolio grid on a profile.
  app.get(
    "/posts",
    { schema: { querystring: artistPostListQuerySchema } },
    async (request) => service.listPosts(request.query),
  );

  app.get(
    "/posts/:id",
    { schema: { params: idParamSchema } },
    async (request) => service.getPost(request.params.id),
  );

  app.post(
    "/posts",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { body: createArtistPostSchema },
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const post = await service.createPost(request.user!.id, request.body);
      return reply.code(201).send(post);
    },
  );

  app.patch(
    "/posts/:id",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { params: idParamSchema, body: updateArtistPostSchema },
    },
    async (request) =>
      service.updatePost(request.params.id, request.user!.id, request.body),
  );

  app.delete(
    "/posts/:id",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { params: idParamSchema },
    },
    async (request, reply) => {
      await service.deletePost(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );
};
