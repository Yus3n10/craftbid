import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { loginSchema, passwordSchema, registerSchema } from "@craftbid/shared";
import { config } from "../../config.js";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearCookieOptions,
  cookieOptions,
  parseDurationSeconds,
} from "../../lib/tokens.js";
import * as service from "./auth.service.js";
import { getMe } from "../users/users.service.js";

/**
 * Body for the two routes that work with or without one.
 *
 * A bare `.optional()` is not enough: Fastify hands the validator an absent
 * body and the result comes back as a validation failure, so a plain POST to
 * logout answered 400. Preprocessing an absent body into an empty object makes
 * the optional field genuinely optional.
 *
 * The browser sends nothing here and relies on its cookie; the desktop build
 * has no cookie and sends the token it holds.
 */
const optionalRefreshTokenBody = z.preprocess(
  (value) => value ?? {},
  z.object({ refreshToken: z.string().optional() }),
);

/**
 * Sets both session cookies, as persistent or session cookies depending on
 * whether "Keep me logged in" was ticked when the session began.
 *
 * Both follow the same choice. A persistent access cookie on an unremembered
 * session would keep someone signed in for up to fifteen minutes after they
 * had closed the browser on a shared phone, which is exactly the case the
 * unticked box exists for.
 */
function setSession(reply: FastifyReply, tokens: service.SessionTokens): void {
  reply.setCookie(
    ACCESS_COOKIE,
    tokens.accessToken,
    cookieOptions(
      tokens.persistent ? parseDurationSeconds(config.auth.accessTokenTtl) : undefined,
    ),
  );
  reply.setCookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(tokens.persistent ? config.auth.refreshTokenTtlDays * 86_400 : undefined),
  );
}

function clearSession(reply: FastifyReply): void {
  // Same attributes the cookies were set with, or the browser will not
  // recognise these as the same cookies and the session outlives sign-out.
  reply.clearCookie(ACCESS_COOKIE, clearCookieOptions());
  reply.clearCookie(REFRESH_COOKIE, clearCookieOptions());
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
      schema: { body: optionalRefreshTokenBody },
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
      schema: { body: optionalRefreshTokenBody },
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
