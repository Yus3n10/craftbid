import type {
  BalanceMethod,
  CommissionFileKind,
  CommissionStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  ProblemReason,
  ProblemStatus,
  TransferMethod,
} from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type Queryable } from "../../db/query.js";

export interface TrackingContext {
  id: string;
  postingId: string;
  postingTitle: string;
  clientId: string;
  artistId: string;
  status: CommissionStatus;
  agreedPriceCentavos: number;
  paymentTracking: boolean;
  downPaymentCentavos: number | null;
  balanceCentavos: number | null;
  balanceMethod: BalanceMethod | null;
  startedAt: Date;
  finishedAt: Date | null;
  shippingCourier: string | null;
  shippingTracking: string | null;
  shippedAt: Date | null;
}

interface TrackingRow {
  id: Buffer;
  postingId: Buffer;
  postingTitle: string;
  clientId: Buffer;
  artistId: Buffer;
  status: CommissionStatus;
  agreedPriceCentavos: number;
  paymentTracking: number;
  downPaymentCentavos: number | null;
  balanceCentavos: number | null;
  balanceMethod: BalanceMethod | null;
  startedAt: Date;
  finishedAt: Date | null;
  shippingCourier: string | null;
  shippingTracking: string | null;
  shippedAt: Date | null;
}

/**
 * The commission as the payment rules need it. `forUpdate` locks the row for
 * the rest of the transaction, so two confirmations or a confirmation racing a
 * problem report are decided one after the other, never interleaved.
 */
export async function findTrackingContext(
  id: string,
  q: Queryable = db,
  options: { forUpdate?: boolean } = {},
): Promise<TrackingContext | null> {
  const row = await q.one<TrackingRow>(
    `SELECT cm.id, cm.posting_id, p.title AS posting_title, cm.client_id, cm.artist_id,
            cm.status, cm.agreed_price_centavos, cm.payment_tracking,
            cm.down_payment_centavos, cm.balance_centavos, cm.balance_method,
            cm.started_at, cm.finished_at, cm.shipping_courier, cm.shipping_tracking,
            cm.shipped_at
       FROM commissions cm
       JOIN postings p ON p.id = cm.posting_id
      WHERE cm.id = :id${options.forUpdate ? " FOR UPDATE OF cm.status" : ""}`,
    { id: uuidToBuf(id) },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    postingId: bufToUuid(row.postingId)!,
    postingTitle: row.postingTitle,
    clientId: bufToUuid(row.clientId)!,
    artistId: bufToUuid(row.artistId)!,
    status: row.status,
    agreedPriceCentavos: Number(row.agreedPriceCentavos),
    paymentTracking: Number(row.paymentTracking) === 1,
    downPaymentCentavos: row.downPaymentCentavos === null ? null : Number(row.downPaymentCentavos),
    balanceCentavos: row.balanceCentavos === null ? null : Number(row.balanceCentavos),
    balanceMethod: row.balanceMethod,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    shippingCourier: row.shippingCourier,
    shippingTracking: row.shippingTracking,
    shippedAt: row.shippedAt,
  };
}

export async function setBalanceMethod(
  commissionId: string,
  method: BalanceMethod,
  tx: Queryable,
): Promise<void> {
  await tx.run(`UPDATE commissions SET balance_method = :method WHERE id = :id`, {
    id: uuidToBuf(commissionId),
    method,
  });
}

export async function markFinished(commissionId: string, tx: Queryable): Promise<void> {
  await tx.run(
    `UPDATE commissions SET finished_at = SYSTIMESTAMP WHERE id = :id AND finished_at IS NULL`,
    { id: uuidToBuf(commissionId) },
  );
}

export async function setShipping(
  commissionId: string,
  courier: string,
  trackingNumber: string | undefined,
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `UPDATE commissions
        SET shipping_courier = :courier, shipping_tracking = :tracking, shipped_at = SYSTIMESTAMP
      WHERE id = :id`,
    { id: uuidToBuf(commissionId), courier, tracking: trackingNumber ?? null },
  );
}

// --- Payout accounts --------------------------------------------------------

export interface PayoutAccountRecord {
  method: TransferMethod;
  accountName: string;
  accountNumber: string;
  bankName: string | null;
}

