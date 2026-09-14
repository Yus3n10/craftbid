import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  applicationListQuerySchema,
  createApplicationSchema,
  createPostingSchema,
  idParamSchema,
  paginationSchema,
  postingListQuerySchema,
  updatePostingSchema,
  usernameSchema,
} from "@craftbid/shared";
import { z } from "zod";
import * as applications from "../applications/applications.service.js";
import * as service from "./postings.service.js";
import { noteBrowsing } from "../interests/interests.service.js";

export const postingRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Public discovery. Browsing does not require an account, so an artist can
  // see whether the platform is worth joining before signing up.
  app.get(
    "/postings",
    { schema: { querystring: postingListQuerySchema } },
    async (request) => {
      await noteBrowsing(request.user?.id, request.query.category, request.query.offset);
      return service.listPostings({
        ...request.query,
        // Scoped from the token rather than a client id in the query string,
        // so `mine` cannot be aimed at another user's postings.
        ...(request.query.mine && request.user
          ? { clientId: request.user.id }
          : {}),
      });
    },
  );

  // Public, like the request list: the requests on someone's profile.
  app.get(
    "/users/:username/postings",
    {
      schema: {
        params: z.object({ username: usernameSchema }),
        querystring: paginationSchema,
      },
    },
    async (request) => service.listForUser(request.params.username, request.query),
  );

  app.get(
    "/postings/:id",
    { schema: { params: idParamSchema } },
    async (request) => service.getPosting(request.params.id, request.user),
  );

  app.post(
    "/postings",
    {
      preHandler: [fastify.requireRole("client"), fastify.requireVerified],
      schema: { body: createPostingSchema },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const posting = await service.createPosting(request.user!.id, request.body);
      return reply.code(201).send(posting);
    },
  );

  app.patch(
    "/postings/:id",
    {
      preHandler: fastify.requireRole("client"),
      schema: { params: idParamSchema, body: updatePostingSchema },
    },
    async (request) =>
      service.updatePosting(request.params.id, request.user!.id, request.body),
  );

  app.post(
    "/postings/:id/cancel",
    {
      preHandler: fastify.requireRole("client"),
      schema: { params: idParamSchema },
    },
    async (request) => service.cancelPosting(request.params.id, request.user!.id),
  );

  // Visible only to the client who created the posting: bids are competitive
  // information and must not leak to rival artists.
  app.get(
    "/postings/:id/applications",
    {
      preHandler: fastify.requireRole("client"),
      schema: { params: idParamSchema, querystring: applicationListQuerySchema },
    },
    async (request) =>
      applications.listForPosting(request.params.id, request.user!.id, request.query),
  );

  app.post(
    "/postings/:id/applications",
    {
      preHandler: [fastify.requireRole("artist"), fastify.requireVerified],
      schema: { params: idParamSchema, body: createApplicationSchema },
      config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const application = await applications.apply(
        request.params.id,
        request.user!.id,
        request.body,
      );
      return reply.code(201).send(application);
    },
  );
};
