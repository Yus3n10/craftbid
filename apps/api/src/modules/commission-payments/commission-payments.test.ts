import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/query.js";
import { uuidToBuf } from "../../db/ids.js";
import {
  addGcash,
  authHeaders,
  confirmPayment,
  finishWork,
  freshImageSeed,
  getTestApp,
  latestPaymentId,
  registerUser,
  resetData,
  startCommission,
  storedObject,
  storedPrivateObject,
  submitGcashPayment,
  testImage,
  uploadCommissionFile,
  type Session,
} from "../../test/helpers.js";
import { resolveProblem } from "./commission-payments.service.js";

/**
 * Payment records: a down payment to start and the balance before handover,
 * paid directly between the two parties and confirmed by whoever received it.
 *
 * Against real Oracle, because most of what makes the record trustworthy is a
 * database rule: the split adding up, one live payment of each kind, reference
 * numbers and receipt files never reused, one open problem at a time.
 */

interface Tracking {
  downPaymentCentavos: number;
  balanceCentavos: number;
  balanceMethod: string;
  stage: string;
  payments: {
    id: string;
    kind: string;
    method: string;
    status: string;
    amountCentavos: number;
    referenceNumber?: string;
    receiptFileId?: string;
    paidTo?: { accountNumber: string };
    recordedBy: string;
  }[];
  finishedPhotoIds: string[];
  shipping?: { courier: string; trackingNumber?: string };
  openProblem?: { id: string; openedByViewer: boolean };
  payTo: { method: string; accountNumber: string }[];
}

let client: Session;
let artist: Session;
let outsider: Session;

async function inject(
  session: Session,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const app = await getTestApp();
  return app.inject({
    method,
    url,
    headers: authHeaders(session),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function tracking(session: Session, commissionId: string): Promise<Tracking> {
  const response = await inject(session, "GET", `/commissions/${commissionId}`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { paymentTracking: Tracking }).paymentTracking;
}

async function notificationTypes(session: Session): Promise<string[]> {
  const response = await inject(session, "GET", "/notifications?limit=50");
  return (response.json() as { items: { type: string }[] }).items.map((item) => item.type);
}

async function reportProblem(session: Session, commissionId: string) {
  return inject(session, "POST", `/commissions/${commissionId}/problems`, {
    reason: "payment_not_received",
    details: "I sent the down payment but it is still not confirmed.",
  });
}

beforeEach(async () => {
  await resetData();
  client = await registerUser("client");
  artist = await registerUser("artist");
  outsider = await registerUser("client");
  await addGcash(artist);
});

describe("starting a commission", () => {
  it("copies a 50/50 split onto the commission that adds up to the agreed price exactly", async () => {
    const commissionId = await startCommission(client, artist, 200_001);
    const view = await tracking(client, commissionId);

    expect(view.downPaymentCentavos).toBe(100_001);
    expect(view.balanceCentavos).toBe(100_000);
    expect(view.downPaymentCentavos + view.balanceCentavos).toBe(200_001);
    expect(view.balanceMethod).toBe("transfer");
    expect(view.stage).toBe("awaiting_down_payment");
  });

  it("shows the client where to pay, and nothing at all to anyone outside it", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await tracking(client, commissionId)).payTo).toEqual([
      expect.objectContaining({ method: "gcash", accountNumber: "09171234567" }),
    ]);
    expect((await inject(outsider, "GET", `/commissions/${commissionId}`)).statusCode).toBe(404);
    expect((await uploadCommissionFile(outsider, commissionId, await testImage(freshImageSeed()))).statusCode).toBe(404);
  });
});

