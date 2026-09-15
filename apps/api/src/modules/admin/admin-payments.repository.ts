import type {
  AdminPaymentDto,
  AdminPaymentsQuery,
  AdminProblemDto,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  ProblemReason,
  ProblemStatus,
} from "@craftbid/shared";
import { bufToUuid, uuidToBuf } from "../../db/ids.js";
import { db, type BindValue } from "../../db/query.js";

/**
 * Read queries for commission problems and payment records on the admin
 * screen. Kept apart from the rest of the admin queries because they join the
 * payment tables, which the rest of the admin screen never touches.
 */

interface PaymentRow {
  id: Buffer;
  commissionId: Buffer;
  postingTitle: string;
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
  submittedAt: Date;
  decidedAt: Date | null;
  clientId: Buffer;
  clientUsername: string;
  artistId: Buffer;
  artistUsername: string;
  recorderId: Buffer;
  recorderUsername: string;
  replaced: number;
}

const PAYMENT_SELECT = `
  SELECT cp.id, cp.commission_id, p.title AS posting_title, cp.kind, cp.method, cp.status,
         cp.amount_centavos, cp.reference_number, TO_CHAR(cp.paid_on, 'YYYY-MM-DD') AS paid_on,
         cp.receipt_file_id, cp.paid_to_name, cp.paid_to_number, cp.paid_to_bank,
         cp.submitted_at, cp.decided_at,
         cl.id AS client_id, cl.username AS client_username,
         ar.id AS artist_id, ar.username AS artist_username,
         rb.id AS recorder_id, rb.username AS recorder_username,
         CASE WHEN cp.status = 'rejected' AND EXISTS (
           SELECT 1 FROM commission_payments later
            WHERE later.commission_id = cp.commission_id
              AND later.kind = cp.kind
              AND later.submitted_at > cp.submitted_at
         ) THEN 1 ELSE 0 END AS replaced
    FROM commission_payments cp
    JOIN commissions cm ON cm.id = cp.commission_id
    JOIN postings p ON p.id = cm.posting_id
    JOIN users cl ON cl.id = cm.client_id
    JOIN users ar ON ar.id = cm.artist_id
    JOIN users rb ON rb.id = cp.recorded_by`;

