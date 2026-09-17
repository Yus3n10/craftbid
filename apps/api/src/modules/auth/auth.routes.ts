import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  forgotPasswordSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from "@craftbid/shared";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
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
 * body and the result comes back as a validation failure. Preprocessing an
 * absent body into an empty object makes the optional field genuinely optional.
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
export function setSession(reply: FastifyReply, tokens: service.SessionTokens): void {
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
      const result = await service.register(request.body);

      // Email verification on: the account exists, nobody is signed in, and
      // the link in the email is what starts the session.
      if ("status" in result) return reply.code(202).send(result);

      const tokens = result;
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
    "/verify-email",
    {
      schema: { body: verifyEmailSchema },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const tokens = await service.verifyEmail(request.body.token);
      setSession(reply, tokens);
      return reply.send({
        user: await getMe(tokens.userId),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    },
  );

  app.post(
    "/resend-verification",
    {
      schema: { body: resendVerificationSchema },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const target = request.user
        ? { userId: request.user.id }
        : request.body.email
          ? { email: request.body.email }
          : null;

      // Not awaited. Whether an address is registered changes how much work
      // this does (a lookup, then an email), and answering only after that
      // work would let the response time say who has an account.
      if (target) {
        service.resendVerification(target).catch((error: unknown) => {
          request.log.error({ err: error }, "Resending a verification link failed");
        });
      }
      return reply.code(204).send();
    },
  );

  app.post(
    "/forgot-password",
    {
      schema: { body: forgotPasswordSchema },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      // Not awaited, for the same reason as resend-verification: the work
      // differs for a registered address, and waiting would let the response
      // time say who has an account.
      service.requestPasswordReset(request.body.email).catch((error: unknown) => {
        request.log.error({ err: error }, "Sending a password reset link failed");
      });
      return reply.code(204).send();
    },
  );

  app.post(
    "/reset-password",
    {
      schema: { body: resetPasswordSchema },
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      await service.resetPassword(request.body.token, request.body.password);
      // Whatever session this browser had was just revoked with the others.
      clearSession(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    "/login",
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const throttle = fastify.loginThrottle;
      const email = request.body.email;
      if (throttle?.isLocked(email)) {
        throw new AppError(
          429,
          "rate_limited",
          "Too many sign-in attempts for this account. Wait 15 minutes, or reset your password.",
        );
      }

      let tokens: service.SessionTokens;
      try {
        tokens = await service.login(request.body);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 401) throttle?.recordFailure(email);
        throw error;
      }
      throttle?.clear(email);
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
      let tokens: service.SessionTokens;
      try {
        tokens = await service.refresh(presented);
      } catch (error) {
        // A refresh cookie that can no longer be renewed (revoked, expired,
        // or its account closed) is dead weight: left in place, every later
        // visit would try it and fail again.
        if (error instanceof AppError && error.statusCode === 401) clearSession(reply);
        throw error;
      }
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

  /**
   * "Is anyone signed in?", for the web app's first request of every page.
   *
   * /auth/me says no with a 401, and a browser prints every 401 as a red error
   * in the console, so every signed-out visit looked broken to anyone who
   * opened it. Here "nobody" is an ordinary 200. A 401 is kept for the case it
   * still means something: a credential was sent that no longer works (a
   * lapsed access token, or only the refresh cookie left), so the app should
   * renew the session and ask again.
   */
  app.get("/session", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (request.user) return { user: await getMe(request.user.id) };

    const presentedSomething =
      Boolean(request.headers.authorization) ||
      Boolean(request.cookies?.[ACCESS_COOKIE]) ||
      Boolean(request.cookies?.[REFRESH_COOKIE]);
    if (presentedSomething) {
      throw new AppError(401, "session_expired", "Session expired. Please sign in again.");
    }
    return { user: null };
  });

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
