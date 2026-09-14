import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { UserRole } from "@craftbid/shared";
import { AppError, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { emailVerificationEnabled } from "../lib/mail/index.js";
import { findById } from "../modules/users/users.repository.js";
import { ACCESS_COOKIE, verifyAccessToken } from "../lib/tokens.js";

export interface AuthUser {
  id: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated when a valid access token is present, otherwise undefined. */
    user?: AuthUser;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      role: UserRole,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVerified: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireStaff: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Identity is resolved for every request, but never enforced here. Routes opt
 * into enforcement with `requireAuth` or `requireRole`, which keeps public
 * endpoints able to vary their response for a signed-in viewer without
 * duplicating token parsing.
 *
 * This is the security boundary. The frontend's route guards are a convenience
 * for the user, not a control: every protected route below re-derives identity
 * from the token and re-checks ownership against the database.
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request) => {
    // Cookie for the browser; bearer header for the desktop build and any
    // scripted client, which cannot rely on cookie handling.
    const header = request.headers.authorization;
    const bearer =
      header?.startsWith("Bearer ") === true ? header.slice(7) : undefined;
    const token = bearer ?? request.cookies?.[ACCESS_COOKIE];
    if (!token) return;

    const claims = await verifyAccessToken(token);
    if (claims) {
      request.user = { id: claims.sub, role: claims.role };

      // Writes check the account is still active. The token cannot say: it
      // was issued before any suspension and stays valid for 15 minutes.
      // Signing out is always allowed.
      const writing = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (writing && request.url !== "/auth/logout") {
        const account = await findById(claims.sub);
        if (!account || account.status !== "active") {
          throw new AppError(403, "account_inactive", "This account cannot do that right now.");
        }
        // A token minted before a switch between artist and client still
        // carries the old role. A 401 makes the web app refresh, and the
        // refreshed token carries the role the account has now.
        if (account.role !== claims.role) {
          throw unauthorized("Your account changed. Please sign in again.");
        }
      }
    }
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
  });

  /**
   * For actions that put something in front of other people: posting,
   * bidding, reacting, commenting, saving and sharing. An account that has not
   * proved its address can sign in and look around, and is refused these.
   *
   * Read from the database rather than from the access token, so confirming
   * the address in one browser takes effect in every other one immediately,
   * not when their token next rotates.
   */
  /**
   * The admin screen. Read from the database every time, so taking staff
   * access away, or suspending a staff account, applies to the next request.
   * A 404 rather than a 403: nothing tells a stranger the admin API exists.
   */
  app.decorate("requireStaff", async (request: FastifyRequest) => {
    if (!request.user) throw notFound();
    const account = await findById(request.user.id);
    if (!account?.isStaff || account.status !== "active") throw notFound();
  });

  app.decorate("requireVerified", async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
    if (!emailVerificationEnabled()) return;
    const user = await findById(request.user.id);
    if (!user?.emailVerifiedAt) {
      throw new AppError(
        403,
        "email_unverified",
        "Confirm your email first. Use the link we sent you, or ask for a new one from the banner at the top of the page.",
      );
    }
  });

  app.decorate("requireRole", (role: UserRole) => {
    return async (request: FastifyRequest) => {
      if (!request.user) throw unauthorized();
      if (request.user.role !== role) {
        throw forbidden(
          role === "client"
            ? "Only client accounts can do that."
            : "Only artist accounts can do that.",
        );
      }
    };
  });
};

export default fp(authPlugin, { name: "auth" });
