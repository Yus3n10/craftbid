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
 * Opening the notifications page marks what it showed as read.
 *
 * There is no "Mark all read" button any more. The page reads the list, then
 * tells the server the newest notification it displayed, and only that one and
 * older are marked. Something that arrives in between stays unread, because
 * nobody has seen it.
 */
describe("reading notifications", () => {
  let client: Session;
  let postingId: string;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    postingId = (await createPosting(client, { minBudgetCentavos: 150_000 })).id;
  });

  async function list(session: Session) {
    const app = await getTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/notifications?limit=50",
      headers: authHeaders(session),
    });
    return response.json() as { items: { id: string; readAt: string | null }[]; unread: number; total: number };
  }

  it("marks everything up to the newest one shown, and keeps the history", async () => {
    const app = await getTestApp();
    for (let i = 0; i < 3; i++) {
      await applyToPosting(await registerUser("artist"), postingId, 150_000);
    }
    const before = await list(client);
    expect(before.unread).toBe(3);

    const read = await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: authHeaders(client),
      payload: { throughId: before.items[0]!.id },
    });
    expect(read.statusCode).toBe(200);

    const after = await list(client);
    expect(after.unread).toBe(0);
    // Read, not deleted.
    expect(after.total).toBe(3);
    expect(after.items.every((item) => item.readAt !== null)).toBe(true);
  });

  it("leaves a notification that arrived after the page loaded unread", async () => {
    const app = await getTestApp();
    await applyToPosting(await registerUser("artist"), postingId, 150_000);
    const shown = await list(client);

    // Arrives while the page is open, before it reports what it showed.
    await applyToPosting(await registerUser("artist"), postingId, 160_000);

    await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: authHeaders(client),
      payload: { throughId: shown.items[0]!.id },
    });
    expect((await list(client)).unread).toBe(1);
  });

  it("cannot mark someone else's notifications through a borrowed id", async () => {
    const app = await getTestApp();
    await applyToPosting(await registerUser("artist"), postingId, 150_000);
    const theirs = await list(client);

    const stranger = await registerUser("client");
    await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: authHeaders(stranger),
      payload: { throughId: theirs.items[0]!.id },
    });
    expect((await list(client)).unread).toBe(1);
  });
});