export async function listPayoutAccounts(
  userId: string,
  q: Queryable = db,
): Promise<PayoutAccountRecord[]> {
  return q.many<PayoutAccountRecord>(
    `SELECT method, account_name, account_number, bank_name
       FROM payout_accounts
      WHERE user_id = :userId
      ORDER BY CASE method WHEN 'gcash' THEN 1 WHEN 'maya' THEN 2 ELSE 3 END`,
    { userId: uuidToBuf(userId) },
  );
}

export async function replacePayoutAccounts(
  userId: string,
  accounts: { method: TransferMethod; accountName: string; accountNumber: string; bankName?: string }[],
  tx: Queryable,
): Promise<void> {
  await tx.run(`DELETE FROM payout_accounts WHERE user_id = :userId`, {
    userId: uuidToBuf(userId),
  });
  for (const account of accounts) {
    await tx.run(
      `INSERT INTO payout_accounts (user_id, method, account_name, account_number, bank_name)
       VALUES (:userId, :method, :accountName, :accountNumber, :bankName)`,
      {
        userId: uuidToBuf(userId),
        method: account.method,
        accountName: account.accountName,
        accountNumber: account.accountNumber,
        bankName: account.bankName ?? null,
      },
    );
  }
}

// --- Files ------------------------------------------------------------------

export interface CommissionFileRecord {
  id: string;
  commissionId: string;
  uploaderId: string;
  kind: CommissionFileKind;
  objectKey: string;
  contentType: string;
  sha256: string;
  attachedAt: Date | null;
}

export async function insertFile(
  input: {
    id: string;
    commissionId: string;
    uploaderId: string;
    kind: CommissionFileKind;
    objectKey: string;
    contentType: string;
    byteSize: number;
    width: number;
    height: number;
    sha256: string;
  },
  q: Queryable = db,
): Promise<void> {
  await q.run(
    `INSERT INTO commission_files
       (id, commission_id, uploader_id, kind, object_key, content_type, byte_size,
        width, height, sha256)
     VALUES (:id, :commissionId, :uploaderId, :kind, :objectKey, :contentType, :byteSize,
             :width, :height, :sha256)`,
    {
      id: uuidToBuf(input.id),
      commissionId: uuidToBuf(input.commissionId),
      uploaderId: uuidToBuf(input.uploaderId),
      kind: input.kind,
      objectKey: input.objectKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
    },
  );
}

export async function findFile(
  fileId: string,
  q: Queryable = db,
): Promise<CommissionFileRecord | null> {
  const row = await q.one<{
    id: Buffer;
    commissionId: Buffer;
    uploaderId: Buffer;
    kind: CommissionFileKind;
    objectKey: string;
    contentType: string;
    sha256: string;
    attachedAt: Date | null;
  }>(
    `SELECT id, commission_id, uploader_id, kind, object_key, content_type, sha256,
            attached_at
       FROM commission_files WHERE id = :id`,
    { id: uuidToBuf(fileId) },
  );
  if (!row) return null;
  return {
    id: bufToUuid(row.id)!,
    commissionId: bufToUuid(row.commissionId)!,
    uploaderId: bufToUuid(row.uploaderId)!,
    kind: row.kind,
    objectKey: row.objectKey,
    contentType: row.contentType,
    sha256: row.sha256,
    attachedAt: row.attachedAt,
  };
}

export async function attachFiles(fileIds: string[], tx: Queryable): Promise<void> {
  for (const fileId of fileIds) {
    await tx.run(
      `UPDATE commission_files SET attached_at = SYSTIMESTAMP WHERE id = :id AND attached_at IS NULL`,
      { id: uuidToBuf(fileId) },
    );
  }
}

export async function listFinishedPhotoIds(
  commissionId: string,
  q: Queryable = db,
): Promise<string[]> {
  const rows = await q.many<{ id: Buffer }>(
    `SELECT id FROM commission_files
      WHERE commission_id = :id AND kind = 'finished_photo' AND attached_at IS NOT NULL
      ORDER BY created_at`,
    { id: uuidToBuf(commissionId) },
  );
  return rows.map((row) => bufToUuid(row.id)!);
}

// --- Payments ---------------------------------------------------------------

export interface PaymentRecord {
  id: string;
  commissionId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCentavos: number;
  referenceNumber: string | null;
  paidOn: string | null;
  receiptFileId: string | null;
  paidToName: string | null;
  paidToNumber: string | null;
  paidToBank: string | null;
  recordedBy: string;
  submittedAt: Date;
  decidedAt: Date | null;
}

