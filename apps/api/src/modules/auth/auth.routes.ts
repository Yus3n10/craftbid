import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { loginSchema, passwordSchema, registerSchema } from "@raxtan/shared";
import { config } from "../../config.js";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
  parseDurationSeconds,
} from "../../lib/tokens.js";
import * as service from "./auth.service.js";
import { getMe } from "../users/users.service.js";

function setSession(reply: FastifyReply, tokens: service.SessionTokens): void {
  reply.setCookie(
    ACCESS_COOKIE,
    tokens.accessToken,
    cookieOptions(parseDurationSeconds(config.auth.accessTokenTtl)),
  );
  reply.setCookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(config.auth.refreshTokenTtlDays * 86_400),
  );
}

function clearSession(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/register",
    {
      schema: { body: registerSchema },
      config: {
        // Registration is the cheapest way to burn server CPU (one scrypt hash
        // each) and to fill the table with junk accounts.
        rateLimit: { max: 5, timeWindow: "10 minutes" },
      },
    },
    async (request, reply) => {
      const tokens = await service.register(request.body);
      setSession(reply, tokens);

      // The token is also returned in the body for the desktop build, which
      // uses the Authorization header rather than cookies.
      return reply.code(201).send({
        user: await getMe(tokens.userId),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  );

  app.post(
    "/login",
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const tokens = await service.login(request.body);
      setSession(reply, tokens);
      return reply.send({
        user: await getMe(tokens.userId),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  );

  app.post(
    "/refresh",
    {
      schema: {
        body: z.object({ refreshToken: z.string().optional() }).optional(),
      },
    },
    async (request, reply) => {
      const presented =
        request.cookies?.[REFRESH_COOKIE] ?? request.body?.refreshToken;
      const tokens = await service.refresh(presented);
      setSession(reply, tokens);
      return reply.send({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  );

  app.post(
    "/logout",
    {
      schema: {
        body: z.object({ refreshToken: z.string().optional() }).optional(),
      },
    },
    async (request, reply) => {
      // The desktop build has no cookie to clear, so it sends the token it
      // holds. Without this its refresh token would stay valid after sign-out.
      const presented =
        request.cookies?.[REFRESH_COOKIE] ?? request.body?.refreshToken;
      await service.logout(presented);
      clearSession(reply);
      return reply.code(204).send();
    },
  );

  app.get(
    "/me",
    { preHandler: fastify.requireAuth },
    async (request) => getMe(request.user!.id),
  );

  app.post(
    "/change-password",
    {
      preHandler: fastify.requireAuth,
      schema: {
        body: z.object({
          currentPassword: z.string().min(1),
          newPassword: passwordSchema,
        }),
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      await service.changePassword(
        request.user!.id,
        request.body.currentPassword,
        request.body.newPassword,
      );
      // Every session was just revoked, including this one.
      clearSession(reply);
      return reply.code(204).send();
    },
  );
};
