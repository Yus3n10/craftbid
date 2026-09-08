import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { UserRole } from "@raxtan/shared";
import { forbidden, unauthorized } from "../lib/errors.js";
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
    }
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    if (!request.user) throw unauthorized();
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
