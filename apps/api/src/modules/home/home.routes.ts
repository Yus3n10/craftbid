import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { homeQuerySchema } from "@craftbid/shared";
import { homeFeed } from "./home.service.js";

export const homeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * The home feed, ordered for whoever asks. Public: signed out, it is newest
   * first. The saved-posts view stays on /feed.
   */
  app.get(
    "/home",
    { schema: { querystring: homeQuerySchema } },
    async (request) => homeFeed(request.query, request.user?.id ?? null),
  );
};
