import type { FastifyPluginAsync } from "fastify";
import { UPLOAD } from "@craftbid/shared";
import { badRequest } from "../../lib/errors.js";
import * as service from "./bug-reports.service.js";

export const bugReportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/bug-reports",
    { preHandler: fastify.requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const fields: Record<string, string> = {};
      let screenshot: Buffer | null = null;

      for await (const part of request.parts({ limits: { fileSize: UPLOAD.maxBytes, files: 1 } })) {
        if (part.type === "file") {
          const body = await part.toBuffer();
          if (part.file.truncated) {
            throw badRequest(`Screenshots must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`);
          }
          if (part.fieldname === "screenshot") screenshot = body;
        } else if (typeof part.value === "string") {
          fields[part.fieldname] = part.value;
        }
      }

      return reply.code(201).send(await service.create(request.user!.id, fields, screenshot));
    },
  );
};