function mapPayment(row: PaymentRow): AdminPaymentDto {
  return {
    id: bufToUuid(row.id)!,
    commissionId: bufToUuid(row.commissionId)!,
    postingTitle: row.postingTitle,
    kind: row.kind,
    method: row.method,
    status: row.status,
    replaced: row.replaced === 1,
    amountCentavos: Number(row.amountCentavos),
    referenceNumber: row.referenceNumber,
    paidOn: row.paidOn,
    hasReceipt: row.receiptFileId !== null,
    client: { id: bufToUuid(row.clientId)!, username: row.clientUsername },
    artist: { id: bufToUuid(row.artistId)!, username: row.artistUsername },
    recordedBy: { id: bufToUuid(row.recorderId)!, username: row.recorderUsername },
    paidTo:
      row.paidToName && row.paidToNumber
        ? { name: row.paidToName, number: row.paidToNumber, bank: row.paidToBank }
        : null,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

export async function listPayments(query: AdminPaymentsQuery): Promise<{ items: AdminPaymentDto[]; total: number }> {
  const where: string[] = [];
  const binds: Record<string, BindValue> = {};
  if (query.status) {
    where.push("cp.status = :status");
    binds.status = query.status;
  }
  if (query.q) {
    where.push("(LOWER(cl.username) LIKE :person OR LOWER(ar.username) LIKE :person OR cp.reference_number = :reference)");
    binds.person = `%${query.q.toLowerCase()}%`;
    binds.reference = query.q;
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const [countRow, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM (${PAYMENT_SELECT} ${whereClause})`, binds),
    db.many<PaymentRow>(
      `${PAYMENT_SELECT} ${whereClause}
        ORDER BY cp.submitted_at DESC, cp.id DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { ...binds, offset: query.offset, limit: query.limit },
    ),
  ]);
  return { items: rows.map(mapPayment), total: Number(countRow?.cnt ?? 0) };
}

async function paymentsForCommissions(commissionIds: string[]): Promise<Map<string, AdminPaymentDto[]>> {
  const result = new Map<string, AdminPaymentDto[]>();
  if (commissionIds.length === 0) return result;
  const binds: Record<string, BindValue> = {};
  const placeholders = commissionIds.map((id, index) => {
    binds[`c${index}`] = uuidToBuf(id);
    return `:c${index}`;
  });
  const rows = await db.many<PaymentRow>(
    `${PAYMENT_SELECT} WHERE cp.commission_id IN (${placeholders.join(", ")}) ORDER BY cp.submitted_at DESC, cp.id DESC`,
    binds,
  );
  for (const payment of rows.map(mapPayment)) {
    result.set(payment.commissionId, [...(result.get(payment.commissionId) ?? []), payment]);
  }
  return result;
}

interface ProblemRow {
  id: Buffer;
  commissionId: Buffer;
  postingTitle: string;
  reason: ProblemReason;
  details: string;
  status: ProblemStatus;
  resolution: string | null;
  createdAt: Date;
  closedAt: Date | null;
  openerId: Buffer;
  openerUsername: string;
  clientId: Buffer;
  clientUsername: string;
  clientEmail: string;
  artistId: Buffer;
  artistUsername: string;
  artistEmail: string;
}

export async function listProblems(
  status: "open" | "closed" | undefined,
  limit: number,
  offset: number,
): Promise<{ items: AdminProblemDto[]; total: number }> {
  const where = status === "open" ? "WHERE pr.status = 'open'" : status === "closed" ? "WHERE pr.status <> 'open'" : "";
  const from = `
    FROM commission_problems pr
    JOIN commissions cm ON cm.id = pr.commission_id
    JOIN postings p ON p.id = cm.posting_id
    JOIN users op ON op.id = pr.opened_by
    JOIN users cl ON cl.id = cm.client_id
    JOIN users ar ON ar.id = cm.artist_id
    ${where}`;

  const [countRow, rows] = await Promise.all([
    db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt ${from}`),
    db.many<ProblemRow>(
      `SELECT pr.id, pr.commission_id, p.title AS posting_title, pr.reason, pr.details, pr.status,
              pr.resolution, pr.created_at, pr.closed_at,
              op.id AS opener_id, op.username AS opener_username,
              cl.id AS client_id, cl.username AS client_username, cl.email AS client_email,
              ar.id AS artist_id, ar.username AS artist_username, ar.email AS artist_email
         ${from}
        ORDER BY pr.created_at DESC, pr.id DESC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
      { offset, limit },
    ),
  ]);

  const payments = await paymentsForCommissions([...new Set(rows.map((row) => bufToUuid(row.commissionId)!))]);
  return {
    total: Number(countRow?.cnt ?? 0),
    items: rows.map((row) => {
      const commissionId = bufToUuid(row.commissionId)!;
      return {
        id: bufToUuid(row.id)!,
        commissionId,
        postingTitle: row.postingTitle,
        reason: row.reason,
        details: row.details,
        status: row.status,
        resolution: row.resolution,
        createdAt: row.createdAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        openedBy: { id: bufToUuid(row.openerId)!, username: row.openerUsername },
        client: { id: bufToUuid(row.clientId)!, username: row.clientUsername, email: row.clientEmail },
        artist: { id: bufToUuid(row.artistId)!, username: row.artistUsername, email: row.artistEmail },
        payments: payments.get(commissionId) ?? [],
      };
    }),
  };
}

/** Where a payment's receipt is stored, and whose it is. Null when there is none. */
export async function receiptOf(
  paymentId: string,
): Promise<{ objectKey: string; contentType: string; clientId: string } | null> {
  const row = await db.one<{ objectKey: string; contentType: string; clientId: Buffer }>(
    `SELECT f.object_key, f.content_type, cm.client_id
       FROM commission_payments cp
       JOIN commission_files f ON f.id = cp.receipt_file_id
       JOIN commissions cm ON cm.id = cp.commission_id
      WHERE cp.id = :id`,
    { id: uuidToBuf(paymentId) },
  );
  return row ? { objectKey: row.objectKey, contentType: row.contentType, clientId: bufToUuid(row.clientId)! } : null;
}

export async function openProblemCount(): Promise<number> {
  const row = await db.one<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM commission_problems WHERE status = 'open'`);
  return Number(row?.cnt ?? 0);
}
