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

  describe("notifications", () => {
    async function noticesFor(session: Session) {
      const app = await getTestApp();
      const response = await app.inject({
        method: "GET",
        url: "/notifications?limit=20",
        headers: authHeaders(session),
      });
      return response.json().items as { type: string; payload: Record<string, unknown> }[];
    }

    it("tells the artist when someone reacts, and which reaction it was", async () => {
      const app = await getTestApp();
      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(client),
        payload: { kind: "support" },
      });

      const notices = await noticesFor(artist);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.type).toBe("post_reaction");
      expect(notices[0]!.payload).toMatchObject({ kind: "support", postId });
    });

    it("leaves one notice when someone cycles through reactions", async () => {
      const app = await getTestApp();
      for (const kind of ["like", "support", "love"]) {
        await app.inject({
          method: "PUT",
          url: `/posts/${postId}/reaction`,
          headers: authHeaders(client),
          payload: { kind },
        });
      }

      // Three clicks, one opinion. Three notices would bury everything else.
      const notices = await noticesFor(artist);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.payload).toMatchObject({ kind: "love" });
    });

    it("keeps one notice per person, not per post", async () => {
      const app = await getTestApp();
      for (const session of [client, bystander]) {
        await app.inject({
          method: "PUT",
          url: `/posts/${postId}/reaction`,
          headers: authHeaders(session),
          payload: { kind: "love" },
        });
      }

      expect(await noticesFor(artist)).toHaveLength(2);
    });

    it("tells the artist about every comment separately", async () => {
      const app = await getTestApp();
      for (const body of ["The first thing said.", "A second, separate thought."]) {
        await app.inject({
          method: "POST",
          url: `/posts/${postId}/comments`,
          headers: authHeaders(client),
          payload: { body },
        });
      }

      // Unlike reactions: two comments are two things somebody said.
      const notices = await noticesFor(artist);
      expect(notices).toHaveLength(2);
      expect(notices.every((n) => n.type === "post_comment")).toBe(true);
    });

    it("does not notify the artist about their own reaction or comment", async () => {
      const app = await getTestApp();
      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(artist),
        payload: { kind: "like" },
      });
      await app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        headers: authHeaders(artist),
        payload: { body: "Answering a question about my own piece." },
      });

      expect(await noticesFor(artist)).toHaveLength(0);
    });

    it("keeps a notice the artist has already read", async () => {
      const app = await getTestApp();
      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(client),
        payload: { kind: "love" },
      });
      await app.inject({
        method: "POST",
        url: "/notifications/read",
        headers: authHeaders(artist),
      });

      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/reaction`,
        headers: authHeaders(client),
        payload: { kind: "like" },
      });

      // Deduplication only replaces unread notices. One already read is a
      // record of something the artist saw, and rewriting it under them would
      // be worse than a duplicate.
      expect(await noticesFor(artist)).toHaveLength(2);
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

/**
 * Contact links.
 *
 * The scheme rules are the security-relevant part: a javascript: or data: URL
 * rendered as a profile link is stored cross-site scripting, and the profile
 * is the one page strangers are invited to look at.
 */
describe("contact links", () => {
  let artist: Session;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
  });

  async function save(links: unknown) {
    const app = await getTestApp();
    return app.inject({
      method: "PUT",
      url: "/me/links",
      headers: authHeaders(artist),
      payload: { links },
    });
  }

  it("accepts the messaging platforms artists actually use", async () => {
    const response = await save([
      { platform: "messenger", url: "https://m.me/nenahooks" },
      { platform: "whatsapp", url: "https://wa.me/639171234567" },
      { platform: "viber", url: "https://invite.viber.com/?g2=abc" },
      { platform: "telegram", url: "https://t.me/nenahooks" },
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json().links).toHaveLength(4);
  });

  it("turns a bare email address into a mailto link", async () => {
    const response = await save([{ platform: "email", url: "nena@gmail.com" }]);
    expect(response.statusCode).toBe(200);
    // Nobody should have to know to type the prefix.
    expect(response.json().links[0].url).toBe("mailto:nena@gmail.com");
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://insecure.example.com"],
    ["vbscript:msgbox(1)"],
  ])("refuses %s", async (url) => {
    const response = await save([{ platform: "website", url }]);
    expect(response.statusCode).toBe(400);
  });
});
