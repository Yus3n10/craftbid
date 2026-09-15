import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/query.js";
import {
  addGcash,
  authHeaders,
  confirmPayment,
  getTestApp,
  latestPaymentId,
  makeStaff,
  registerUser,
  resetData,
  startCommission,
  submitGcashPayment,
  type Session,
} from "./helpers.js";

/**
 * Commission problems and payment records on the admin screen. Staff can see
 * every payment record and open its receipt, whether or not it was confirmed,
 * so a dispute can be checked against what was actually sent; opening a
 * receipt is itself recorded.
 */

let staff: Session;
let client: Session;
let artist: Session;

beforeEach(async () => {
  await resetData();
  staff = await registerUser("client", { username: "yusenstaff" });
  await makeStaff(staff.id);
  client = await registerUser("client", { username: "mayaclient" });
  artist = await registerUser("artist", { username: "nenaartist" });
  await addGcash(artist);
});

async function call(session: Session | null, method: "GET" | "POST", url: string, payload?: object) {
  const app = await getTestApp();
  return app.inject({ method, url, headers: session ? authHeaders(session) : {}, ...(payload ? { payload } : {}) });
}

async function actionsOf(action: string): Promise<{ targetId: Buffer; subjectUserId: Buffer | null }[]> {
  return db.many(`SELECT target_id, subject_user_id FROM moderation_actions WHERE action = :action`, { action });
}

describe("staff only", () => {
  it("answers 404 to everyone else", async () => {
    const id = "01920000-0000-7000-8000-000000000099";
    for (const [method, url] of [
      ["GET", "/admin/problems"],
      ["POST", `/admin/problems/${id}/resolve`],
      ["GET", "/admin/payments"],
      ["GET", `/admin/payments/${id}/receipt`],
    ] as const) {
      expect((await call(null, method, url, method === "POST" ? { outcome: "continue", note: "Checked both sides." } : undefined)).statusCode, url).toBe(404);
      expect((await call(client, method, url, method === "POST" ? { outcome: "continue", note: "Checked both sides." } : undefined)).statusCode, url).toBe(404);
    }
  });
});

describe("commission problems", () => {
  it("lists an open problem with both people and the payments, and resolves it once, on the record", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await call(client, "POST", `/commissions/${commissionId}/problems`, {
      reason: "payment_not_received",
      details: "I sent the down payment three days ago and it is still not confirmed.",
    });

    const open = await call(staff, "GET", "/admin/problems?status=open");
    expect(open.statusCode).toBe(200);
    const [problem] = open.json().items;
    expect(problem).toMatchObject({
      commissionId,
      reason: "payment_not_received",
      status: "open",
      openedBy: { username: "mayaclient" },
      client: { username: "mayaclient", email: "mayaclient@example.com" },
      artist: { username: "nenaartist" },
    });
    expect(problem.payments).toEqual([expect.objectContaining({ kind: "down", status: "submitted", hasReceipt: true })]);
    expect((await call(staff, "GET", "/admin/overview")).json().openProblems).toBe(1);

    const resolved = await call(staff, "POST", `/admin/problems/${problem.id}/resolve`, {
      outcome: "cancel",
      note: "The transfer never arrived; cancelling so neither side is held up.",
    });
    expect(resolved.statusCode).toBe(204);
    const commission = await call(client, "GET", `/commissions/${commissionId}`);
    expect(commission.json().status).toBe("cancelled");
    expect(await actionsOf("resolve_problem")).toHaveLength(1);

    expect((await call(staff, "POST", `/admin/problems/${problem.id}/resolve`, { outcome: "continue", note: "Again, by mistake." })).statusCode).toBe(400);
    expect(await actionsOf("resolve_problem")).toHaveLength(1);

    const closed = (await call(staff, "GET", "/admin/problems?status=closed")).json().items;
    expect(closed).toEqual([expect.objectContaining({ id: problem.id, status: "resolved", resolution: expect.stringContaining("never arrived") })]);
    expect((await call(staff, "GET", "/admin/problems?status=open")).json().items).toEqual([]);
  });

  it("needs a note both people can read", async () => {
    const commissionId = await startCommission(client, artist);
    await call(client, "POST", `/commissions/${commissionId}/problems`, { reason: "other", details: "Something is not right here at all." });
    const [problem] = (await call(staff, "GET", "/admin/problems")).json().items;
    expect((await call(staff, "POST", `/admin/problems/${problem.id}/resolve`, { outcome: "continue", note: "" })).statusCode).toBe(400);
  });
});

describe("payment records", () => {
  it("lists every record, confirmed, rejected and waiting, with who sent it", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down", { referenceNumber: "1111111111" });
    await call(artist, "POST", `/commissions/${commissionId}/payments/${await latestPaymentId(artist, commissionId, "down")}/reject`);
    await submitGcashPayment(client, commissionId, "down", { referenceNumber: "2222222222" });
    await confirmPayment(artist, commissionId, "down");

    const response = await call(staff, "GET", "/admin/payments");
    expect(response.statusCode).toBe(200);
    const items = response.json().items as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    const byReference = Object.fromEntries(items.map((item) => [item.referenceNumber, item]));
    expect(byReference["2222222222"]).toMatchObject({
      kind: "down",
      method: "gcash",
      status: "confirmed",
      replaced: false,
      hasReceipt: true,
      client: { username: "mayaclient" },
      artist: { username: "nenaartist" },
      recordedBy: { username: "mayaclient" },
    });
    expect(byReference["1111111111"]).toMatchObject({ status: "rejected", replaced: true });

    expect((await call(staff, "GET", "/admin/payments?status=rejected")).json().items).toHaveLength(1);
    expect((await call(staff, "GET", "/admin/payments?q=nenaartist")).json().items).toHaveLength(2);
    expect((await call(staff, "GET", "/admin/payments?q=2222222222")).json().items).toEqual([
      expect.objectContaining({ referenceNumber: "2222222222" }),
    ]);
    expect((await call(staff, "GET", "/admin/payments?q=somebodyelse")).json().items).toEqual([]);
  });

  it("opens a receipt for staff, uncached, and records every look", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    const [payment] = (await call(staff, "GET", "/admin/payments")).json().items;

    for (let look = 1; look <= 2; look++) {
      const receipt = await call(staff, "GET", `/admin/payments/${payment.id}/receipt`);
      expect(receipt.statusCode).toBe(200);
      expect(receipt.headers["content-type"]).toBe("image/webp");
      expect(receipt.headers["cache-control"]).toBe("private, no-store");
      expect(await actionsOf("payment_file_viewed")).toHaveLength(look);
    }

    const [record] = await actionsOf("payment_file_viewed");
    const { bufToUuid } = await import("../db/ids.js");
    expect(bufToUuid(record!.subjectUserId)).toBe(client.id);

    expect((await call(staff, "GET", "/admin/payments/01920000-0000-7000-8000-000000000099/receipt")).statusCode).toBe(404);
  });
});
