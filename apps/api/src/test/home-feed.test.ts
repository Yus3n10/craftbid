import { beforeEach, describe, expect, it } from "vitest";
import { categoriesForSearch } from "@craftbid/shared";
import { uuidToBuf } from "../db/ids.js";
import { db } from "../db/query.js";
import {
  applyToPosting,
  authHeaders,
  createArtistPost,
  createPosting,
  getTestApp,
  interestOf,
  registerUser,
  resetData,
  setInterest,
  setStatus,
  startCommission,
  type Session,
} from "./helpers.js";

/**
 * The personal home feed: what each person has shown interest in, and how that
 * orders a feed of work and open requests without ever hiding what is new.
 */

describe("craft interest", () => {
  let artist: Session;
  let client: Session;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    client = await registerUser("client");
  });

  it("adds 3 for a save and 1 for a reaction to the post's craft", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist, "Stoneware mug", "pottery");

    await app.inject({ method: "PUT", url: `/posts/${post.id}/save`, headers: authHeaders(client) });
    await app.inject({
      method: "PUT",
      url: `/posts/${post.id}/reaction`,
      headers: authHeaders(client),
      payload: { kind: "love" },
    });

    const scores = await interestOf(client.id);
    expect(scores.get("pottery")).toBeCloseTo(4, 2);
    expect([...scores.keys()]).toEqual(["pottery"]);
  });

  it("adds 2 for a comment and 3 for a share", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist, "Beaded earrings", "jewelry");

    await app.inject({
      method: "POST",
      url: `/posts/${post.id}/comments`,
      headers: authHeaders(client),
      payload: { body: "Lovely colours" },
    });
    await app.inject({ method: "PUT", url: `/posts/${post.id}/share`, headers: authHeaders(client), payload: {} });

    expect((await interestOf(client.id)).get("jewelry")).toBeCloseTo(5, 2);
  });

  it("adds 2 for posting a request, and 2 to the artist who bids on it", async () => {
    const posting = await createPosting(client, { categorySlug: "weaving" });
    expect((await applyToPosting(artist, posting.id, 200_000)).statusCode).toBe(201);

    expect((await interestOf(client.id)).get("weaving")).toBeCloseTo(2, 2);
    expect((await interestOf(artist.id)).get("weaving")).toBeCloseTo(2, 2);
  });

  it("halves after 30 days", async () => {
    await setInterest(client.id, "pottery", 8, 30);
    expect((await interestOf(client.id)).get("pottery")).toBeCloseTo(4, 1);
  });

  it("decays the old score before adding a new one", async () => {
    const app = await getTestApp();
    await setInterest(client.id, "pottery", 8, 30);
    const post = await createArtistPost(artist, "Stoneware mug", "pottery");
    await app.inject({ method: "PUT", url: `/posts/${post.id}/save`, headers: authHeaders(client) });
    expect((await interestOf(client.id)).get("pottery")).toBeCloseTo(7, 1);
  });

  it("counts a search only when it names a craft", async () => {
    const app = await getTestApp();
    await app.inject({ method: "GET", url: "/search?q=ceramic%20mug", headers: authHeaders(client) });
    await app.inject({ method: "GET", url: "/search?q=birthday%20gift", headers: authHeaders(client) });

    expect(Object.fromEntries(await interestOf(client.id))).toEqual({ pottery: expect.closeTo(1, 2) });
  });

  it("counts browsing a craft once, on its first page", async () => {
    const app = await getTestApp();
    await app.inject({ method: "GET", url: "/postings?category=embroidery", headers: authHeaders(artist) });
    await app.inject({ method: "GET", url: "/postings?category=embroidery&offset=20", headers: authHeaders(artist) });
    await app.inject({ method: "GET", url: "/posts?category=embroidery", headers: authHeaders(artist) });

    expect((await interestOf(artist.id)).get("embroidery")).toBeCloseTo(1, 2);
  });

  it("records nothing for someone signed out", async () => {
    const app = await getTestApp();
    const search = await app.inject({ method: "GET", url: "/search?q=pottery" });
    expect(search.statusCode).toBe(200);
  });
});

describe("naming a craft in a search", () => {
  it("matches names, stems and everyday craft words", () => {
    expect(categoriesForSearch("ceramic mug")).toEqual(["pottery"]);
    expect(categoriesForSearch("wooden spoon")).toEqual(["woodcraft"]);
    expect(categoriesForSearch("bead necklace")).toEqual(["jewelry"]);
    expect(categoriesForSearch("Crochet bouquet")).toEqual(["crochet"]);
    expect(categoriesForSearch("birthday gift")).toEqual([]);
    expect(categoriesForSearch("handmade art")).toEqual([]);
  });
});

