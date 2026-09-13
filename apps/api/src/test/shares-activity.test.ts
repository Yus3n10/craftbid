import { beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Sharing posts to a profile, and each person's own activity history.
 *
 * The rules held here: a share always carries the original artist, only
 * portfolio posts can be shared, nobody reads anyone else's history, and a
 * post taken down disappears from shares and history alike.
 */
describe("sharing posts", () => {
  let artist: Session;
  let client: Session;
  let other: Session;
  let postId: string;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    client = await registerUser("client");
    other = await registerUser("artist");
    postId = (await createArtistPost(artist, "Abaca table runner")).id;
  });

  it("puts the share on the sharer's profile with the original artist and the caption", async () => {
    const app = await getTestApp();
    const put = await app.inject({
      method: "PUT",
      url: `/posts/${postId}/share`,
      headers: authHeaders(client),
      payload: { caption: "Look at this weave" },
    });
    expect(put.statusCode).toBe(204);

    const shares = await app.inject({ method: "GET", url: `/users/${client.username}/shares` });
    expect(shares.statusCode).toBe(200);
    const [item] = shares.json().items;
    expect(shares.json().total).toBe(1);
    expect(item.id).toBe(postId);
    // Credit stays with the person who made it.
    expect(item.artist.username).toBe(artist.username);
    expect(item.share.user.username).toBe(client.username);
    expect(item.share.caption).toBe("Look at this weave");
  });

  it("shows the share in the feed alongside the post, and counts it", async () => {
    const app = await getTestApp();
    await app.inject({
      method: "PUT",
      url: `/posts/${postId}/share`,
      headers: authHeaders(client),
      payload: {},
    });

    const feed = await app.inject({ method: "GET", url: "/feed", headers: authHeaders(client) });
    const items = feed.json().items as { id: string; share?: { user: { username: string } }; shareCount: number; shared?: boolean }[];
    expect(feed.json().total).toBe(2);
    // Newest first: the share happened after the post.
    expect(items[0]!.share?.user.username).toBe(client.username);
    expect(items[1]!.share).toBeUndefined();
    expect(items.every((item) => item.id === postId && item.shareCount === 1)).toBe(true);
    expect(items[0]!.shared).toBe(true);
  });

  it("edits the caption when shared again rather than sharing twice, and tells the artist once", async () => {
    const app = await getTestApp();
    for (const caption of ["First", "Second"]) {
      await app.inject({
        method: "PUT",
        url: `/posts/${postId}/share`,
        headers: authHeaders(client),
        payload: { caption },
      });
    }

    const shares = await app.inject({ method: "GET", url: `/users/${client.username}/shares` });
    expect(shares.json().total).toBe(1);
    expect(shares.json().items[0].share.caption).toBe("Second");

    const notices = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: authHeaders(artist),
    });
    const shared = notices.json().items.filter((n: { type: string }) => n.type === "post_shared");
    expect(shared).toHaveLength(1);
  });

  it("refuses an artist sharing their own post", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "PUT",
      url: `/posts/${postId}/share`,
      headers: authHeaders(artist),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("requires an account", async () => {
    const app = await getTestApp();
    const response = await app.inject({ method: "PUT", url: `/posts/${postId}/share`, payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("cannot share a craft request, which is private negotiation, not public work", async () => {
    const app = await getTestApp();
    const posting = await createPosting(client);
    const response = await app.inject({
      method: "PUT",
      url: `/posts/${posting.id}/share`,
      headers: authHeaders(other),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it("unsharing removes it, and a taken-down post drops out of shares", async () => {
    const app = await getTestApp();
    await app.inject({ method: "PUT", url: `/posts/${postId}/share`, headers: authHeaders(client), payload: {} });
    await app.inject({ method: "PUT", url: `/posts/${postId}/share`, headers: authHeaders(other), payload: {} });

    const removed = await app.inject({ method: "DELETE", url: `/posts/${postId}/share`, headers: authHeaders(client) });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/users/${client.username}/shares` })).json().total).toBe(0);

    await app.inject({ method: "DELETE", url: `/posts/${postId}`, headers: authHeaders(artist) });
    expect((await app.inject({ method: "GET", url: `/users/${other.username}/shares` })).json().total).toBe(0);
    expect((await app.inject({ method: "GET", url: "/feed" })).json().total).toBe(0);
  });

  it("rejects an over-long caption", async () => {
    const app = await getTestApp();
    const response = await app.inject({
      method: "PUT",
      url: `/posts/${postId}/share`,
      headers: authHeaders(client),
      payload: { caption: "x".repeat(501) },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("activity history", () => {
  let artist: Session;
  let reader: Session;
  let stranger: Session;
  let postId: string;
  let secondPostId: string;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    reader = await registerUser("client");
    stranger = await registerUser("client");
    postId = (await createArtistPost(artist, "Rattan lamp")).id;
    secondPostId = (await createArtistPost(artist, "Clay jar")).id;
  });

  async function act() {
    const app = await getTestApp();
    const headers = authHeaders(reader);
    await app.inject({ method: "PUT", url: `/posts/${postId}/reaction`, headers, payload: { kind: "love" } });
    await app.inject({ method: "POST", url: `/posts/${postId}/comments`, headers, payload: { body: "Beautiful light" } });
    await app.inject({ method: "PUT", url: `/posts/${secondPostId}/save`, headers });
    await app.inject({ method: "PUT", url: `/posts/${secondPostId}/share`, headers, payload: { caption: "For the house" } });
  }

  it("lists what this person did, newest first, with the post and when", async () => {
    await act();
    const app = await getTestApp();
    const response = await app.inject({ method: "GET", url: "/me/activity", headers: authHeaders(reader) });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(4);
    expect(body.items.map((item: { kind: string }) => item.kind)).toEqual(["share", "save", "comment", "reaction"]);

    const [share, , comment, reaction] = body.items;
    expect(share.caption).toBe("For the house");
    expect(share.post).toMatchObject({ id: secondPostId, caption: "Clay jar" });
    expect(share.post.artist.username).toBe(artist.username);
    expect(comment.comment.body).toBe("Beautiful light");
    expect(reaction.reaction).toBe("love");
    expect(Number.isNaN(Date.parse(reaction.at))).toBe(false);
  });

  it("filters to one kind", async () => {
    await act();
    const app = await getTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/me/activity?kind=comment",
      headers: authHeaders(reader),
    });
    expect(response.json().total).toBe(1);
    expect(response.json().items[0].kind).toBe("comment");
  });

  it("is private: other people see only their own, and signed out sees nothing", async () => {
    await act();
    const app = await getTestApp();
    const strangers = await app.inject({ method: "GET", url: "/me/activity", headers: authHeaders(stranger) });
    expect(strangers.json().total).toBe(0);

    const anonymous = await app.inject({ method: "GET", url: "/me/activity" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("follows undo: a removed reaction leaves the history too", async () => {
    await act();
    const app = await getTestApp();
    await app.inject({ method: "DELETE", url: `/posts/${postId}/reaction`, headers: authHeaders(reader) });
    const response = await app.inject({
      method: "GET",
      url: "/me/activity?kind=reaction",
      headers: authHeaders(reader),
    });
    expect(response.json().total).toBe(0);
  });

  it("leaves out posts the artist took down", async () => {
    await act();
    const app = await getTestApp();
    await app.inject({ method: "DELETE", url: `/posts/${secondPostId}`, headers: authHeaders(artist) });
    const response = await app.inject({ method: "GET", url: "/me/activity", headers: authHeaders(reader) });
    expect(response.json().total).toBe(2);
    expect(response.json().items.every((item: { post: { id: string } }) => item.post.id === postId)).toBe(true);
  });
});