const PAYMENT_SELECT = `
  SELECT id, commission_id, kind, method, status, amount_centavos, reference_number,
         TO_CHAR(paid_on, 'YYYY-MM-DD') AS paid_on, receipt_file_id,
         paid_to_name, paid_to_number, paid_to_bank, recorded_by,
         submitted_at, decided_at
    FROM commission_payments`;

interface PaymentRow {
  id: Buffer;
  commissionId: Buffer;
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCentavos: number;
  referenceNumber: string | null;
  paidOn: string | null;
  receiptFileId: Buffer | null;
  paidToName: string | null;
  paidToNumber: string | null;
  paidToBank: string | null;
  recordedBy: Buffer;
  submittedAt: Date;
  decidedAt: Date | null;
}

function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: bufToUuid(row.id)!,
    commissionId: bufToUuid(row.commissionId)!,
    kind: row.kind,
    method: row.method,
    status: row.status,
    amountCentavos: Number(row.amountCentavos),
    referenceNumber: row.referenceNumber,
    paidOn: row.paidOn,
    receiptFileId: bufToUuid(row.receiptFileId),
    paidToName: row.paidToName,
    paidToNumber: row.paidToNumber,
    paidToBank: row.paidToBank,
    recordedBy: bufToUuid(row.recordedBy)!,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
  };
}

export async function listPayments(
  commissionId: string,
  q: Queryable = db,
): Promise<PaymentRecord[]> {
  const rows = await q.many<PaymentRow>(
    `${PAYMENT_SELECT} WHERE commission_id = :id ORDER BY submitted_at DESC, id DESC`,
    { id: uuidToBuf(commissionId) },
  );
  return rows.map(toPayment);
}

export async function findPayment(
  paymentId: string,
  q: Queryable = db,
): Promise<PaymentRecord | null> {
  const row = await q.one<PaymentRow>(`${PAYMENT_SELECT} WHERE id = :id`, {
    id: uuidToBuf(paymentId),
  });
  return row ? toPayment(row) : null;
}

export async function insertTransferPayment(
  input: {
    id: string;
    commissionId: string;
    kind: PaymentKind;
    method: TransferMethod;
    amountCentavos: number;
    referenceNumber: string;
    paidOn: string;
    receiptFileId: string;
    receiptSha256: string;
    paidToName: string;
    paidToNumber: string;
    paidToBank: string | null;
    recordedBy: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO commission_payments
       (id, commission_id, kind, method, status, amount_centavos, reference_number, paid_on,
        receipt_file_id, receipt_sha256, paid_to_name, paid_to_number, paid_to_bank,
        recorded_by)
     VALUES (:id, :commissionId, :kind, :method, 'submitted', :amount, :reference,
             TO_DATE(:paidOn, 'YYYY-MM-DD'), :receiptFileId, :receiptSha256, :paidToName,
             :paidToNumber, :paidToBank, :recordedBy)`,
    {
      id: uuidToBuf(input.id),
      commissionId: uuidToBuf(input.commissionId),
      kind: input.kind,
      method: input.method,
      amount: input.amountCentavos,
      reference: input.referenceNumber,
      paidOn: input.paidOn,
      receiptFileId: uuidToBuf(input.receiptFileId),
      receiptSha256: input.receiptSha256,
      paidToName: input.paidToName,
      paidToNumber: input.paidToNumber,
      paidToBank: input.paidToBank,
      recordedBy: uuidToBuf(input.recordedBy),
    },
  );
}

/** Cash or COD balance, recorded as received by the person who received it. */
export async function insertInPersonBalance(
  input: {
    id: string;
    commissionId: string;
    method: "cod" | "cash";
    amountCentavos: number;
    recordedBy: string;
  },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO commission_payments
       (id, commission_id, kind, method, status, amount_centavos, recorded_by, decided_at)
     VALUES (:id, :commissionId, 'balance', :method, 'confirmed', :amount, :recordedBy,
             SYSTIMESTAMP)`,
    {
      id: uuidToBuf(input.id),
      commissionId: uuidToBuf(input.commissionId),
      method: input.method,
      amount: input.amountCentavos,
      recordedBy: uuidToBuf(input.recordedBy),
    },
  );
}

/**
 * Confirms or rejects a payment that is still awaiting a decision. Returns the
 * number of rows changed, so a second, racing decision changes nothing.
 */
export async function decidePayment(
  paymentId: string,
  status: "confirmed" | "rejected",
  tx: Queryable,
): Promise<number> {
  return tx.run(
    `UPDATE commission_payments SET status = :status, decided_at = SYSTIMESTAMP
      WHERE id = :id AND status = 'submitted'`,
    { id: uuidToBuf(paymentId), status },
  );
}

