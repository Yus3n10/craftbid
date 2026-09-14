import {
  type BalanceMethod,
  type CommissionPaymentDto,
  type CommissionProblemDto,
  type PaymentStage,
  type PaymentTrackingDto,
  type PayoutAccountDto,
  type PayoutAccountInput,
  type ReportProblemInput,
  type SubmitPaymentInput,
  formatPeso,
} from "@craftbid/shared";
import { createHash } from "node:crypto";
import { newId } from "../../db/ids.js";
import { DbError, db, withTransaction, type Queryable } from "../../db/query.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage/index.js";
import { normaliseImage } from "../images/images.service.js";
import * as notifications from "../notifications/notifications.repository.js";
import * as postingsRepo from "../postings/postings.repository.js";
import * as commissionsRepo from "../commissions/commissions.repository.js";
import * as repo from "./commission-payments.repository.js";

/**
 * Payment records on a commission.
 *
 * Nothing here moves money. The client pays the artist directly, and this
 * records what both of them say happened. Three rules carry the design:
 *
 * 1. The person who received a payment is the one who confirms it. They can
 *    look at their own wallet or bank history; a screenshot can be faked.
 * 2. Amounts come from the commission, never from the request. The client
 *    states what they sent only so a mistake shows up as an error.
 * 3. An open problem pauses everything, so neither side can push a disputed
 *    commission forward while it is being looked at.
 */

type Role = "client" | "artist";

const METHOD_LABEL: Record<string, string> = { gcash: "GCash", maya: "Maya", bank: "bank" };

/**
 * A tracked commission the user is part of. Anyone else gets a 404, the same
 * answer as for an id that does not exist, so ids cannot be probed.
 */
async function loadForUser(
  commissionId: string,
  userId: string,
  q: Queryable,
  options: { forUpdate?: boolean } = {},
): Promise<{ context: repo.TrackingContext; role: Role }> {
  const context = await repo.findTrackingContext(commissionId, q, options);
  if (!context || (context.clientId !== userId && context.artistId !== userId)) {
    throw notFound("That commission does not exist.");
  }
  if (!context.paymentTracking) {
    throw badRequest(
      "This commission was started before payment records existed. Arrange payment directly.",
    );
  }
  return { context, role: context.clientId === userId ? "client" : "artist" };
}

function requireRole(role: Role, needed: Role, action: string): void {
  if (role !== needed) {
    throw forbidden(
      needed === "client" ? `Only the client can ${action}.` : `Only the artist can ${action}.`,
    );
  }
}

function requireActive(context: repo.TrackingContext): void {
  if (context.status !== "active") {
    throw badRequest(`This commission is already ${context.status}.`);
  }
}

async function requireNoOpenProblem(commissionId: string, q: Queryable): Promise<void> {
  const problems = await repo.listProblems(commissionId, q);
  if (problems.some((problem) => problem.status === "open")) {
    throw badRequest(
      "A problem has been reported on this commission. Everything is paused until it is settled.",
    );
  }
}

/** The live (not rejected) payment of a kind, if any. */
function livePayment(payments: repo.PaymentRecord[], kind: "down" | "balance") {
  return payments.find((payment) => payment.kind === kind && payment.status !== "rejected");
}

/**
 * Where a tracked commission stands. Pure, so the rules can be read in one
 * place and the API and the screen can never disagree about the next step.
 */
export function computeStage(
  payments: repo.PaymentRecord[],
  finishedAt: Date | null,
): PaymentStage {
  const down = livePayment(payments, "down");
  if (!down) return "awaiting_down_payment";
  if (down.status === "submitted") return "down_payment_submitted";
  if (!finishedAt) return "in_progress";
  const balance = livePayment(payments, "balance");
  if (!balance) return "awaiting_balance";
  if (balance.status === "submitted") return "balance_submitted";
  return "ready_to_complete";
}

function toPayoutDto(record: repo.PayoutAccountRecord): PayoutAccountDto {
  return {
    method: record.method,
    accountName: record.accountName,
    accountNumber: record.accountNumber,
    ...(record.bankName ? { bankName: record.bankName } : {}),
  };
}