type HomeItem = { kind: "post" | "request"; id: string; share?: { id: string } } & Record<string, unknown>;

async function home(viewer?: Session, query = ""): Promise<HomeItem[]> {
  const app = await getTestApp();
  const response = await app.inject({
    method: "GET",
    url: `/home?limit=50${query}`,
    ...(viewer ? { headers: authHeaders(viewer) } : {}),
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { items: HomeItem[] }).items;
}

const AGE_TABLE = { post: "artist_posts", posting: "postings", share: "post_shares" } as const;

/** Makes something look as if it was created `hours` ago. */
async function age(kind: keyof typeof AGE_TABLE, id: string, hours: number): Promise<void> {
  await db.run(
    `UPDATE ${AGE_TABLE[kind]} SET created_at = SYSTIMESTAMP - NUMTODSINTERVAL(:hours, 'HOUR') WHERE id = :id`,
    { hours, id: uuidToBuf(id) },
  );
}

const ids = (items: HomeItem[]) => items.map((item) => item.id);

describe("GET /home", () => {
  let artist: Session;
  let client: Session;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    client = await registerUser("client");
  });

  it("shows a new open request to a signed-out visitor, with nothing about its bids", async () => {
    const posting = await createPosting(client, { title: "Handwoven table runner", categorySlug: "weaving" });
    expect((await applyToPosting(artist, posting.id, 200_000)).statusCode).toBe(201);

    const card = (await home()).find((item) => item.id === posting.id)!;
    expect(card).toMatchObject({ kind: "request", title: "Handwoven table runner", minBudgetCentavos: 150_000 });
    expect(card).not.toHaveProperty("applicationCount");
    expect(card).not.toHaveProperty("commissionId");
    expect(card).not.toHaveProperty("reactions");
  });

  it("mixes posts, shares of posts, and requests", async () => {
    const app = await getTestApp();
    const post = await createArtistPost(artist, "Stoneware mug", "pottery");
    await app.inject({ method: "PUT", url: `/posts/${post.id}/share`, headers: authHeaders(client), payload: {} });
    await createPosting(client);

    const kinds = (await home()).map((item) => `${item.kind}${item.share ? "+share" : ""}`);
    expect(kinds.sort()).toEqual(["post", "post+share", "request"]);
  });

  it("leaves out requests that are not open, and those of suspended clients", async () => {
    const app = await getTestApp();
    const cancelled = await createPosting(client, { title: "Cancelled one" });
    await app.inject({ method: "POST", url: `/postings/${cancelled.id}/cancel`, headers: authHeaders(client) });

    await startCommission(client, artist); // that request is now in progress

    const other = await registerUser("client");
    await createPosting(other, { title: "Paused one" });
    await setStatus(other.id, "suspended");

    const open = await createPosting(client, { title: "Still open" });

    expect(ids((await home()).filter((item) => item.kind === "request"))).toEqual([open.id]);
  });

  it("orders items of the same age by each viewer's interests", async () => {
    const mug = await createArtistPost(artist, "Stoneware mug", "pottery");
    const ring = await createArtistPost(artist, "Silver ring", "jewelry");
    await age("post", mug.id, 30);
    await age("post", ring.id, 30);

    const potter = await registerUser("client");
    const jeweller = await registerUser("client");
    await setInterest(potter.id, "pottery", 10);
    await setInterest(jeweller.id, "jewelry", 10);

    expect(ids(await home(potter))).toEqual([mug.id, ring.id]);
    expect(ids(await home(jeweller))).toEqual([ring.id, mug.id]);
  });

  it("keeps something an hour old above a three-day-old favourite", async () => {
    const oldMug = await createArtistPost(artist, "Stoneware mug", "pottery");
    const newRing = await createArtistPost(artist, "Silver ring", "jewelry");
    await age("post", oldMug.id, 72);
    await age("post", newRing.id, 1);
    await setInterest(client.id, "pottery", 10);

    expect(ids(await home(client))).toEqual([newRing.id, oldMug.id]);
  });

  it("ranks anything under six hours old above anything older, whatever the interests", async () => {
    const favourite = await createArtistPost(artist, "Stoneware mug", "pottery");
    const fresh = await createArtistPost(artist, "Silver ring", "jewelry");
    // Freshness alone: the favourite is 0.87 doubled to 1.75 by interest, the
    // fresh ring only 0.91.
    await age("post", favourite.id, 7);
    await age("post", fresh.id, 5);
    await setInterest(client.id, "pottery", 10);

    expect(ids(await home(client))).toEqual([fresh.id, favourite.id]);
  });

  it("still orders fresh items by interest among themselves", async () => {
    const mug = await createArtistPost(artist, "Stoneware mug", "pottery");
    const ring = await createArtistPost(artist, "Silver ring", "jewelry");
    await age("post", mug.id, 3);
    await age("post", ring.id, 2);
    await setInterest(client.id, "pottery", 10);

    expect(ids(await home(client))).toEqual([mug.id, ring.id]);
  });

  it("puts the viewer's own request from today first, for them only", async () => {
    const post = await createArtistPost(artist, "Stoneware mug", "pottery");
    const mine = await createPosting(client, { categorySlug: "weaving" });
    await age("posting", mine.id, 20);
    await setInterest(client.id, "pottery", 10);

    expect(ids(await home(client))[0]).toBe(mine.id);
    expect(ids(await home(artist))[0]).toBe(post.id);
  });

  it("counts an artist's own crafts", async () => {
    const mug = await createArtistPost(artist, "Stoneware mug", "pottery");
    const ring = await createArtistPost(artist, "Silver ring", "jewelry");
    // The ring is an hour older, so only the artist's craft can put it first.
    await age("post", mug.id, 30);
    await age("post", ring.id, 31);

    const jeweller = await registerUser("artist");
    await db.run(
      `INSERT INTO artist_categories (artist_id, category_id)
       SELECT :id, id FROM craft_categories WHERE slug = 'jewelry'`,
      { id: uuidToBuf(jeweller.id) },
    );
    expect(ids(await home(jeweller))).toEqual([ring.id, mug.id]);
  });

  it("is newest first for someone with no interests, signed in or not", async () => {
    const older = await createArtistPost(artist, "Stoneware mug", "pottery");
    const newer = await createArtistPost(artist, "Silver ring", "jewelry");
    await age("post", older.id, 50);
    await age("post", newer.id, 40);

    expect(ids(await home())).toEqual([newer.id, older.id]);
    expect(ids(await home(client))).toEqual([newer.id, older.id]);
  });

  it("narrows to one craft", async () => {
    await createArtistPost(artist, "Stoneware mug", "pottery");
    const ring = await createArtistPost(artist, "Silver ring", "jewelry");
    expect(ids(await home(undefined, "&category=jewelry"))).toEqual([ring.id]);
  });
});