describe("the down payment", () => {
  it("is recorded by the client with its receipt and the account it was paid to", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await submitGcashPayment(client, commissionId, "down", { referenceNumber: "1004 5678-901" })).statusCode).toBe(201);

    const view = await tracking(artist, commissionId);
    expect(view.stage).toBe("down_payment_submitted");
    expect(view.payments[0]).toMatchObject({
      kind: "down",
      method: "gcash",
      status: "submitted",
      amountCentavos: 100_000,
      referenceNumber: "10045678901",
      recordedBy: "client",
      paidTo: expect.objectContaining({ accountNumber: "09171234567" }),
    });
    expect(view.payments[0]!.receiptFileId).toBeTruthy();
    expect(await notificationTypes(artist)).toContain("payment_submitted");
  });

  it("is confirmed only by the artist, who received it", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    const paymentId = await latestPaymentId(client, commissionId, "down");

    expect((await inject(client, "POST", `/commissions/${commissionId}/payments/${paymentId}/confirm`)).statusCode).toBe(403);
    expect((await inject(outsider, "POST", `/commissions/${commissionId}/payments/${paymentId}/confirm`)).statusCode).toBe(404);

    expect((await confirmPayment(artist, commissionId, "down")).statusCode).toBe(204);
    expect((await tracking(client, commissionId)).stage).toBe("in_progress");
    expect(await notificationTypes(client)).toContain("payment_confirmed");

    // Deciding twice changes nothing.
    expect((await inject(artist, "POST", `/commissions/${commissionId}/payments/${paymentId}/reject`)).statusCode).toBe(400);
  });

  it("can be sent again after the artist says it did not arrive, with the same reference and receipt", async () => {
    const commissionId = await startCommission(client, artist);
    const upload = await uploadCommissionFile(client, commissionId, await testImage(freshImageSeed()));
    const receiptFileId = (upload.json() as { id: string }).id;
    await submitGcashPayment(client, commissionId, "down", { referenceNumber: "555000111", receiptFileId });

    const paymentId = await latestPaymentId(artist, commissionId, "down");
    expect((await inject(artist, "POST", `/commissions/${commissionId}/payments/${paymentId}/reject`)).statusCode).toBe(204);
    expect(await notificationTypes(client)).toContain("payment_rejected");
    expect((await tracking(client, commissionId)).stage).toBe("awaiting_down_payment");

    const again = await submitGcashPayment(client, commissionId, "down", { referenceNumber: "555000111", receiptFileId });
    expect(again.statusCode).toBe(201);
    const view = await tracking(artist, commissionId);
    expect(view.payments.map((payment) => payment.status)).toEqual(["submitted", "rejected"]);
  });

  it("cannot be recorded by the artist", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await submitGcashPayment(artist, commissionId, "down")).statusCode).toBe(403);
  });

  it("must be exactly the amount due", async () => {
    const commissionId = await startCommission(client, artist);
    const response = await submitGcashPayment(client, commissionId, "down", { amountCentavos: 99_999 });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.amountCentavos).toMatch(/1,000\.00/);
  });

  it("must be dated within the commission", async () => {
    const commissionId = await startCommission(client, artist);
    const tomorrowPlusOne = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await submitGcashPayment(client, commissionId, "down", { paidOn: tomorrowPlusOne })).statusCode).toBe(400);
    expect((await submitGcashPayment(client, commissionId, "down", { paidOn: "2020-01-01" })).statusCode).toBe(400);
  });

  it("must use a method the artist has listed", async () => {
    const commissionId = await startCommission(client, artist);
    const upload = await uploadCommissionFile(client, commissionId, await testImage(freshImageSeed()));
    const response = await inject(client, "POST", `/commissions/${commissionId}/payments`, {
      kind: "down",
      method: "maya",
      amountCentavos: 100_000,
      referenceNumber: "777888999",
      paidOn: new Date().toISOString().slice(0, 10),
      receiptFileId: (upload.json() as { id: string }).id,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields.method).toBeTruthy();
  });

  it("needs a receipt the client uploaded to this commission", async () => {
    const commissionId = await startCommission(client, artist);
    const otherCommission = await startCommission(client, artist);

    const elsewhere = await uploadCommissionFile(client, otherCommission, await testImage(freshImageSeed()));
    expect(
      (await submitGcashPayment(client, commissionId, "down", {
        receiptFileId: (elsewhere.json() as { id: string }).id,
      })).statusCode,
    ).toBe(400);

    // The artist's upload here is a photo of the work, not a receipt.
    const artistsFile = await uploadCommissionFile(artist, commissionId, await testImage(freshImageSeed()));
    expect((artistsFile.json() as { kind: string }).kind).toBe("finished_photo");
    expect(
      (await submitGcashPayment(client, commissionId, "down", {
        receiptFileId: (artistsFile.json() as { id: string }).id,
      })).statusCode,
    ).toBe(400);
  });

  it("refuses a reference number already used on another commission", async () => {
    const first = await startCommission(client, artist);
    const second = await startCommission(client, artist);
    expect((await submitGcashPayment(client, first, "down", { referenceNumber: "9990001112" })).statusCode).toBe(201);

    const reused = await submitGcashPayment(client, second, "down", { referenceNumber: "999-000-1112" });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.fields.referenceNumber).toBeTruthy();
  });

  it("refuses the same receipt file used for another commission", async () => {
    const first = await startCommission(client, artist);
    const second = await startCommission(client, artist);
    const receipt = await testImage(freshImageSeed());
    expect((await submitGcashPayment(client, first, "down", { receipt })).statusCode).toBe(201);

    const reused = await submitGcashPayment(client, second, "down", { receipt });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.fields.receiptFileId).toBeTruthy();
  });

  /**
   * A recycled receipt re-saved as a different file slips past the file check,
   * and no image comparison can reliably catch it: measured on receipt-like
   * screenshots, a re-saved copy differed from the original by more than two
   * genuinely different receipts did. What gives it away is the reference
   * number printed on it, which cannot be reused.
   */
  it("catches a recycled receipt saved as a different file by its reference number", async () => {
    const first = await startCommission(client, artist);
    const second = await startCommission(client, artist);
    const seed = freshImageSeed();
    expect(
      (await submitGcashPayment(client, first, "down", { receipt: await testImage(seed, "png"), referenceNumber: "3141592653" })).statusCode,
    ).toBe(201);

    const recycled = await submitGcashPayment(client, second, "down", {
      receipt: await testImage(seed, "jpeg"),
      referenceNumber: "3141592653",
    });
    expect(recycled.statusCode).toBe(409);
    expect(recycled.json().error.fields.referenceNumber).toBeTruthy();
  });

  it("waits for a decision before another can be recorded", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await submitGcashPayment(client, commissionId, "down")).statusCode).toBe(201);
    expect((await submitGcashPayment(client, commissionId, "down")).statusCode).toBe(409);
  });

  it("keeps the account it was paid to, even after the artist changes their details", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await addGcash(artist, "09998887777");

    const view = await tracking(client, commissionId);
    expect(view.payments[0]!.paidTo!.accountNumber).toBe("09171234567");
    expect(view.payTo[0]!.accountNumber).toBe("09998887777");
  });
});

