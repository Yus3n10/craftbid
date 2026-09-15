import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminPaymentDto } from "@craftbid/shared";
import { loadPrivateUrl } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { Button } from "../ui/Button.js";
import { Money } from "../ui/Primitives.js";
import { PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, when } from "./adminCopy.js";

const STATE_STYLE: Record<string, string> = {
  submitted: "bg-amber-wash text-amber",
  confirmed: "bg-sage-wash text-sage",
  rejected: "bg-rust-wash text-rust",
};

/**
 * A receipt, loaded only when staff ask for it. Opening one is recorded on the
 * server, so it is never fetched just because a row scrolled into view.
 */
function Receipt({ paymentId, reference }: { paymentId: string; reference: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    loadPrivateUrl(`/admin/payments/${paymentId}/receipt`)
      .then((value) => {
        created = value;
        if (active) setUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [paymentId]);

  if (failed) return <p className="text-sm text-rust">The receipt could not be loaded.</p>;
  if (!url) return <div className="h-40 w-32 animate-pulse rounded-md bg-paper-sunk" aria-label="Loading receipt" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block">
      <img src={url} alt={`Receipt for ${reference}`} className="max-h-96 max-w-full rounded-md border border-fiber bg-paper-sunk object-contain" />
    </a>
  );
}

/**
 * One payment record as staff see it: who paid whom, who recorded it, what the
 * receiving side decided, and the receipt behind it on request.
 */
export function PaymentRecordRow({ payment, showRequest = true }: { payment: AdminPaymentDto; showRequest?: boolean }) {
  const headingId = useId();
  const [showReceipt, setShowReceipt] = useState(false);
  const reference = payment.referenceNumber ?? "no reference";

  return (
    <article aria-labelledby={headingId} className="space-y-2 rounded-md border border-fiber bg-paper px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={headingId} className="break-words font-medium text-ink">
            {PAYMENT_KIND_LABEL[payment.kind]} by {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}
            {payment.referenceNumber ? ` · Ref ${payment.referenceNumber}` : ""}
          </h4>
          {showRequest && <p className="break-words text-xs text-ink-faint">{payment.postingTitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("rounded-sm px-2 py-0.5 text-xs font-medium", STATE_STYLE[payment.status])}>
            {PAYMENT_STATUS_LABEL[payment.status]}
          </span>
          {payment.replaced && <span className="rounded-sm bg-paper-sunk px-2 py-0.5 text-xs font-medium text-ink-soft">Replaced</span>}
        </div>
      </div>

      <Money centavos={payment.amountCentavos} size="sm" />

      <p className="text-ink-soft">
        Client{" "}
        <Link className="text-indigo hover:underline" to={`/admin/users/${payment.client.id}`}>
          @{payment.client.username}
        </Link>{" "}
        paying artist{" "}
        <Link className="text-indigo hover:underline" to={`/admin/users/${payment.artist.id}`}>
          @{payment.artist.username}
        </Link>
      </p>
      <p className="text-xs text-ink-faint">
        Recorded by @{payment.recordedBy.username} · {when(payment.submittedAt)}
        {payment.paidOn ? ` · paid on ${payment.paidOn}` : ""}
        {payment.decidedAt ? ` · ${payment.status === "confirmed" ? "confirmed" : "decided"} ${when(payment.decidedAt)}` : ""}
      </p>
      {payment.paidTo && (
        <p className="break-words text-xs text-ink-faint">
          Sent to {payment.paidTo.name}, {payment.paidTo.number}
          {payment.paidTo.bank ? `, ${payment.paidTo.bank}` : ""}
        </p>
      )}

      {payment.hasReceipt ? (
        showReceipt ? (
          <Receipt paymentId={payment.id} reference={reference} />
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowReceipt(true)}>
            View receipt
          </Button>
        )
      ) : (
        <p className="text-xs text-ink-faint">No receipt: paid in person.</p>
      )}
    </article>
  );
}
