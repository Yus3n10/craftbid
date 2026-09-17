import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import { uuidToBuf } from "../db/ids.js";
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
 * Two people acting on the same bid at the same moment. Whatever the timing,
 * the stored state must be one the rules allow.
 */
describe("simultaneous actions on one bid", () => {
  let client: Session;
  let artist: Session;

  beforeEach(async () => {
    await resetData();
    client = await registerUser("client");
    artist = await registerUser("artist");
  });

  async function freshBid(): Promise<{ postingId: string; applicationId: string }> {
    const posting = await createPosting(client);
    const bid = await applyToPosting(artist, posting.id, 200_000);
    return { postingId: posting.id, applicationId: (bid.json() as { id: string }).id };
  }

  async function stateOf(postingId: string, applicationId: string) {
    const application = await db.one<{ status: string }>(
      `SELECT status FROM applications WHERE id = :id`,
      { id: uuidToBuf(applicationId) },
    );
    const posting = await db.one<{ status: string }>(`SELECT status FROM postings WHERE id = :id`, {
      id: uuidToBuf(postingId),
    });
    const commissions = await db.one<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM commissions WHERE application_id = :id`,
      { id: uuidToBuf(applicationId) },
    );
    return { application: application!.status, posting: posting!.status, commissions: commissions!.cnt };
  }

  /** The only combinations the marketplace rules allow after both requests. */
  function expectConsistent(state: Awaited<ReturnType<typeof stateOf>>) {
    if (state.commissions > 0) {
      expect(state.application).toBe("accepted");
      expect(state.posting).toBe("in_progress");
    } else {
      expect(state.application).not.toBe("accepted");
      expect(state.posting).toBe("open");
    }
  }

  it("never leaves a commission on a bid the artist withdrew", async () => {
    const app = await getTestApp();
    for (let trial = 0; trial < 12; trial += 1) {
      const { postingId, applicationId } = await freshBid();
      const [accepted, withdrawn] = await Promise.all([
        app.inject({ method: "POST", url: `/applications/${applicationId}/accept`, headers: authHeaders(client) }),
        app.inject({ method: "POST", url: `/applications/${applicationId}/withdraw`, headers: authHeaders(artist) }),
      ]);

      // Exactly one of the two may win; the loser is told, not silently undone.
      expect([accepted.statusCode, withdrawn.statusCode].filter((code) => code === 200)).toHaveLength(1);
      expectConsistent(await stateOf(postingId, applicationId));
    }
  });

  it("never leaves a commission on a bid the client also declined", async () => {
    const app = await getTestApp();
    for (let trial = 0; trial < 12; trial += 1) {
      const { postingId, applicationId } = await freshBid();
      const [accepted, rejected] = await Promise.all([
        app.inject({ method: "POST", url: `/applications/${applicationId}/accept`, headers: authHeaders(client) }),
        app.inject({ method: "POST", url: `/applications/${applicationId}/reject`, headers: authHeaders(client) }),
      ]);

      expect([accepted.statusCode, rejected.statusCode].filter((code) => code === 200)).toHaveLength(1);
      expectConsistent(await stateOf(postingId, applicationId));
    }
  });

  it("does not reopen a request the client cancelled while accepting", async () => {
    const app = await getTestApp();
    for (let trial = 0; trial < 12; trial += 1) {
      const { postingId, applicationId } = await freshBid();
      await Promise.all([
        app.inject({ method: "POST", url: `/applications/${applicationId}/accept`, headers: authHeaders(client) }),
        app.inject({ method: "POST", url: `/postings/${postingId}/cancel`, headers: authHeaders(client) }),
      ]);

      const state = await stateOf(postingId, applicationId);
      // Cancelling a request whose artist is already chosen is allowed and
      // leaves the commission alone, so "cancelled with a commission" can be
      // right. What must never happen is a commission whose request still
      // reads open, or an accepted bid with no commission.
      if (state.commissions > 0) {
        expect(state.application).toBe("accepted");
        expect(["in_progress", "cancelled"]).toContain(state.posting);
      } else {
        expect(state.application).not.toBe("accepted");
        expect(state.posting).toBe("cancelled");
      }
    }
  });
});