// --- Problems ---------------------------------------------------------------

export interface ProblemRecord {
  id: string;
  commissionId: string;
  openedBy: string;
  reason: ProblemReason;
  details: string;
  status: ProblemStatus;
  resolution: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

interface ProblemRow {
  id: Buffer;
  commissionId: Buffer;
  openedBy: Buffer;
  reason: ProblemReason;
  details: string;
  status: ProblemStatus;
  resolution: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

function toProblem(row: ProblemRow): ProblemRecord {
  return {
    id: bufToUuid(row.id)!,
    commissionId: bufToUuid(row.commissionId)!,
    openedBy: bufToUuid(row.openedBy)!,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

const PROBLEM_SELECT = `
  SELECT id, commission_id, opened_by, reason, details, status, resolution, created_at, closed_at
    FROM commission_problems`;

export async function insertProblem(
  input: { id: string; commissionId: string; openedBy: string; reason: ProblemReason; details: string },
  tx: Queryable,
): Promise<void> {
  await tx.run(
    `INSERT INTO commission_problems (id, commission_id, opened_by, reason, details)
     VALUES (:id, :commissionId, :openedBy, :reason, :details)`,
    {
      id: uuidToBuf(input.id),
      commissionId: uuidToBuf(input.commissionId),
      openedBy: uuidToBuf(input.openedBy),
      reason: input.reason,
      details: input.details,
    },
  );
}

export async function listProblems(
  commissionId: string,
  q: Queryable = db,
): Promise<ProblemRecord[]> {
  const rows = await q.many<ProblemRow>(
    `${PROBLEM_SELECT} WHERE commission_id = :id ORDER BY created_at DESC`,
    { id: uuidToBuf(commissionId) },
  );
  return rows.map(toProblem);
}

export async function findProblem(
  problemId: string,
  q: Queryable = db,
): Promise<ProblemRecord | null> {
  const row = await q.one<ProblemRow>(`${PROBLEM_SELECT} WHERE id = :id`, {
    id: uuidToBuf(problemId),
  });
  return row ? toProblem(row) : null;
}

/** Closes an open problem. Returns rows changed; zero if it was already closed. */
export async function closeProblem(
  problemId: string,
  status: "withdrawn" | "resolved",
  resolution: string | null,
  tx: Queryable,
): Promise<number> {
  return tx.run(
    `UPDATE commission_problems
        SET status = :status, resolution = :resolution, closed_at = SYSTIMESTAMP
      WHERE id = :id AND status = 'open'`,
    { id: uuidToBuf(problemId), status, resolution },
  );
}

export interface OpenProblemSummary extends ProblemRecord {
  postingTitle: string;
  clientUsername: string;
  clientEmail: string;
  artistUsername: string;
  artistEmail: string;
  openedByUsername: string;
}

/** For the owner's command-line tool. Includes contact emails; never served over HTTP. */
export async function listOpenProblemsWithContacts(q: Queryable = db): Promise<OpenProblemSummary[]> {
  const rows = await q.many<
    ProblemRow & {
      postingTitle: string;
      clientUsername: string;
      clientEmail: string;
      artistUsername: string;
      artistEmail: string;
      openedByUsername: string;
    }
  >(
    `SELECT pr.id, pr.commission_id, pr.opened_by, pr.reason, pr.details, pr.status,
            pr.resolution, pr.created_at, pr.closed_at,
            p.title AS posting_title,
            cl.username AS client_username, cl.email AS client_email,
            ar.username AS artist_username, ar.email AS artist_email,
            op.username AS opened_by_username
       FROM commission_problems pr
       JOIN commissions cm ON cm.id = pr.commission_id
       JOIN postings p ON p.id = cm.posting_id
       JOIN users cl ON cl.id = cm.client_id
       JOIN users ar ON ar.id = cm.artist_id
       JOIN users op ON op.id = pr.opened_by
      WHERE pr.status = 'open'
      ORDER BY pr.created_at`,
  );
  return rows.map((row) => ({
    ...toProblem(row),
    postingTitle: row.postingTitle,
    clientUsername: row.clientUsername,
    clientEmail: row.clientEmail,
    artistUsername: row.artistUsername,
    artistEmail: row.artistEmail,
    openedByUsername: row.openedByUsername,
  }));
}
