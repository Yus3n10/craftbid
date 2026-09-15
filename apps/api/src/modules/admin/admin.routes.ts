import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  adminListQuerySchema,
  adminPaymentsQuerySchema,
  adminProblemsQuerySchema,
  adminUsersQuerySchema,
  moderationInputSchema,
  paginationSchema,
  resolveProblemSchema,
  resolveReportSchema,
  unsuspendSchema,
  uuidSchema,
  type ModerationInput,
} from "@craftbid/shared";
import * as moderation from "../moderation/moderation.service.js";
import * as service from "./admin.service.js";
import * as adminPayments from "./admin-payments.repository.js";

const idParams = z.object({ id: uuidSchema });

type Act = (staffId: string, targetId: string, input: ModerationInput) => Promise<void>;

/**
 * The admin screen's API. Staff-only through a hook that reads the flag from
 * the database on every request; every change goes through the moderation
 * service, which writes the audit row in the same transaction.
 *
 * Registered as an ordinary (encapsulated) plugin, so the hook applies to
 * these routes and nothing else.
 */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook("preHandler", fastify.requireStaff);

  const page = <T>(result: { items: T[]; total: number }, query: { limit: number; offset: number }) => ({
    items: result.items,
    total: result.total,
    limit: query.limit,
    offset: query.offset,
  });

  app.get("/admin/overview", async () => service.overview());

  app.get("/admin/reports", { schema: { querystring: adminListQuerySchema } }, async (request) =>
    page(await service.listReports(request.query.status, request.query.limit, request.query.offset), request.query),
  );

  for (const outcome of ["resolve", "dismiss"] as const) {
    app.post(
      `/admin/reports/:id/${outcome}`,
      { schema: { params: idParams, body: resolveReportSchema } },
      async (request, reply) => {
        await moderation.closeReport(
          request.user!.id,
          request.params.id,
          outcome === "resolve" ? "reviewed" : "dismissed",
          request.body.note,
        );
        return reply.code(204).send();
      },
    );
  }

  app.get("/admin/users", { schema: { querystring: adminUsersQuerySchema } }, async (request) =>
    page(await service.listUsers(request.query), request.query),
  );
  app.get("/admin/users/:id", { schema: { params: idParams } }, async (request) =>
    service.userDetail(request.params.id),
  );

  const actions: [string, Act][] = [
    ["/admin/users/:id/warn", moderation.warn],
    ["/admin/users/:id/suspend", moderation.suspend],
    ["/admin/users/:id/remove", moderation.removeAccount],
    ["/admin/posts/:id/remove", moderation.removePost],
    ["/admin/postings/:id/remove", moderation.removePosting],
    ["/admin/comments/:id/remove", moderation.removeComment],
  ];
  for (const [path, act] of actions) {
    app.post(path, { schema: { params: idParams, body: moderationInputSchema } }, async (request, reply) => {
      await act(request.user!.id, request.params.id, request.body);
      return reply.code(204).send();
    });
  }

  app.post(
    "/admin/users/:id/unsuspend",
    { schema: { params: idParams, body: unsuspendSchema } },
    async (request, reply) => {
      await moderation.unsuspend(request.user!.id, request.params.id, request.body.note);
      return reply.code(204).send();
    },
  );

  app.get("/admin/bugs", { schema: { querystring: adminListQuerySchema } }, async (request) =>
    page(await service.listBugs(request.query.status, request.query.limit, request.query.offset), request.query),
  );
  app.get("/admin/bugs/:id/screenshot", { schema: { params: idParams } }, async (request, reply) =>
    reply
      .header("content-type", "image/webp")
      // A screenshot can show someone's details: never kept by any cache.
      .header("cache-control", "private, no-store")
      .send(await service.bugScreenshot(request.params.id)),
  );
  app.post("/admin/bugs/:id/resolve", { schema: { params: idParams } }, async (request, reply) => {
    await moderation.resolveBug(request.user!.id, request.params.id);
    return reply.code(204).send();
  });

  app.get("/admin/problems", { schema: { querystring: adminProblemsQuerySchema } }, async (request) =>
    page(await adminPayments.listProblems(request.query.status, request.query.limit, request.query.offset), request.query),
  );
  app.post(
    "/admin/problems/:id/resolve",
    { schema: { params: idParams, body: resolveProblemSchema } },
    async (request, reply) => {
      await moderation.resolveProblem(request.user!.id, request.params.id, request.body);
      return reply.code(204).send();
    },
  );

  app.get("/admin/payments", { schema: { querystring: adminPaymentsQuerySchema } }, async (request) =>
    page(await adminPayments.listPayments(request.query), request.query),
  );
  app.get("/admin/payments/:id/receipt", { schema: { params: idParams } }, async (request, reply) => {
    const receipt = await moderation.viewPaymentReceipt(request.user!.id, request.params.id);
    return reply
      .header("content-type", receipt.contentType)
      // Names and account numbers: never kept by any cache.
      .header("cache-control", "private, no-store")
      .send(receipt.body);
  });

  app.get("/admin/actions", { schema: { querystring: paginationSchema } }, async (request) =>
    page(await service.listActions(request.query.limit, request.query.offset), request.query),
  );
};
