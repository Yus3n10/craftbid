import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { newId, uuidToBuf } from "../db/ids.js";
import { db } from "../db/query.js";
import {
  applyToPosting,
  authHeaders,
  createPosting,
  getTestApp,
  multipartFile,
  registerUser,
  resetData,
  storedObject,
  storedPrivateObject,
  testImage,
  type Session,
} from "./helpers.js";

/**
 * Images in chat: private to the conversation's two people, shrunk on the way
 * in, attached once, and only while the conversation is open.
 */
describe("chat images", () => {
  let client: Session;
  let artist: Session;
  let rival: Session;
  let stranger: Session;
  let postingId: string;
  let bidId: string;
  let conversationId: string;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
    rival = await registerUser("artist");
    stranger = await registerUser("client");
    postingId = (await createPosting(client)).id;
    bidId = (await applyToPosting(artist, postingId, 173_500)).json().id;
    await applyToPosting(rival, postingId, 160_000);
    conversationId = (await call(client, "POST", "/conversations", { postingId, artistId: artist.id })).json().id;
  });

  async function call(session: Session, method: "GET" | "POST", url: string, payload?: object) {
    const app = await getTestApp();
    return app.inject({ method, url, headers: authHeaders(session), ...(payload ? { payload } : {}) });
  }

  async function upload(session: Session, file: Buffer, id = conversationId) {
    const app = await getTestApp();
    const { payload, headers } = multipartFile(file);
    return app.inject({
      method: "POST",
      url: `/conversations/${id}/files`,
      headers: { ...authHeaders(session), ...headers },
      payload,
    });
  }

  async function largePhoto(): Promise<Buffer> {
    return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 120, b: 90 } } })
      .png()
      .toBuffer();
  }

  it("shrinks an upload to 1600px and keeps it in private storage as WebP", async () => {
    const response = await upload(client, await largePhoto());
    expect(response.statusCode).toBe(201);
    const { fileId, width, height } = response.json();
    expect([width, height]).toEqual([1600, 1067]);

    const key = `conversations/${conversationId}/${fileId}.webp`;
    const stored = storedPrivateObject(key);
    expect(stored?.contentType).toBe("image/webp");
    expect((await sharp(stored!.body).metadata()).width).toBe(1600);
    expect(storedObject(key)).toBeUndefined();
  });

  it("sends an image on its own, which both people can open and nobody caches", async () => {
    const fileId = (await upload(client, await testImage(1))).json().fileId as string;
    const sent = await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ body: "", mine: true, image: { fileId, width: 320, height: 320 } });

    const seen = (await call(artist, "GET", `/conversations/${conversationId}/messages`)).json().items;
    expect(seen).toEqual([expect.objectContaining({ body: "", mine: false, image: { fileId, width: 320, height: 320 } })]);

    for (const person of [client, artist]) {
      const file = await call(person, "GET", `/conversations/${conversationId}/files/${fileId}`);
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("image/webp");
      expect(file.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("keeps a caption sent with the image", async () => {
    const fileId = (await upload(artist, await testImage(2))).json().fileId as string;
    const sent = await call(artist, "POST", `/conversations/${conversationId}/messages`, { fileId, body: "The yarn colours" });
    expect(sent.json()).toMatchObject({ body: "The yarn colours", image: { fileId } });
  });

  it("is invisible to another bidder and to a stranger", async () => {
    const fileId = (await upload(client, await testImage(3))).json().fileId as string;
    await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId });

    for (const outsider of [rival, stranger]) {
      expect((await upload(outsider, await testImage(4))).statusCode).toBe(404);
      expect((await call(outsider, "GET", `/conversations/${conversationId}/files/${fileId}`)).statusCode).toBe(404);
    }
  });

  it("attaches only your own upload, from this conversation, once", async () => {
    const theirs = (await upload(artist, await testImage(5))).json().fileId as string;
    const refused = await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId: theirs });
    expect(refused.statusCode).toBe(400);

    const rivalConversation = (await call(client, "POST", "/conversations", { postingId, artistId: rival.id })).json().id as string;
    const elsewhere = (await upload(client, await testImage(6), rivalConversation)).json().fileId as string;
    expect((await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId: elsewhere })).statusCode).toBe(400);
    // Nor can a file from another conversation be read through this one.
    expect((await call(client, "GET", `/conversations/${conversationId}/files/${elsewhere}`)).statusCode).toBe(404);

    const mine = (await upload(client, await testImage(7))).json().fileId as string;
    expect((await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId: mine })).statusCode).toBe(201);
    expect((await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId: mine })).statusCode).toBe(400);
  });

  it("takes no uploads once the conversation is closed", async () => {
    await call(client, "POST", `/applications/${bidId}/reject`);
    const response = await upload(artist, await testImage(8));
    expect(response.statusCode).toBe(400);
  });

  it("refuses a message with neither text nor an image, in the schema and in the database", async () => {
    expect((await call(client, "POST", `/conversations/${conversationId}/messages`, {})).statusCode).toBe(400);
    expect((await call(client, "POST", `/conversations/${conversationId}/messages`, { body: "   " })).statusCode).toBe(400);

    await expect(
      db.run(`INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (:id, :conversation, :sender, NULL)`, {
        id: uuidToBuf(newId()),
        conversation: uuidToBuf(conversationId),
        sender: uuidToBuf(client.id),
      }),
    ).rejects.toThrow(/CK_MESSAGES_CONTENT/i);
  });

  it("previews an image-only message in the conversation list", async () => {
    const fileId = (await upload(client, await testImage(9))).json().fileId as string;
    await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId });
    const [summary] = (await call(artist, "GET", "/conversations")).json().items;
    expect(summary.lastMessage).toMatchObject({ body: "", hasImage: true, mine: false });
  });

  it("goes with its conversation when the conversation is deleted", async () => {
    const fileId = (await upload(client, await testImage(10))).json().fileId as string;
    await call(client, "POST", `/conversations/${conversationId}/messages`, { fileId });
    await db.run(`DELETE FROM conversations WHERE id = :id`, { id: uuidToBuf(conversationId) });
    const left = await db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM chat_files WHERE id = :id`, { id: uuidToBuf(fileId) });
    expect(Number(left?.cnt)).toBe(0);
  });
});