function toPaymentDto(
  payment: repo.PaymentRecord,
  context: repo.TrackingContext,
): CommissionPaymentDto {
  const isTransfer = payment.method === "gcash" || payment.method === "maya" || payment.method === "bank";
  return {
    id: payment.id,
    kind: payment.kind,
    method: payment.method,
    status: payment.status,
    amountCentavos: payment.amountCentavos,
    ...(payment.referenceNumber ? { referenceNumber: payment.referenceNumber } : {}),
    ...(payment.paidOn ? { paidOn: payment.paidOn } : {}),
    ...(payment.receiptFileId ? { receiptFileId: payment.receiptFileId } : {}),
    ...(isTransfer && payment.paidToName && payment.paidToNumber
      ? {
          paidTo: {
            method: payment.method as "gcash" | "maya" | "bank",
            accountName: payment.paidToName,
            accountNumber: payment.paidToNumber,
            ...(payment.paidToBank ? { bankName: payment.paidToBank } : {}),
          },
        }
      : {}),
    recordedBy: payment.recordedBy === context.clientId ? "client" : "artist",
    submittedAt: payment.submittedAt.toISOString(),
    ...(payment.decidedAt ? { decidedAt: payment.decidedAt.toISOString() } : {}),
  };
}

function toProblemDto(
  problem: repo.ProblemRecord,
  context: repo.TrackingContext,
  viewerId: string,
): CommissionProblemDto {
  return {
    id: problem.id,
    reason: problem.reason,
    details: problem.details,
    status: problem.status,
    openedBy: problem.openedBy === context.clientId ? "client" : "artist",
    openedByViewer: problem.openedBy === viewerId,
    ...(problem.resolution ? { resolution: problem.resolution } : {}),
    createdAt: problem.createdAt.toISOString(),
    ...(problem.closedAt ? { closedAt: problem.closedAt.toISOString() } : {}),
  };
}

/**
 * The payment block of a commission, for one of its two parties. Returns
 * undefined for a commission started before payment records existed.
 */
export async function buildTracking(
  commissionId: string,
  viewerId: string,
): Promise<PaymentTrackingDto | undefined> {
  const context = await repo.findTrackingContext(commissionId);
  if (!context || !context.paymentTracking) return undefined;
  if (context.clientId !== viewerId && context.artistId !== viewerId) return undefined;

  const [payments, problems, photoIds, payTo] = await Promise.all([
    repo.listPayments(commissionId),
    repo.listProblems(commissionId),
    repo.listFinishedPhotoIds(commissionId),
    repo.listPayoutAccounts(context.artistId),
  ]);

  const open = problems.find((problem) => problem.status === "open");

  return {
    downPaymentCentavos: context.downPaymentCentavos!,
    balanceCentavos: context.balanceCentavos!,
    balanceMethod: context.balanceMethod!,
    stage: computeStage(payments, context.finishedAt),
    payments: payments.map((payment) => toPaymentDto(payment, context)),
    ...(context.finishedAt ? { finishedAt: context.finishedAt.toISOString() } : {}),
    finishedPhotoIds: photoIds,
    ...(context.shippingCourier && context.shippedAt
      ? {
          shipping: {
            courier: context.shippingCourier,
            ...(context.shippingTracking ? { trackingNumber: context.shippingTracking } : {}),
            shippedAt: context.shippedAt.toISOString(),
          },
        }
      : {}),
    ...(open ? { openProblem: toProblemDto(open, context, viewerId) } : {}),
    problems: problems.map((problem) => toProblemDto(problem, context, viewerId)),
    // Payment details only matter while there is something left to pay.
    payTo: context.status === "active" ? payTo.map(toPayoutDto) : [],
  };
}

// --- Payout accounts --------------------------------------------------------

export async function getPayoutAccounts(userId: string): Promise<PayoutAccountDto[]> {
  return (await repo.listPayoutAccounts(userId)).map(toPayoutDto);
}

