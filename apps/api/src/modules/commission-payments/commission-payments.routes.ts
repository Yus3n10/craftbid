import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  UPLOAD,
  balanceMethodSchema,
  idParamSchema,
  markFinishedSchema,
  reportProblemSchema,
  setPayoutAccountsSchema,
  shippingSchema,
  submitPaymentSchema,
  uuidSchema,
} from "@craftbid/shared";
import { badRequest } from "../../lib/errors.js";
import * as service from "./commission-payments.service.js";

const paymentParams = z.object({ id: uuidSchema, paymentId: uuidSchema });
const fileParams = z.object({ id: uuidSchema, fileId: uuidSchema });
const problemParams = z.object({ id: uuidSchema, problemId: uuidSchema });

/**
 * Payment records on commissions, and where artists are paid.
 *
 * Routes validate shape and require a session; every rule about who may do
 * what, and when, lives in the service, which re-derives both parties from
 * the database on each call.
 */
export const commissionPaymentRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/me/payout-accounts",
    { preHandler: fastify.requireRole("artist") },
    async (request) => service.getPayoutAccounts(request.user!.id),
  );

  app.put(
    "/me/payout-accounts",
    {
      preHandler: fastify.requireRole("artist"),
      schema: { body: setPayoutAccountsSchema },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request) => service.setPayoutAccounts(request.user!.id, request.body.accounts),
  );

  app.put(
    "/commissions/:id/balance-method",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema, body: balanceMethodSchema } },
    async (request, reply) => {
      await service.setBalanceMethod(request.params.id, request.user!.id, request.body.method);
      return reply.code(204).send();
    },
  );

  app.post(
    "/commissions/:id/files",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema },
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: UPLOAD.maxBytes, files: 1 } });
      if (!file) throw badRequest("No file was uploaded.");
      const buffer = await file.toBuffer();
      // A stream that hit the limit is flagged, not thrown, so a truncated file
      // would otherwise be stored silently.
      if (file.file.truncated) {
        throw badRequest(`Images must be under ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`);
      }
      const stored = await service.uploadFile(request.params.id, request.user!.id, buffer);
      return reply.code(201).send(stored);
    },
  );

  app.get(
    "/commissions/:id/files/:fileId",
    { preHandler: fastify.requireAuth, schema: { params: fileParams } },
    async (request, reply) => {
      const file = await service.readFile(request.params.id, request.params.fileId, request.user!.id);
      return reply
        .header("content-type", file.contentType)
        // Receipts carry names and numbers: never kept by a shared cache, and
        // not by the browser's disk cache either.
        .header("cache-control", "private, no-store")
        .header("content-disposition", "inline")
        .send(file.body);
    },
  );

  app.post(
    "/commissions/:id/payments",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: submitPaymentSchema },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      await service.submitPayment(request.params.id, request.user!.id, request.body);
      return reply.code(201).send();
    },
  );

  app.post(
    "/commissions/:id/payments/:paymentId/confirm",
    { preHandler: fastify.requireAuth, schema: { params: paymentParams } },
    async (request, reply) => {
      await service.decidePayment(request.params.id, request.params.paymentId, request.user!.id, "confirmed");
      return reply.code(204).send();
    },
  );

  app.post(
    "/commissions/:id/payments/:paymentId/reject",
    { preHandler: fastify.requireAuth, schema: { params: paymentParams } },
    async (request, reply) => {
      await service.decidePayment(request.params.id, request.params.paymentId, request.user!.id, "rejected");
      return reply.code(204).send();
    },
  );

  app.post(
    "/commissions/:id/balance-received",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema } },
    async (request, reply) => {
      await service.recordInPersonBalance(request.params.id, request.user!.id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/commissions/:id/finished",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema, body: markFinishedSchema } },
    async (request, reply) => {
      await service.markFinished(request.params.id, request.user!.id, request.body.photoFileIds);
      return reply.code(204).send();
    },
  );

  app.put(
    "/commissions/:id/shipping",
    { preHandler: fastify.requireAuth, schema: { params: idParamSchema, body: shippingSchema } },
    async (request, reply) => {
      await service.setShipping(
        request.params.id,
        request.user!.id,
        request.body.courier,
        request.body.trackingNumber,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/commissions/:id/problems",
    {
      preHandler: fastify.requireAuth,
      schema: { params: idParamSchema, body: reportProblemSchema },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      await service.reportProblem(request.params.id, request.user!.id, request.body);
      return reply.code(201).send();
    },
  );

  app.post(
    "/commissions/:id/problems/:problemId/withdraw",
    { preHandler: fastify.requireAuth, schema: { params: problemParams } },
    async (request, reply) => {
      await service.withdrawProblem(request.params.id, request.params.problemId, request.user!.id);
      return reply.code(204).send();
    },
  );
};