describe("receipts and photos are private", () => {
  it("are stored privately and served only to the two parties, never cached", async () => {
    const commissionId = await startCommission(client, artist);
    const upload = await uploadCommissionFile(client, commissionId, await testImage(freshImageSeed()));
    expect(upload.statusCode).toBe(201);
    const fileId = (upload.json() as { id: string }).id;

    const key = `commissions/${commissionId}/${fileId}.webp`;
    expect(storedPrivateObject(key)?.contentType).toBe("image/webp");
    expect(storedObject(key)).toBeUndefined();
    // The response names no URL a browser could share.
    expect(JSON.stringify(upload.json())).not.toMatch(/https?:/);

    for (const party of [client, artist]) {
      const served = await inject(party, "GET", `/commissions/${commissionId}/files/${fileId}`);
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/webp");
      expect(served.headers["cache-control"]).toBe("private, no-store");
      expect(served.rawPayload.equals(storedPrivateObject(key)!.body)).toBe(true);
    }
    expect((await inject(outsider, "GET", `/commissions/${commissionId}/files/${fileId}`)).statusCode).toBe(404);

    // A real file id asked for under the wrong commission is not found either.
    const other = await startCommission(client, artist);
    expect((await inject(client, "GET", `/commissions/${other}/files/${fileId}`)).statusCode).toBe(404);
  });
});