export async function setPayoutAccounts(
  userId: string,
  accounts: PayoutAccountInput[],
): Promise<PayoutAccountDto[]> {
  await withTransaction((tx) =>
    repo.replacePayoutAccounts(
      userId,
      accounts.map((account) => ({
        method: account.method,
        accountName: account.accountName,
        accountNumber: account.accountNumber,
        ...("bankName" in account ? { bankName: account.bankName } : {}),
      })),
      tx,
    ),
  );
  return getPayoutAccounts(userId);
}

// --- Balance method ---------------------------------------------------------

/**
 * The client chooses how the balance will be settled, and can change it until
 * the artist confirms the down payment. After that the artist has started work
 * on the understanding they were given, so it is fixed.
 */
export async function setBalanceMethod(
  commissionId: string,
  userId: string,
  method: BalanceMethod,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "client", "choose how the balance is paid");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    const down = livePayment(await repo.listPayments(commissionId, tx), "down");
    if (down?.status === "confirmed") {
      throw badRequest(
        "The down payment is already confirmed, so the balance option is fixed. Agree any change with the artist directly.",
      );
    }
    if (context.balanceMethod === method) return;
    await repo.setBalanceMethod(commissionId, method, tx);
    // It decides whether the artist ships before or after the balance, so the
    // artist hears about it rather than finding out by opening the commission.
    await notifications.notify(
      { userId: context.artistId, type: "balance_method_chosen", payload: { commissionId, method } },
      tx,
    );
  });
}

// --- Files ------------------------------------------------------------------

/**
 * Uploads one private image. What it is depends on who sends it: the client
 * sends receipts, the artist sends photos of the finished piece. Deciding that
 * here, rather than taking it from the request, means neither side can put a
 * file where the other side's proof belongs.
 */
export async function uploadFile(
  commissionId: string,
  userId: string,
  buffer: Buffer,
): Promise<{ id: string; kind: "receipt" | "finished_photo"; width: number; height: number }> {
  const { context, role } = await loadForUser(commissionId, userId, db);
  requireActive(context);

  const image = await normaliseImage(buffer);
  // Of the bytes as uploaded, so the same file sent twice is recognised.
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const kind = role === "client" ? "receipt" : "finished_photo";
  const id = newId();
  // Server-derived key; nothing the client sends reaches the storage path.
  const key = `commissions/${commissionId}/${id}.webp`;

  const storage = getStorage();
  await storage.putPrivate(key, image.data, "image/webp");
  try {
    await repo.insertFile({
      id,
      commissionId,
      uploaderId: userId,
      kind,
      objectKey: key,
      contentType: "image/webp",
      byteSize: image.data.byteLength,
      width: image.width,
      height: image.height,
      sha256,
    });
  } catch (error) {
    await storage.removePrivate(key).catch(() => {});
    throw error;
  }

  return { id, kind, width: image.width, height: image.height };
}

/** The bytes of a private file, for one of the commission's two parties only. */
export async function readFile(
  commissionId: string,
  fileId: string,
  userId: string,
): Promise<{ body: Buffer; contentType: string }> {
  await loadForUser(commissionId, userId, db);
  const file = await repo.findFile(fileId);
  // A file from another commission is "not found" here, not "forbidden".
  if (!file || file.commissionId !== commissionId) throw notFound("That file does not exist.");

  const body = await getStorage().getPrivate(file.objectKey);
  if (!body) throw notFound("That file does not exist.");
  return { body, contentType: file.contentType };
}

// --- Payments ---------------------------------------------------------------

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The client records a transfer they made to the artist.
 *
 * Checks, in the order a person would hit them: the commission is at the step
 * this payment belongs to; the amount is exactly what is due; the date is
 * plausible; the artist has the account the client says they paid; and the
 * receipt is one the client uploaded to this commission. The reference number
 * and the receipt file are unique across Craftbid, enforced by the database.
 */
