import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createReportSchema,
  paginationSchema,
  usernameSchema,
} from "@craftbid/shared";
import { notFound } from "../lib/errors.js";
import * as notifications from "./notifications/notifications.repository.js";
import * as reports from "./reports/reports.service.js";
import * as reviewsRepo from "./reviews/reviews.repository.js";
import * as profilesRepo from "./users/profiles.repository.js";
import { bufToUuid } from "../db/ids.js";

/**
 * The smaller surfaces: in-app notifications, abuse reports, and the review
 * list shown on a public profile.
 */
export const communityRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/notifications",
    {
      preHandler: fastify.requireAuth,
      schema: { querystring: paginationSchema },
    },
    async (request) =>
      notifications.listForUser(request.user!.id, request.query),
  );

  app.post(
    "/notifications/read",
    { preHandler: fastify.requireAuth },
    async (request) => {
      const updated = await notifications.markAllRead(request.user!.id);
      return { markedRead: updated };
    },
  );

  app.post(
    "/reports",
    {
      preHandler: fastify.requireAuth,
      schema: { body: createReportSchema },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const report = await reports.createReport(request.user!.id, request.body);
      return reply.code(201).send(report);
    },
  );

  // Public: reviews are the reputation signal a client uses to choose an artist.
  app.get(
    "/users/:username/reviews",
    {
      schema: {
        params: z.object({ username: usernameSchema }),
        querystring: paginationSchema,
      },
    },
    async (request) => {
      const profile = await profilesRepo.findProfileByUsername(
        request.params.username,
      );
      if (!profile) throw notFound("That profile does not exist.");

      const { items, total } = await reviewsRepo.listForUser(
        bufToUuid(profile.id)!,
        request.query,
      );
      return {
        items,
        total,
        limit: request.query.limit,
        offset: request.query.offset,
      };
    },
  );
};
