import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  COMMISSION_STATUSES,
  createReviewSchema,
  idParamSchema,
  paginationSchema,
} from "@craftbid/shared";
import * as service from "./commissions.service.js";

export const commissionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/commissions",
    {
      preHandler: fastify.requireAuth,
      schema: {
        querystring: paginationSchema.extend({
          status: z.enum(COMMISSION_STATUSES).optional(),
        }),
      },
    },
    async (request) => service.listMine(request.user!.id, request.query),
  );

  app.get(
    "/commissions/:id",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request) => service.getCommission(request.params.id, request.user!.id),
  );

  app.post(
    "/commissions/:id/complete",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request) => service.complete(request.params.id, request.user!.id),
  );

  app.post(
    "/commissions/:id/cancel",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request) => service.cancel(request.params.id, request.user!.id),
  );

  /**
   * There is deliberately no PATCH or DELETE for a review. Reputation that the
   * reviewed party can have edited away is not reputation.
   */
  app.post(
    "/commissions/:id/reviews",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: createReviewSchema },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const review = await service.createReview(
        request.params.id,
        request.user!.id,
        request.body,
      );
      return reply.code(201).send(review);
    },
  );
};