export async function submitPayment(
  commissionId: string,
  userId: string,
  input: SubmitPaymentInput,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "client", "record a payment");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    const payments = await repo.listPayments(commissionId, tx);
    const stage = computeStage(payments, context.finishedAt);

    if (input.kind === "down") {
      if (stage === "down_payment_submitted") {
        throw conflict("A down payment is already waiting for the artist to confirm.");
      }
      if (stage !== "awaiting_down_payment") {
        throw badRequest("The down payment has already been confirmed.");
      }
    } else {
      if (context.balanceMethod !== "transfer") {
        throw badRequest(
          context.balanceMethod === "cod"
            ? "The balance is paid to the courier on delivery, and the artist records it."
            : "The balance is paid in cash when you meet, and the artist records it.",
        );
      }
      if (stage === "balance_submitted") {
        throw conflict("A balance payment is already waiting for the artist to confirm.");
      }
      if (stage !== "awaiting_balance") {
        throw badRequest(
          stage === "ready_to_complete"
            ? "The balance has already been confirmed."
            : "The balance is paid once the artist has shown the finished piece.",
        );
      }
    }

    const due = input.kind === "down" ? context.downPaymentCentavos! : context.balanceCentavos!;
    if (input.amountCentavos !== due) {
      throw badRequest(`The ${input.kind === "down" ? "down payment" : "balance"} is ${formatPeso(due)}.`, {
        amountCentavos: `Enter exactly ${formatPeso(due)}.`,
      });
    }

    const paidOn = Date.parse(`${input.paidOn}T00:00:00Z`);
    const earliest = utcDay(context.startedAt) - 86_400_000;
    const latest = utcDay(new Date()) + 86_400_000;
    if (paidOn < earliest || paidOn > latest) {
      throw badRequest("That date is outside this commission.", {
        paidOn: "Enter the day you sent it, on or after the day the commission started.",
      });
    }

    const accounts = await repo.listPayoutAccounts(context.artistId, tx);
    const account = accounts.find((candidate) => candidate.method === input.method);
    if (!account) {
      throw badRequest(`The artist has not added ${METHOD_LABEL[input.method]} details.`, {
        method: "Pay with a method the artist has listed.",
      });
    }

    const receipt = await repo.findFile(input.receiptFileId, tx);
    if (
      !receipt ||
      receipt.commissionId !== commissionId ||
      receipt.uploaderId !== userId ||
      receipt.kind !== "receipt"
    ) {
      throw badRequest("Upload the receipt for this payment.", {
        receiptFileId: "Upload the receipt for this payment.",
      });
    }

    try {
      await repo.insertTransferPayment(
        {
          id: newId(),
          commissionId,
          kind: input.kind,
          method: input.method,
          amountCentavos: due,
          referenceNumber: input.referenceNumber,
          paidOn: input.paidOn,
          receiptFileId: receipt.id,
          receiptSha256: receipt.sha256,
          paidToName: account.accountName,
          paidToNumber: account.accountNumber,
          paidToBank: account.bankName,
          recordedBy: userId,
        },
        tx,
      );
    } catch (error) {
      throw translatePaymentConflict(error);
    }

    await repo.attachFiles([receipt.id], tx);
    await notifications.notify(
      {
        userId: context.artistId,
        type: "payment_submitted",
        payload: { commissionId, kind: input.kind },
      },
      tx,
    );
  });
}

function translatePaymentConflict(error: unknown): unknown {
  if (!(error instanceof DbError) || !error.isUniqueViolation) return error;
  switch (error.constraintName) {
    case "UX_COMMISSION_PAYMENTS_REFERENCE":
      return conflict("That reference number has already been used on Craftbid.", {
        referenceNumber: "This reference number has already been used on Craftbid.",
      });
    case "UX_COMMISSION_PAYMENTS_RECEIPT":
      return conflict("That receipt has already been used on Craftbid.", {
        receiptFileId: "This receipt image has already been used on Craftbid.",
      });
    case "UX_COMMISSION_PAYMENTS_LIVE":
      return conflict("That payment has already been recorded.");
    default:
      return error;
  }
}

/**
 * The artist confirms or rejects a payment the client recorded. Only the
 * receiver decides, and only once: a second decision on the same payment
 * changes nothing.
 */
