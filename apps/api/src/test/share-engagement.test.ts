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
 * A share is its own card: people react to it and comment on it separately
 * from the post it shares. The original keeps its own reactions and comments,
 * and neither leaks into the other in either direction.
 */
describe("engagement on a shared post", () => {
  let artist: Session;
  let sharer: Session;
  let reader: Session;
  let postId: string;
  let shareId: string;

  async function call(session: Session | null, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object) {
    const app = await getTestApp();
    return app.inject({
      method,
      url,
      ...(session ? { headers: authHeaders(session) } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  type FeedCard = {
    id: string;
    reactions: { total: number; love: number; like: number; mine: string | null };
    commentCount: number;
    share?: { id: string; reactions: { total: number; love: number; like: number; mine: string | null }; commentCount: number };
  };

  async function cards(viewer: Session | null): Promise<{ original: FeedCard; shared: FeedCard }> {
    const items = (await call(viewer, "GET", "/feed?limit=20")).json().items as FeedCard[];
    return {
      original: items.find((item) => item.id === postId && !item.share)!,
      shared: items.find((item) => item.share?.id === shareId)!,
    };
  }

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    sharer = await registerUser("client");
    reader = await registerUser("client");
    postId = (await createArtistPost(artist, "Abaca table runner")).id;
    await call(sharer, "PUT", `/posts/${postId}/share`, { caption: "Look at this weave" });
    const feed = (await call(null, "GET", "/feed?limit=20")).json().items as FeedCard[];
    shareId = feed.find((item) => item.share)!.share!.id;
  });

  it("keeps reactions on the share separate from the original, both ways", async () => {
    expect((await call(reader, "PUT", `/shares/${shareId}/reaction`, { kind: "love" })).statusCode).toBe(204);
    let view = await cards(reader);
    expect(view.shared.share!.reactions).toMatchObject({ love: 1, total: 1, mine: "love" });
    expect(view.original.reactions).toMatchObject({ total: 0, mine: null });

    expect((await call(reader, "PUT", `/posts/${postId}/reaction`, { kind: "like" })).statusCode).toBe(204);
    view = await cards(reader);
    expect(view.original.reactions).toMatchObject({ like: 1, total: 1, mine: "like" });
    expect(view.shared.share!.reactions).toMatchObject({ love: 1, like: 0, total: 1, mine: "love" });

    expect((await call(reader, "DELETE", `/shares/${shareId}/reaction`)).statusCode).toBe(204);
    view = await cards(reader);
    expect(view.shared.share!.reactions.total).toBe(0);
    expect(view.original.reactions.total).toBe(1);
  });

  it("keeps comments on the share separate from the original, both ways", async () => {
    expect((await call(reader, "POST", `/shares/${shareId}/comments`, { body: "Where can I get one?" })).statusCode).toBe(201);
    expect((await call(reader, "POST", `/posts/${postId}/comments`, { body: "Beautiful work" })).statusCode).toBe(201);

    const onShare = (await call(null, "GET", `/shares/${shareId}/comments`)).json() as { body: string }[];
    const onPost = (await call(null, "GET", `/posts/${postId}/comments`)).json() as { body: string }[];
    expect(onShare.map((comment) => comment.body)).toEqual(["Where can I get one?"]);
    expect(onPost.map((comment) => comment.body)).toEqual(["Beautiful work"]);

    const view = await cards(null);
    expect(view.shared.share!.commentCount).toBe(1);
    expect(view.original.commentCount).toBe(1);
    // The embedded original on the shared card still reports the original's own count.
    expect(view.shared.commentCount).toBe(1);
  });

  it("tells the sharer, not the artist, about engagement on the share", async () => {
    await call(reader, "PUT", `/shares/${shareId}/reaction`, { kind: "support" });
    await call(reader, "POST", `/shares/${shareId}/comments`, { body: "Great find" });

    const typesFor = async (session: Session) =>
      ((await call(session, "GET", "/notifications?limit=50")).json().items as { type: string }[]).map((item) => item.type);
    expect(await typesFor(sharer)).toEqual(expect.arrayContaining(["share_reaction", "share_comment"]));
    expect(await typesFor(artist)).not.toContain("share_reaction");
    expect(await typesFor(artist)).not.toContain("share_comment");
  });

  it("lets the sharer clear a comment from their share, but not the artist of the original", async () => {
    const comment = (await call(reader, "POST", `/shares/${shareId}/comments`, { body: "Off topic" })).json();
    expect((await call(artist, "DELETE", `/comments/${comment.id}`)).statusCode).toBe(403);
    expect((await call(sharer, "DELETE", `/comments/${comment.id}`)).statusCode).toBe(204);
  });

  it("removes a share's reactions and comments with the share", async () => {
    await call(reader, "PUT", `/shares/${shareId}/reaction`, { kind: "love" });
    await call(reader, "POST", `/shares/${shareId}/comments`, { body: "Nice" });
    await call(sharer, "DELETE", `/posts/${postId}/share`);

    expect((await call(null, "GET", `/shares/${shareId}/comments`)).statusCode).toBe(404);
    expect((await call(reader, "PUT", `/shares/${shareId}/reaction`, { kind: "like" })).statusCode).toBe(404);
  });

  it("refuses engagement on a share whose original was taken down", async () => {
    await call(artist, "DELETE", `/posts/${postId}`);
    expect((await call(reader, "PUT", `/shares/${shareId}/reaction`, { kind: "love" })).statusCode).toBe(404);
    expect((await call(reader, "POST", `/shares/${shareId}/comments`, { body: "Hello" })).statusCode).toBe(404);
  });

  it("refuses anonymous reactions and comments on a share", async () => {
    expect((await call(null, "PUT", `/shares/${shareId}/reaction`, { kind: "love" })).statusCode).toBe(401);
    expect((await call(null, "POST", `/shares/${shareId}/comments`, { body: "Hello" })).statusCode).toBe(401);
  });
});