describe("GET /users/:username/postings", () => {
  let artist: Session;
  let client: Session;

  beforeEach(async () => {
    await resetData();
    artist = await registerUser("artist");
    client = await registerUser("client");
  });

  async function profileRequests(username: string) {
    const app = await getTestApp();
    return app.inject({ method: "GET", url: `/users/${username}/postings` });
  }

  it("lists a client's open and in-progress requests, newest first", async () => {
    const app = await getTestApp();
    const cancelled = await createPosting(client, { title: "Cancelled one" });
    await app.inject({ method: "POST", url: `/postings/${cancelled.id}/cancel`, headers: authHeaders(client) });
    const commissionId = await startCommission(client, artist);
    const open = await createPosting(client, { title: "Still open" });
    await age("posting", open.id, -0.01); // a moment newer than the commission's request

    const response = await profileRequests(client.username);
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: { id: string; status: string; title: string }[] }).items;
    expect(items.map((item) => item.status)).toEqual(["open", "in_progress"]);
    expect(items[0]!.id).toBe(open.id);
    expect(commissionId).toBeTruthy();
  });

  it("leaves out a request staff removed", async () => {
    const posting = await createPosting(client);
    await db.run(`UPDATE postings SET removed_at = SYSTIMESTAMP WHERE id = :id`, { id: uuidToBuf(posting.id) });
    const items = (await profileRequests(client.username)).json().items as unknown[];
    expect(items).toEqual([]);
  });

  it("is 404 for someone who does not exist or was removed", async () => {
    expect((await profileRequests("nobody_here")).statusCode).toBe(404);
    await createPosting(client);
    await setStatus(client.id, "deleted");
    expect((await profileRequests(client.username)).statusCode).toBe(404);
  });
});