export async function decidePayment(
  commissionId: string,
  paymentId: string,
  userId: string,
  decision: "confirmed" | "rejected",
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "artist", decision === "confirmed" ? "confirm a payment" : "reject a payment");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    const payment = await repo.findPayment(paymentId, tx);
    if (!payment || payment.commissionId !== commissionId) {
      throw notFound("That payment does not exist.");
    }
    if (payment.status !== "submitted") {
      throw badRequest(`That payment was already ${payment.status}.`);
    }

    const changed = await repo.decidePayment(paymentId, decision, tx);
    if (changed === 0) throw badRequest("That payment was already decided.");

    await notifications.notify(
      {
        userId: context.clientId,
        type: decision === "confirmed" ? "payment_confirmed" : "payment_rejected",
        payload: { commissionId, kind: payment.kind },
      },
      tx,
    );
  });
}

/**
 * The artist records a cash-on-delivery or meet-up balance as received. There
 * is no client submission for these: the courier or the client hands the money
 * over, and the artist is the only one who can say it arrived.
 */
export async function recordInPersonBalance(commissionId: string, userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "artist", "record the balance as received");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    if (context.balanceMethod === "transfer") {
      throw badRequest("The client records a transferred balance, and you confirm it.");
    }
    const stage = computeStage(await repo.listPayments(commissionId, tx), context.finishedAt);
    if (stage !== "awaiting_balance") {
      throw badRequest(
        stage === "ready_to_complete"
          ? "The balance has already been recorded."
          : "Mark the piece as finished first.",
      );
    }

    try {
      await repo.insertInPersonBalance(
        {
          id: newId(),
          commissionId,
          method: context.balanceMethod === "cod" ? "cod" : "cash",
          amountCentavos: context.balanceCentavos!,
          recordedBy: userId,
        },
        tx,
      );
    } catch (error) {
      throw translatePaymentConflict(error);
    }

    await notifications.notify(
      { userId: context.clientId, type: "payment_confirmed", payload: { commissionId, kind: "balance" } },
      tx,
    );
  });
}

// --- Work -------------------------------------------------------------------

export async function markFinished(
  commissionId: string,
  userId: string,
  photoFileIds: string[],
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "artist", "mark the piece as finished");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    if (context.finishedAt) throw badRequest("The piece is already marked as finished.");
    const stage = computeStage(await repo.listPayments(commissionId, tx), context.finishedAt);
    if (stage !== "in_progress") {
      throw badRequest("Work starts once you confirm the down payment.");
    }

    for (const fileId of photoFileIds) {
      const file = await repo.findFile(fileId, tx);
      if (
        !file ||
        file.commissionId !== commissionId ||
        file.uploaderId !== userId ||
        file.kind !== "finished_photo"
      ) {
        throw badRequest("Upload photos of the finished piece to this commission.", {
          photoFileIds: "Upload photos of the finished piece to this commission.",
        });
      }
    }

    await repo.attachFiles(photoFileIds, tx);
    await repo.markFinished(commissionId, tx);
    await notifications.notify(
      { userId: context.clientId, type: "work_finished", payload: { commissionId } },
      tx,
    );
  });
}

/**
 * The artist records how the piece was sent. With a transferred balance that
 * waits until the balance is confirmed: photos, then payment, then shipping,
 * so the artist is never asked to send a finished piece on trust.
 */
export async function setShipping(
  commissionId: string,
  userId: string,
  courier: string,
  trackingNumber: string | undefined,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context, role } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireRole(role, "artist", "add shipping details");
    requireActive(context);
    await requireNoOpenProblem(commissionId, tx);

    if (context.balanceMethod === "meetup") {
      throw badRequest("This piece is handed over in person, so there is nothing to ship.");
    }
    if (!context.finishedAt) throw badRequest("Mark the piece as finished first.");

    const stage = computeStage(await repo.listPayments(commissionId, tx), context.finishedAt);
    if (context.balanceMethod === "transfer" && stage !== "ready_to_complete") {
      throw badRequest("Ship once you have confirmed the balance.");
    }

    await repo.setShipping(commissionId, courier, trackingNumber, tx);
    await notifications.notify(
      { userId: context.clientId, type: "commission_shipped", payload: { commissionId } },
      tx,
    );
  });
}

// --- Rules the commissions module asks about --------------------------------

