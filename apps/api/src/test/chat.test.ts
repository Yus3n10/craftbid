import { beforeEach, describe, expect, it } from "vitest";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  registerUser,
  resetData,
  type Session,
} from "./helpers.js";

/**
 * Chat between a client and an artist about one craft request.
 *
 * A conversation exists only where a bid does: the client who posted the
 * request and an artist who bid on it. It carries on through the commission
 * if that artist is chosen. Nobody else can find, read or write to it, and it
 * never carries a bid's price.
 */
describe("chat", () => {
  let client: Session;
  let artist: Session;
  let rival: Session;
  let stranger: Session;
  let postingId: string;
  let bidId: string;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
    rival = await registerUser("artist");
    stranger = await registerUser("client");
    postingId = (await createPosting(client, { minBudgetCentavos: 150_000 })).id;
    bidId = (await applyToPosting(artist, postingId, 173_500)).json().id;
    await applyToPosting(rival, postingId, 160_000);
  });

  async function call(session: Session, method: "GET" | "POST", url: string, payload?: object) {
    const app = await getTestApp();
    return app.inject({ method, url, headers: authHeaders(session), ...(payload ? { payload } : {}) });
  }

  async function open(session: Session, forArtist: Session = artist) {
    return call(session, "POST", "/conversations", { postingId, artistId: forArtist.id });
  }

  it("gives the client and the bidding artist the same conversation", async () => {
    const byClient = await open(client);
    expect(byClient.statusCode).toBe(200);
    const byArtist = await open(artist);
    expect(byArtist.json().id).toBe(byClient.json().id);

    expect(byClient.json()).toMatchObject({
      posting: { id: postingId },
      otherParty: { id: artist.id },
      myRole: "client",
      stage: "bidding",
      canSend: true,
    });
    expect(byArtist.json()).toMatchObject({ otherParty: { id: client.id }, myRole: "artist" });
  });

  it("lets both sides send and read, in order, knowing which are theirs", async () => {
    const id = (await open(client)).json().id as string;
    expect((await call(client, "POST", `/conversations/${id}/messages`, { body: "Can you do light blue accents?" })).statusCode).toBe(201);
    expect((await call(artist, "POST", `/conversations/${id}/messages`, { body: "Yes, in mercerised cotton 🧶" })).statusCode).toBe(201);

    const asArtist = (await call(artist, "GET", `/conversations/${id}/messages`)).json().items as { body: string; mine: boolean }[];
    expect(asArtist.map((message) => [message.body, message.mine])).toEqual([
      ["Can you do light blue accents?", false],
      ["Yes, in mercerised cotton 🧶", true],
    ]);
  });

  it("returns only messages newer than the last one a poll saw", async () => {
    const id = (await open(client)).json().id as string;
    const first = (await call(client, "POST", `/conversations/${id}/messages`, { body: "First" })).json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call(artist, "POST", `/conversations/${id}/messages`, { body: "Second" });

    const newer = (await call(client, "GET", `/conversations/${id}/messages?after=${encodeURIComponent(first.createdAt)}`)).json().items as { body: string }[];
    expect(newer.map((message) => message.body)).toContain("Second");
    // A poll can repeat the boundary message; the page merges by id.
    expect(newer.map((message) => message.body).filter((body) => body === "Second")).toHaveLength(1);
  });

  describe("who can get in", () => {
    it("refuses someone with nothing to do with the request, everywhere", async () => {
      const id = (await open(client)).json().id as string;
      expect((await open(stranger)).statusCode).toBe(404);
      expect((await call(stranger, "GET", `/conversations/${id}`)).statusCode).toBe(404);
      expect((await call(stranger, "GET", `/conversations/${id}/messages`)).statusCode).toBe(404);
      expect((await call(stranger, "POST", `/conversations/${id}/messages`, { body: "hello" })).statusCode).toBe(404);
      expect((await call(stranger, "POST", `/conversations/${id}/read`)).statusCode).toBe(404);
    });

    it("keeps another artist on the same request out of it", async () => {
      const id = (await open(client)).json().id as string;
      await call(client, "POST", `/conversations/${id}/messages`, { body: "Your price works for me." });

      // Opening someone else's conversation by naming them.
      expect((await open(rival, artist)).statusCode).toBe(404);
      expect((await call(rival, "GET", `/conversations/${id}/messages`)).statusCode).toBe(404);
      const rivalsList = await call(rival, "GET", "/conversations");
      expect(rivalsList.body).not.toContain(id);
    });

    it("does not let an artist who has not bid start a conversation", async () => {
      const newcomer = await registerUser("artist");
      expect((await open(newcomer, newcomer)).statusCode).toBe(404);
    });

    it("does not let a client open one on a request that is not theirs", async () => {
      expect((await open(stranger, artist)).statusCode).toBe(404);
    });

    it("never carries the bid's price", async () => {
      const id = (await open(client)).json().id as string;
      await call(client, "POST", `/conversations/${id}/messages`, { body: "Hello" });
      for (const response of [
        await call(client, "GET", "/conversations"),
        await call(client, "GET", `/conversations/${id}`),
        await call(artist, "GET", "/conversations"),
        await call(artist, "GET", `/conversations/${id}`),
      ]) {
        expect(response.body).not.toContain("173500");
        expect(response.body).not.toContain("160000");
      }
    });
  });

  describe("messages", () => {
    it("refuses an empty, whitespace-only or overlong message", async () => {
      const id = (await open(client)).json().id as string;
      for (const body of ["", "    \n  ", "x".repeat(2001)]) {
        expect((await call(client, "POST", `/conversations/${id}/messages`, { body })).statusCode).toBe(400);
      }
    });

    it("stores markup as text", async () => {
      const id = (await open(client)).json().id as string;
      const markup = "<script>alert(1)</script> is not a pattern I crochet";
      const sent = await call(client, "POST", `/conversations/${id}/messages`, { body: markup });
      expect(sent.json().body).toBe(markup);
    });
  });

  describe("through the life of the request", () => {
    it("continues the same conversation into the commission", async () => {
      const id = (await open(client)).json().id as string;
      await call(client, "POST", `/conversations/${id}/messages`, { body: "Before choosing" });
      expect((await call(client, "POST", `/applications/${bidId}/accept`)).statusCode).toBe(200);

      const after = await open(artist);
      expect(after.json().id).toBe(id);
      expect(after.json()).toMatchObject({ stage: "commission", canSend: true });
      expect(after.json().commissionId).toBeDefined();
      expect((await call(artist, "POST", `/conversations/${id}/messages`, { body: "Starting today" })).statusCode).toBe(201);
    });

    it("turns read-only for the artist who was not chosen", async () => {
      const rivalConversation = (await open(client, rival)).json().id as string;
      await call(client, "POST", `/conversations/${rivalConversation}/messages`, { body: "Thanks for bidding" });
      await call(client, "POST", `/applications/${bidId}/accept`);

      const view = await call(rival, "GET", `/conversations/${rivalConversation}`);
      expect(view.json().canSend).toBe(false);
      expect((await call(rival, "GET", `/conversations/${rivalConversation}/messages`)).statusCode).toBe(200);
      expect((await call(rival, "POST", `/conversations/${rivalConversation}/messages`, { body: "Please reconsider" })).statusCode).toBe(400);
      expect((await call(client, "POST", `/conversations/${rivalConversation}/messages`, { body: "Sorry" })).statusCode).toBe(400);
    });

    it("turns read-only when the artist withdraws", async () => {
      const id = (await open(client)).json().id as string;
      await call(artist, "POST", `/applications/${bidId}/withdraw`);
      expect((await call(client, "GET", `/conversations/${id}`)).json().canSend).toBe(false);
    });

    it("turns read-only when the commission is cancelled", async () => {
      const id = (await open(client)).json().id as string;
      await call(client, "POST", `/applications/${bidId}/accept`);
      const commissionId = (await open(client)).json().commissionId as string;
      const cancelled = await call(client, "POST", `/commissions/${commissionId}/cancel`, {});
      expect(cancelled.statusCode).toBeLessThan(300);
      expect((await call(artist, "POST", `/conversations/${id}/messages`, { body: "Wait" })).statusCode).toBe(400);
    });
  });

  describe("the list and unread count", () => {
    it("lists only conversations with messages, newest first, and counts unread for the other side", async () => {
      const withArtist = (await open(client)).json().id as string;
      await open(client, rival); // opened, never written in

      expect((await call(client, "GET", "/conversations")).json().items).toHaveLength(0);

      await call(client, "POST", `/conversations/${withArtist}/messages`, { body: "Is next month possible?" });
      const list = (await call(artist, "GET", "/conversations")).json().items as { id: string; unread: boolean; lastMessage: { body: string; mine: boolean } }[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: withArtist, unread: true, lastMessage: { body: "Is next month possible?", mine: false } });

      expect((await call(artist, "GET", "/conversations/unread")).json().unread).toBe(1);
      // The sender has nothing unread.
      expect((await call(client, "GET", "/conversations/unread")).json().unread).toBe(0);

      expect((await call(artist, "POST", `/conversations/${withArtist}/read`)).statusCode).toBe(204);
      expect((await call(artist, "GET", "/conversations/unread")).json().unread).toBe(0);
    });
  });
});
