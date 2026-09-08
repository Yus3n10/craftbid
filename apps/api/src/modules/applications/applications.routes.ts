import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { applicationListQuerySchema, idParamSchema } from "@raxtan/shared";
import * as service from "./applications.service.js";

export const applicationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/applications/mine",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { querystring: applicationListQuerySchema },
    },
    async (request) => service.listMine(request.user!.id, request.query),
  );

  app.get(
    "/applications/:id",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request) => service.getApplication(request.params.id, request.user!),
  );

  // Selecting an artist. Also declines the other bids, opens the commission and
  // closes the posting, all in one transaction.
  app.post(
    "/applications/:id/accept",
    {
      preHandler: fastify.requireRole("client"),
      schema: { params: idParamSchema },
    },
    async (request) => service.accept(request.params.id, request.user!.id),
  );

  app.post(
    "/applications/:id/reject",
    {
      preHandler: fastify.requireRole("client"),
      schema: { params: idParamSchema },
    },
    async (request) => service.reject(request.params.id, request.user!.id),
  );

  app.post(
    "/applications/:id/withdraw",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { params: idParamSchema },
    },
    async (request) => service.withdraw(request.params.id, request.user!.id),
  );
};