/**
 * Whether a tracked commission may be completed: the balance confirmed and no
 * open problem. Untracked commissions are not this module's business.
 */
export async function assertCanComplete(commissionId: string, q: Queryable): Promise<void> {
  const context = await repo.findTrackingContext(commissionId, q);
  if (!context || !context.paymentTracking) return;
  await requireNoOpenProblem(commissionId, q);
  const stage = computeStage(await repo.listPayments(commissionId, q), context.finishedAt);
  if (stage !== "ready_to_complete") {
    throw badRequest(
      "This can be completed once the artist has confirmed the balance.",
    );
  }
}

/**
 * Whether a tracked commission may be cancelled outright: only before any
 * payment is on record. Once money has changed hands, or is claimed to have,
 * calling it off is a problem to report, not a button to press.
 */
export async function assertCanCancel(commissionId: string, q: Queryable): Promise<void> {
  const context = await repo.findTrackingContext(commissionId, q);
  if (!context || !context.paymentTracking) return;
  await requireNoOpenProblem(commissionId, q);
  const payments = await repo.listPayments(commissionId, q);
  if (payments.some((payment) => payment.status !== "rejected")) {
    throw badRequest(
      "A payment is already on record, so this cannot simply be cancelled. Report a problem instead.",
    );
  }
}

// --- Problems ---------------------------------------------------------------

export async function reportProblem(
  commissionId: string,
  userId: string,
  input: ReportProblemInput,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    requireActive(context);

    try {
      await repo.insertProblem(
        { id: newId(), commissionId, openedBy: userId, reason: input.reason, details: input.details },
        tx,
      );
    } catch (error) {
      if (
        error instanceof DbError &&
        error.isUniqueViolation &&
        error.constraintName === "UX_COMMISSION_PROBLEMS_OPEN"
      ) {
        throw conflict("A problem is already open on this commission.");
      }
      throw error;
    }

    await notifications.notify(
      {
        userId: context.clientId === userId ? context.artistId : context.clientId,
        type: "problem_reported",
        payload: { commissionId },
      },
      tx,
    );
  });
}

/** The person who reported a problem can take it back once it is sorted out. */
export async function withdrawProblem(
  commissionId: string,
  problemId: string,
  userId: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    const { context } = await loadForUser(commissionId, userId, tx, { forUpdate: true });
    const problem = await repo.findProblem(problemId, tx);
    if (!problem || problem.commissionId !== commissionId) {
      throw notFound("That report does not exist.");
    }
    if (problem.openedBy !== userId) {
      throw forbidden("Only the person who reported a problem can withdraw it.");
    }
    if ((await repo.closeProblem(problemId, "withdrawn", null, tx)) === 0) {
      throw badRequest("That report is already closed.");
    }
    await notifications.notify(
      {
        userId: context.clientId === userId ? context.artistId : context.clientId,
        type: "problem_closed",
        payload: { commissionId },
      },
      tx,
    );
  });
}

/**
 * Settles a problem. Deliberately not reachable over HTTP: Craftbid has no
 * staff accounts yet, so the site owner runs this from the command line (see
 * problems-cli.ts). "cancel" calls the commission off; "continue" unpauses it.
 */
export async function resolveProblem(
  problemId: string,
  outcome: "continue" | "cancel",
  note: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    const problem = await repo.findProblem(problemId, tx);
    if (!problem) throw notFound("That report does not exist.");
    const context = await repo.findTrackingContext(problem.commissionId, tx, { forUpdate: true });
    if (!context) throw notFound("That commission does not exist.");

    if ((await repo.closeProblem(problemId, "resolved", note, tx)) === 0) {
      throw badRequest("That report is already closed.");
    }
    if (outcome === "cancel" && context.status === "active") {
      await commissionsRepo.cancel(context.id, tx);
      await postingsRepo.setStatus(context.postingId, "cancelled", tx);
    }
    for (const userId of [context.clientId, context.artistId]) {
      await notifications.notify(
        { userId, type: "problem_closed", payload: { commissionId: context.id, outcome } },
        tx,
      );
    }
  });
}

export const listOpenProblems = () => repo.listOpenProblemsWithContacts();
