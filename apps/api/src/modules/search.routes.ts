import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { SearchResultsDto } from "@craftbid/shared";
import { searchQuerySchema } from "@craftbid/shared";
import { db } from "../db/query.js";
import { bufToUuid } from "../db/ids.js";
import { getStorage } from "../lib/storage/index.js";

/**
 * One search box over people, work and open requests.
 *
 * Case-insensitive substring matching, which cannot use an index and will not
 * survive real scale. At this size it is the honest choice: Oracle Text would
 * add an index type, a sync job and a query dialect for a table that currently
 * holds tens of rows. The query length cap in the schema is what keeps the
 * worst case bounded until that trade changes.
 *
 * Email is never searched and never returned. Someone who knows an address
 * should not be able to confirm it belongs to an account here.
 */
export const searchRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/search",
    {
      schema: { querystring: searchQuerySchema },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request): Promise<SearchResultsDto> => {
      const { q, kind, limit } = request.query;
      const storage = getStorage();
      const term = `%${q.toLowerCase()}%`;

      const wantPeople = (role: "artist" | "client") =>
        kind === "all" || kind === (role === "artist" ? "artists" : "clients");

      async function people(role: "artist" | "client") {
        if (!wantPeople(role)) return [];
        const rows = await db.many<{
          id: Buffer;
          username: string;
          displayName: string;
          avatarId: Buffer | null;
          avatarKey: string | null;
        }>(
          `SELECT u.id, u.username, u.display_name,
                  av.id AS avatar_id, av.object_key AS avatar_key
             FROM users u
             LEFT JOIN images av ON av.id = u.avatar_image_id
            WHERE u.role = :role
              AND (LOWER(u.display_name) LIKE :term OR LOWER(u.username) LIKE :term)
            ORDER BY u.display_name
            FETCH FIRST :limit ROWS ONLY`,
          { role, term, limit },
        );
        return rows.map((row) => ({
          id: bufToUuid(row.id)!,
          username: row.username,
          displayName: row.displayName,
          role,
          avatar:
            row.avatarId && row.avatarKey
              ? {
                  id: bufToUuid(row.avatarId)!,
                  url: storage.urlFor(row.avatarKey),
                  width: 0,
                  height: 0,
                }
              : null,
        }));
      }

      async function posts() {
        if (kind !== "all" && kind !== "posts") return [];
        const rows = await db.many<{
          id: Buffer;
          caption: string;
          imageId: Buffer | null;
          objectKey: string | null;
          width: number | null;
          height: number | null;
        }>(
          `SELECT p.id, p.caption,
                  i.id AS image_id, i.object_key, i.width, i.height
             FROM artist_posts p
             LEFT JOIN artist_post_images pi
               ON pi.post_id = p.id AND pi.sort_order = 0
             LEFT JOIN images i ON i.id = pi.image_id
            WHERE p.status = 'published'
              AND (LOWER(p.caption) LIKE :term OR LOWER(p.description) LIKE :term)
            ORDER BY p.created_at DESC
            FETCH FIRST :limit ROWS ONLY`,
          { term, limit },
        );
        return rows.map((row) => ({
          id: bufToUuid(row.id)!,
          caption: row.caption,
          coverImage:
            row.imageId && row.objectKey
              ? {
                  id: bufToUuid(row.imageId)!,
                  url: storage.urlFor(row.objectKey),
                  width: row.width ?? 0,
                  height: row.height ?? 0,
                }
              : null,
        }));
      }

      async function requests() {
        if (kind !== "all" && kind !== "requests") return [];
        const rows = await db.many<{
          id: Buffer;
          title: string;
          minBudgetCentavos: number;
          categorySlug: string;
          categoryName: string;
          categoryDescription: string;
        }>(
          `SELECT p.id, p.title, p.min_budget_centavos,
                  c.slug AS category_slug, c.name AS category_name,
                  c.description AS category_description
             FROM postings p
             JOIN craft_categories c ON c.id = p.category_id
            WHERE p.status = 'open'
              AND (LOWER(p.title) LIKE :term OR LOWER(p.description) LIKE :term)
            ORDER BY p.created_at DESC
            FETCH FIRST :limit ROWS ONLY`,
          { term, limit },
        );
        return rows.map((row) => ({
          id: bufToUuid(row.id)!,
          title: row.title,
          minBudgetCentavos: Number(row.minBudgetCentavos),
          category: {
            slug: row.categorySlug,
            name: row.categoryName,
            description: row.categoryDescription,
          },
        }));
      }

      const [artists, clients, foundPosts, foundRequests] = await Promise.all([
        people("artist"),
        people("client"),
        posts(),
        requests(),
      ]);

      return {
        artists,
        clients,
        posts: foundPosts,
        requests: foundRequests,
      };
    },
  );
};
