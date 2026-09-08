import type { FastifyPluginAsync } from "fastify";
import { UPLOAD } from "@raxtan/shared";
import { badRequest } from "../../lib/errors.js";
import { processUpload } from "./images.service.js";

export const imageRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Uploads are a separate step from creating a posting or a post.
   *
   * The alternative, sending images alongside the form, means a failed upload
   * mid-request either loses the whole form or leaves a half-built record. Here
   * the client uploads first, gets back ids, and submits those with the form;
   * anything uploaded and never attached is swept later as an orphan.
   */
  fastify.post(
    "/images",
    {
      preHandler: fastify.requireAuth,
      config: { rateLimit: { max: 40, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const file = await request.file({
        limits: { fileSize: UPLOAD.maxBytes, files: 1 },
      });

      if (!file) {
        throw badRequest("No file was uploaded.");
      }

      const buffer = await file.toBuffer();

      // @fastify/multipart flags a stream that hit the limit rather than
      // throwing, so a truncated file would otherwise be stored silently.
      if (file.file.truncated) {
        throw badRequest(
          `Images must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`,
        );
      }

      const image = await processUpload(request.user!.id, buffer);
      return reply.code(201).send(image);
    },
  );
};