describe("the work and the balance", () => {
  it("starts only once the down payment is confirmed, and only the artist marks it finished", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await finishWork(artist, commissionId)).statusCode).toBe(400);

    await submitGcashPayment(client, commissionId, "down");
    await confirmPayment(artist, commissionId, "down");

    const photo = await uploadCommissionFile(client, commissionId, await testImage(freshImageSeed()));
    const byClient = await inject(client, "POST", `/commissions/${commissionId}/finished`, {
      photoFileIds: [(photo.json() as { id: string }).id],
    });
    expect(byClient.statusCode).toBe(403);

    expect((await finishWork(artist, commissionId)).statusCode).toBe(204);
    const view = await tracking(client, commissionId);
    expect(view.stage).toBe("awaiting_balance");
    expect(view.finishedPhotoIds).toHaveLength(1);
    expect(await notificationTypes(client)).toContain("work_finished");
  });

  it("can be marked finished without any photos", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await confirmPayment(artist, commissionId, "down");

    const finished = await inject(artist, "POST", `/commissions/${commissionId}/finished`, {});
    expect(finished.statusCode).toBe(204);
    const view = await tracking(client, commissionId);
    expect(view.stage).toBe("awaiting_balance");
    expect(view.finishedPhotoIds).toEqual([]);
  });

  it("is paid after the piece is delivered, then completes", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await confirmPayment(artist, commissionId, "down");

    expect((await submitGcashPayment(client, commissionId, "balance")).statusCode).toBe(400);
    await finishWork(artist, commissionId);

    // Not before it has been sent: the client pays once it arrives.
    expect((await submitGcashPayment(client, commissionId, "balance")).statusCode).toBe(400);
    expect((await inject(artist, "PUT", `/commissions/${commissionId}/shipping`, { courier: "J&T Express" })).statusCode).toBe(204);

    expect((await submitGcashPayment(client, commissionId, "balance")).statusCode).toBe(201);
    expect((await inject(client, "POST", `/commissions/${commissionId}/complete`)).statusCode).toBe(400);

    await confirmPayment(artist, commissionId, "balance");
    expect((await tracking(client, commissionId)).stage).toBe("ready_to_complete");
    const completed = await inject(client, "POST", `/commissions/${commissionId}/complete`);
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("completed");
  });

  it("ships as soon as the piece is finished, before the balance", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await confirmPayment(artist, commissionId, "down");

    const early = await inject(artist, "PUT", `/commissions/${commissionId}/shipping`, { courier: "J&T Express" });
    expect(early.statusCode).toBe(400);

    await finishWork(artist, commissionId);
    const shipped = await inject(artist, "PUT", `/commissions/${commissionId}/shipping`, {
      courier: "J&T Express",
      trackingNumber: "JT0001234567",
    });
    expect(shipped.statusCode).toBe(204);
    expect((await tracking(client, commissionId)).shipping).toMatchObject({ courier: "J&T Express", trackingNumber: "JT0001234567" });
    expect(await notificationTypes(client)).toContain("commission_shipped");
  });

  it("offers only paying after delivery or at a meet-up", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await tracking(client, commissionId)).balanceMethod).toBe("transfer");
    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: "cod" })).statusCode).toBe(400);
    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: "meetup" })).statusCode).toBe(204);
  });

  it("hands over a meet-up piece in person, with nothing to ship", async () => {
    const commissionId = await startCommission(client, artist);
    await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: "meetup" });
    await submitGcashPayment(client, commissionId, "down");
    await confirmPayment(artist, commissionId, "down");
    await finishWork(artist, commissionId);

    // Paid in cash at the meet-up: nothing for the client to submit.
    expect((await submitGcashPayment(client, commissionId, "balance")).statusCode).toBe(400);
    expect((await inject(artist, "PUT", `/commissions/${commissionId}/shipping`, { courier: "LBC" })).statusCode).toBe(400);
    expect((await inject(client, "POST", `/commissions/${commissionId}/balance-received`)).statusCode).toBe(403);
    expect((await inject(artist, "POST", `/commissions/${commissionId}/balance-received`)).statusCode).toBe(204);
    expect((await tracking(artist, commissionId)).payments[0]!.method).toBe("cash");
  });

  it("tells the artist which balance option the client chose, only when it changes", async () => {
    const commissionId = await startCommission(client, artist);
    const current = (await tracking(client, commissionId)).balanceMethod;
    const other = current === "meetup" ? "transfer" : "meetup";

    const chosen = async () => {
      const response = await inject(artist, "GET", "/notifications?limit=50");
      return (response.json() as { items: { type: string; payload: { method?: string } }[] }).items.filter(
        (item) => item.type === "balance_method_chosen",
      );
    };

    // Saving what is already saved is not news to the artist.
    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: current })).statusCode).toBe(204);
    expect(await chosen()).toHaveLength(0);

    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: other })).statusCode).toBe(204);
    const notices = await chosen();
    expect(notices).toHaveLength(1);
    expect(notices[0]!.payload).toMatchObject({ commissionId, method: other });
    // The client made the choice, so the client is not told about it.
    expect(await notificationTypes(client)).not.toContain("balance_method_chosen");
  });

  it("fixes the balance option once the artist has confirmed the down payment", async () => {
    const commissionId = await startCommission(client, artist);
    expect((await inject(artist, "PUT", `/commissions/${commissionId}/balance-method`, { method: "meetup" })).statusCode).toBe(403);

    await submitGcashPayment(client, commissionId, "down");
    // Still changeable while the artist has not confirmed.
    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: "meetup" })).statusCode).toBe(204);

    await confirmPayment(artist, commissionId, "down");
    expect((await inject(client, "PUT", `/commissions/${commissionId}/balance-method`, { method: "transfer" })).statusCode).toBe(400);
    expect((await tracking(client, commissionId)).balanceMethod).toBe("meetup");
  });
});

