import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  updateArtistProfileSchema,
  updateExternalLinksSchema,
  updateProfileSchema,
  usernameSchema,
} from "@craftbid/shared";
import * as service from "./users.service.js";

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Public. Serves both artist portfolios and client profiles; the shape
  // differs only in whether the `artist` block is present.
  app.get(
    "/users/:username",
    { schema: { params: z.object({ username: usernameSchema }) } },
    async (request) => service.getPublicProfile(request.params.username),
  );

  app.patch(
    "/me/profile",
    {
      preHandler: fastify.requireAuth,
      schema: { body: updateProfileSchema },
    },
    async (request) => service.updateProfile(request.user!.id, request.body),
  );

  // Artist-only, enforced here rather than by hiding the form in the UI.
  app.patch(
    "/me/artist-profile",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { body: updateArtistProfileSchema },
    },
    async (request) => service.updateArtistProfile(request.user!.id, request.body),
  );

  // PUT rather than PATCH: the client sends the complete link set it wants.
  app.put(
    "/me/links",
    {
      preHandler: fastify.requireAuth,
      schema: { body: updateExternalLinksSchema },
    },
    async (request) => service.setExternalLinks(request.user!.id, request.body.links),
  );
};
