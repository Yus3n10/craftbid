import { beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createArtistPost,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Reactions, comments and saves.
 *
 * The rule this file exists to hold is the last one: none of it reaches craft
 * requests. Public commentary on a request would let artists read each other's
 * interest and price against it, which is the harm bid privacy already
 * prevents, so it has to stay prevented as the social layer grows.
 */
describe("the social layer", () => {
  let artist: Session;
  let client: Session;
  let bystander: Session;
  let postId: string;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    client = await registerUser("client");
    bystander = await registerUser("client");

    const post = await createArtistPost(artist, "Butterfly wing cardigan");
    postId = post.id;
  });

  describe("reactions", () => {
    it("records one reaction per person and reports it back to them", async () => {
      const app = await getTestApp();

      const put = await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(client),
        payload: { kind: "love" },
      });
      expect(put.statusCode).toBe(204);

      const seen = await app.inject({
        method: "GET",
        url: `/posts/${postId}`,
        headers: authHeaders(client),
      });
      expect(seen.json().reactions).toMatchObject({ love: 1, total: 1, mine: "love" });
    });

    it("replaces rather than stacks when someone changes their mind", async () => {
      const app = await getTestApp();

      for (const kind of ["like", "support", "love"]) {
        await app.inject({
          method: "PUT",
          url: `/posts/${postId}/reaction`,
          headers: authHeaders(client),
          payload: { kind },
        });
      }

      const seen = await app.inject({
        method: "GET",
        url: `/posts/${postId}`,
        headers: authHeaders(client),
      });
      // Three clicks, one person, one reaction. A count here is a count of
      // people, which is the only thing that makes it worth showing.
      expect(seen.json().reactions).toMatchObject({
        love: 1,
        support: 0,
        like: 0,
        total: 1,
        mine: "love",
      });
    });

    it("counts two people separately and hides whose is whose", async () => {
      const app = await getTestApp();
      for (const session of [client, bystander]) {
        await app.inject({
          method: "PUT",
          url: `/posts/${postId}/reaction`,
          headers: authHeaders(session),
          payload: { kind: "support" },
        });
      }

      const anonymous = await app.inject({ method: "GET", url: `/posts/${postId}` });
      expect(anonymous.json().reactions).toMatchObject({ support: 2, total: 2 });
      // A signed-out reader gets counts and no idea who reacted.
      expect(anonymous.json().reactions.mine).toBeNull();
    });

    it("refuses an unknown reaction kind", async () => {
      const app = await getTestApp();
      const response = await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(client),
        payload: { kind: "angry" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("refuses an anonymous reaction", async () => {
      const app = await getTestApp();
      const response = await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        payload: { kind: "like" },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("comments", () => {
    it("lets anyone signed in comment, and shows it to everyone", async () => {
      const app = await getTestApp();

      const created = await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(client),
        payload: { body: "The colourwork on the sleeve is lovely." },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().mine).toBe(true);

      const anonymous = await app.inject({
        method: "GET",
        url: `/posts/${postId}/comments`,
      });
      expect(anonymous.json()).toHaveLength(1);
      // "mine" is about the reader, so it must be false for a stranger.
      expect(anonymous.json()[0].mine).toBe(false);
    });

    it("refuses an empty comment", async () => {
      const app = await getTestApp();
      const response = await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(client),
        payload: { body: "   " },
      });
      expect(response.statusCode).toBe(400);
    });

    it("lets the author delete their own comment", async () => {
      const app = await getTestApp();
      const created = await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(client),
        payload: { body: "Second thoughts about saying this." },
      });

      const removed = await app.inject({
        method: "DELETE",
        url: `/comments/${created.json().id}`,
        headers: authHeaders(client),
      });
      expect(removed.statusCode).toBe(204);
    });

    it("lets the artist clear a comment from their own post", async () => {
      const app = await getTestApp();
      const created = await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(bystander),
        payload: { body: "Something the artist should be able to remove." },
      });

      // No moderator exists in this product, so the person whose portfolio it
      // is has to be able to clear their own page.
      const removed = await app.inject({
        method: "DELETE",
        url: `/comments/${created.json().id}`,
        headers: authHeaders(artist),
      });
      expect(removed.statusCode).toBe(204);
    });

    it("stops a stranger deleting someone else's comment", async () => {
      const app = await getTestApp();
      const created = await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(client),
        payload: { body: "Not yours to delete." },
      });

      const removed = await app.inject({
        method: "DELETE",
        url: `/comments/${created.json().id}`,
        headers: authHeaders(bystander),
      });
      expect(removed.statusCode).toBe(403);
    });
  });

  describe("saving", () => {
    it("saves a post and returns it in the saved feed, for that reader only", async () => {
      const app = await getTestApp();

      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/save`,
        headers: authHeaders(client),
      });

      const mine = await app.inject({
        method: "GET",
        url: "/feed?saved=true",
        headers: authHeaders(client),
      });
      expect(mine.json().items).toHaveLength(1);
      expect(mine.json().items[0].saved).toBe(true);

      const theirs = await app.inject({
        method: "GET",
        url: "/feed?saved=true",
        headers: authHeaders(bystander),
      });
      expect(theirs.json().items).toHaveLength(0);
    });

    it("unsaves again", async () => {
      const app = await getTestApp();
      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/save`,
        headers: authHeaders(client),
      });
      await app.inject({
        method: "DELETE",
        url: `/posts/${postId}/save`,
        headers: authHeaders(client),
      });

      const mine = await app.inject({
        method: "GET",
        url: "/feed?saved=true",
        headers: authHeaders(client),
      });
      expect(mine.json().items).toHaveLength(0);
    });
  });

  describe("craft requests stay out of it", () => {
    it("has no reaction, comment or save endpoint for a posting", async () => {
      const app = await getTestApp();

      for (const [method, url] of [
        ["PUT", `/postings/${postId}/reaction`],
        ["POST", `/postings/${postId}/comments`],
        ["PUT", `/postings/${postId}/save`],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers: authHeaders(client),
          payload: { kind: "like", body: "should not exist" },
        });
        // 404 from the router: the route is not defined, and must not be.
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    });
  });
});