describe("reported problems", () => {
  it("pause the commission and tell the other party, one at a time", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");

    expect((await reportProblem(client, commissionId)).statusCode).toBe(201);
    expect(await notificationTypes(artist)).toContain("problem_reported");
    expect((await tracking(artist, commissionId)).openProblem).toBeTruthy();

    expect((await confirmPayment(artist, commissionId, "down")).statusCode).toBe(400);
    expect((await reportProblem(artist, commissionId)).statusCode).toBe(409);
    expect((await reportProblem(outsider, commissionId)).statusCode).toBe(404);
  });

  it("can be withdrawn by the person who reported, which unpauses it", async () => {
    const commissionId = await startCommission(client, artist);
    await submitGcashPayment(client, commissionId, "down");
    await reportProblem(client, commissionId);
    const problemId = (await tracking(client, commissionId)).openProblem!.id;

    expect((await inject(artist, "POST", `/commissions/${commissionId}/problems/${problemId}/withdraw`)).statusCode).toBe(403);
    expect((await inject(client, "POST", `/commissions/${commissionId}/problems/${problemId}/withdraw`)).statusCode).toBe(204);

    expect((await tracking(artist, commissionId)).openProblem).toBeUndefined();
    expect((await confirmPayment(artist, commissionId, "down")).statusCode).toBe(204);
  });

  it("are settled by the owner, either calling the commission off or letting it continue", async () => {
    const cancelled = await startCommission(client, artist);
    await submitGcashPayment(client, cancelled, "down");
    await reportProblem(artist, cancelled);
    await resolveProblem((await tracking(client, cancelled)).openProblem!.id, "cancel", "Refund agreed between you.");

    const afterCancel = await inject(client, "GET", `/commissions/${cancelled}`);
    expect(afterCancel.json().status).toBe("cancelled");
    expect(await notificationTypes(client)).toContain("problem_closed");
    expect(await notificationTypes(artist)).toContain("problem_closed");

    const continued = await startCommission(client, artist);
    await submitGcashPayment(client, continued, "down");
    await reportProblem(client, continued);
    await resolveProblem((await tracking(client, continued)).openProblem!.id, "continue", "Payment located.");
    expect((await confirmPayment(artist, continued, "down")).statusCode).toBe(204);
  });
});

describe("cancelling", () => {
  it("is possible before any payment is on record, and not after", async () => {
    const early = await startCommission(client, artist);
    expect((await inject(artist, "POST", `/commissions/${early}/cancel`)).statusCode).toBe(200);

    const paid = await startCommission(client, artist);
    await submitGcashPayment(client, paid, "down");
    const refused = await inject(client, "POST", `/commissions/${paid}/cancel`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/Report a problem/);
  });
});

describe("commissions started before payment records", () => {
  it("keep the original flow and refuse payment actions", async () => {
    const commissionId = await startCommission(client, artist);
    // The shape migration 010 gives every commission that already existed.
    await db.run(
      `UPDATE commissions
          SET payment_tracking = 0, down_payment_centavos = NULL, balance_centavos = NULL,
              balance_method = NULL
        WHERE id = :id`,
      { id: uuidToBuf(commissionId) },
    );

    const view = await inject(client, "GET", `/commissions/${commissionId}`);
    expect(view.json().paymentTracking).toBeUndefined();
    expect((await submitGcashPayment(client, commissionId, "down", { amountCentavos: 100_000, receiptFileId: "01920000-0000-7000-8000-000000000009" })).statusCode).toBe(400);
    expect((await inject(client, "POST", `/commissions/${commissionId}/complete`)).statusCode).toBe(200);
  });
});

describe("where artists are paid", () => {
  it("is set by artists only, with numbers normalised and a bank name required for banks", async () => {
    expect(
      (await inject(client, "PUT", "/me/payout-accounts", {
        accounts: [{ method: "gcash", accountName: "Maya Client", accountNumber: "09170000000" }],
      })).statusCode,
    ).toBe(403);

    const saved = await inject(artist, "PUT", "/me/payout-accounts", {
      accounts: [
        { method: "gcash", accountName: "Nena Hooks", accountNumber: "+63 917-555-0101" },
        { method: "bank", accountName: "Nena Hooks", accountNumber: "0012-3456-7890", bankName: "BPI" },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual([
      { method: "gcash", accountName: "Nena Hooks", accountNumber: "09175550101" },
      { method: "bank", accountName: "Nena Hooks", accountNumber: "001234567890", bankName: "BPI" },
    ]);

    expect(
      (await inject(artist, "PUT", "/me/payout-accounts", {
        accounts: [{ method: "bank", accountName: "Nena Hooks", accountNumber: "001234567890" }],
      })).statusCode,
    ).toBe(400);
  });
});
