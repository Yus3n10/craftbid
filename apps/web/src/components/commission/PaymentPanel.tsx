import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUnsavedChanges } from "../../lib/unsavedChanges.js";
import {
  LIMITS,
  PROBLEM_REASONS,
  type BalanceMethod,
  type CommissionDto,
  type CommissionPaymentDto,
  type PaymentKind,
  type PaymentTrackingDto,
  type PayoutAccountDto,
  type ProblemReason,
  type TransferMethod,
  formatPeso,
} from "@craftbid/shared";
import { ApiError, api, uploadCommissionFile } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { Button } from "../ui/Button.js";
import { Field, Select, TextArea, TextInput } from "../ui/Field.js";
import { Card, ThreadRule } from "../ui/Primitives.js";
import { FormError } from "../ui/States.js";
import { PrivateImage } from "./PrivateImage.js";

/**
 * The payment record on a commission: a down payment to start, the balance
 * before handover, each confirmed by the artist who received it.
 *
 * The wording is written for someone who has never used a marketplace like
 * this. Each person sees only the step that is theirs to take, and what the
 * other person is waiting on.
 */

const METHOD_LABEL: Record<string, string> = {
  gcash: "GCash",
  maya: "Maya",
  bank: "Bank transfer",
  cod: "Cash on delivery",
  cash: "Cash (meet-up)",
};

const BALANCE_OPTIONS: { value: BalanceMethod; title: string; detail: string }[] = [
  {
    value: "transfer",
    title: "Pay after seeing photos",
    detail: "The artist shows you the finished piece, you send the rest, then they ship it.",
  },
  {
    value: "cod",
    title: "Cash on delivery",
    detail: "Pay the rest to the courier when your parcel arrives.",
  },
  {
    value: "meetup",
    title: "Meet-up",
    detail: "Pay the rest in cash when you meet the artist.",
  },
];

const REASON_LABEL: Record<ProblemReason, string> = {
  payment_not_received: "A payment did not arrive",
  work_not_delivered: "The piece was not delivered",
  not_as_agreed: "It is not what we agreed",
  stopped_responding: "The other person stopped responding",
  other: "Something else",
};

const STEPS = [
  { key: "down", label: "Down payment" },
  { key: "making", label: "Making the piece" },
  { key: "balance", label: "Balance" },
  { key: "done", label: "Complete" },
] as const;

function stepIndex(tracking: PaymentTrackingDto, status: CommissionDto["status"]): number {
  if (status === "completed") return 4;
  switch (tracking.stage) {
    case "awaiting_down_payment":
    case "down_payment_submitted":
      return 0;
    case "in_progress":
      return 1;
    case "awaiting_balance":
    case "balance_submitted":
      return 2;
    default:
      return 3;
  }
}

function useRefresh(commissionId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["commission", commissionId] });
    void queryClient.invalidateQueries({ queryKey: ["commissions"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
}

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" });
}

function Progress({ tracking, status }: { tracking: PaymentTrackingDto; status: CommissionDto["status"] }) {
  const current = stepIndex(tracking, status);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Commission progress">
      {STEPS.map((step, index) => {
        const done = index < current;
        const here = index === current;
        return (
          <li key={step.key} className="min-w-0" aria-current={here ? "step" : undefined}>
            <div
              className={cx(
                "h-1.5 rounded-full",
                done ? "bg-sage" : here ? "bg-indigo" : "bg-fiber",
              )}
            />
            <span
              className={cx(
                "mt-1.5 block text-xs leading-tight",
                here ? "font-semibold text-ink" : done ? "text-sage" : "text-ink-faint",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PayToList({ accounts }: { accounts: PayoutAccountDto[] }) {
  return (
    <ul className="space-y-2">
      {accounts.map((account) => (
        <li key={account.method} className="rounded-md border border-fiber bg-paper-sunk px-3 py-2.5 text-sm">
          <span className="eyebrow block">{METHOD_LABEL[account.method]}</span>
          <span className="block font-medium text-ink">{account.accountName}</span>
          {account.bankName && <span className="block text-ink-soft">{account.bankName}</span>}
          <span className="tabular block text-base font-semibold tracking-wide text-ink">
            {account.accountNumber}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The client records a transfer: method, reference number, date and receipt. */
function TransferForm({
  commissionId,
  kind,
  amountCentavos,
  accounts,
}: {
  commissionId: string;
  kind: PaymentKind;
  amountCentavos: number;
  accounts: PayoutAccountDto[];
}) {
  const refresh = useRefresh(commissionId);
  const [method, setMethod] = useState<TransferMethod>(accounts[0]!.method);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [receipt, setReceipt] = useState<{ id: string; preview: string } | null>(null);
  useUnsavedChanges(referenceNumber.trim() !== "" || receipt !== null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  useEffect(() => () => {
    if (receipt) URL.revokeObjectURL(receipt.preview);
  }, [receipt]);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/commissions/${commissionId}/payments`, {
        kind,
        method,
        amountCentavos,
        referenceNumber,
        paidOn,
        receiptFileId: receipt?.id,
      }),
    onSuccess: refresh,
  });

  const fields = submit.error instanceof ApiError ? submit.error.fields : {};

  async function chooseReceipt(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const stored = await uploadCommissionFile(commissionId, file);
      setReceipt({ id: stored.id, preview: URL.createObjectURL(file) });
    } catch (error) {
      setUploadError(error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <FormError error={submit.error} />

      <div className="rounded-md bg-indigo-wash px-3 py-2.5 text-sm text-indigo">
        Send exactly <strong className="tabular">{formatPeso(amountCentavos)}</strong>, then fill
        this in from your receipt.
      </div>

      <Field label="How did you pay?" error={fields.method} required>
        {({ id }) => (
          <Select id={id} value={method} onChange={(event) => setMethod(event.target.value as TransferMethod)}>
            {accounts.map((account) => (
              <option key={account.method} value={account.method}>
                {METHOD_LABEL[account.method]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Reference number"
        hint="Printed on your receipt, usually labelled Ref. No."
        error={fields.referenceNumber}
        required
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            inputMode="text"
            autoComplete="off"
            aria-describedby={describedBy}
            invalid={invalid}
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            maxLength={LIMITS.referenceNumber.max + 10}
          />
        )}
      </Field>

      <Field label="Date you sent it" error={fields.paidOn} required>
        {({ id, invalid }) => (
          <TextInput id={id} type="date" invalid={invalid} value={paidOn} max={today()} onChange={(event) => setPaidOn(event.target.value)} />
        )}
      </Field>

      <Field
        label="Receipt"
        hint="A screenshot of your receipt. Only you and the artist can see it."
        error={fields.receiptFileId}
        required
      >
        {({ id, describedBy }) => (
          <div className="space-y-3">
            {receipt && (
              <img src={receipt.preview} alt="Your receipt" className="max-h-64 rounded-md border border-fiber object-contain" />
            )}
            <input
              id={id}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby={describedBy}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border file:border-fiber-strong file:bg-paper-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
              onChange={(event) => void chooseReceipt(event.target.files?.[0])}
              disabled={uploading}
            />
            {uploading && <p className="text-sm text-ink-faint">Uploading your receipt…</p>}
            <FormError error={uploadError} />
          </div>
        )}
      </Field>

      <Button
        type="submit"
        className="w-full"
        loading={submit.isPending}
        disabled={!receipt || uploading || referenceNumber.trim().length === 0}
      >
        Send payment details
      </Button>
    </form>
  );
}

/** The artist decides on a payment the client recorded. */
function DecisionCard({ commissionId, payment }: { commissionId: string; payment: CommissionPaymentDto }) {
  const refresh = useRefresh(commissionId);
  const decide = useMutation({
    mutationFn: (decision: "confirm" | "reject") =>
      api.post(`/commissions/${commissionId}/payments/${payment.id}/${decision}`),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink">
        The client says they sent{" "}
        <strong className="tabular">{formatPeso(payment.amountCentavos)}</strong> by{" "}
        {METHOD_LABEL[payment.method]}.
      </p>
      <div className="rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-sm text-amber">
        <strong className="block">Check before you confirm</strong>
        Open your {METHOD_LABEL[payment.method]} {payment.method === "bank" ? "account" : "app"} and look for
        reference <strong className="tabular">{payment.referenceNumber}</strong> for{" "}
        {formatPeso(payment.amountCentavos)}. A screenshot can be edited, but your own history cannot.
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-faint">Reference</dt>
        <dd className="tabular font-medium">{payment.referenceNumber}</dd>
        <dt className="text-ink-faint">Date sent</dt>
        <dd className="font-medium">{payment.paidOn}</dd>
        {payment.paidTo && (
          <>
            <dt className="text-ink-faint">Sent to</dt>
            <dd className="tabular font-medium">{payment.paidTo.accountNumber}</dd>
          </>
        )}
      </dl>
      {payment.receiptFileId && (
        <PrivateImage path={`/commissions/${commissionId}/files/${payment.receiptFileId}`} alt="The client's receipt" className="h-56 w-full" />
      )}
      <FormError error={decide.error} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="sm:flex-1" loading={decide.isPending && decide.variables === "confirm"} onClick={() => decide.mutate("confirm")}>
          Yes, I received it
        </Button>
        <Button variant="secondary" className="sm:flex-1" loading={decide.isPending && decide.variables === "reject"} onClick={() => decide.mutate("reject")}>
          It has not arrived
        </Button>
      </div>
    </div>
  );
}

/**
 * How the client will pay the second half.
 *
 * Choosing used to save on the click with nothing to say it had, so it looked
 * as if the choice went nowhere. Now a choice is a draft until Save changes,
 * which appears only when the draft differs from what is saved, and saving
 * says so and tells the artist.
 */
function BalanceMethodPicker({ commissionId, current }: { commissionId: string; current: BalanceMethod }) {
  const refresh = useRefresh(commissionId);
  const [selected, setSelected] = useState<BalanceMethod>(current);
  const dirty = selected !== current;
  useUnsavedChanges(dirty);

  const choose = useMutation({
    mutationFn: (method: BalanceMethod) => api.put(`/commissions/${commissionId}/balance-method`, { method }),
    onSuccess: refresh,
  });

  // A save that lands, or a change made elsewhere, becomes the new baseline.
  useEffect(() => {
    setSelected(current);
  }, [current]);

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-ink">How will you pay the other half?</legend>
      {BALANCE_OPTIONS.map((option) => (
        <label
          key={option.value}
          className={cx(
            "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 text-sm",
            selected === option.value ? "border-indigo bg-indigo-wash" : "border-fiber bg-paper-raised",
          )}
        >
          <input
            type="radio"
            name="balance-method"
            className="mt-1"
            checked={selected === option.value}
            disabled={choose.isPending}
            onChange={() => {
              choose.reset();
              setSelected(option.value);
            }}
          />
          <span>
            <span className="block font-medium text-ink">{option.title}</span>
            <span className="block text-ink-soft">{option.detail}</span>
          </span>
        </label>
      ))}
      <FormError error={choose.error} />
      <div className="flex min-h-9 flex-wrap items-center gap-3 pt-1" aria-live="polite">
        {dirty && (
          <Button type="button" size="sm" loading={choose.isPending} onClick={() => choose.mutate(selected)}>
            Save changes
          </Button>
        )}
        {!dirty && choose.isSuccess && (
          <span className="text-sm text-sage">Saved. The artist has been notified.</span>
        )}
      </div>
    </fieldset>
  );
}

function FinishForm({ commissionId }: { commissionId: string }) {
  const refresh = useRefresh(commissionId);
  const [photos, setPhotos] = useState<{ id: string; preview: string }[]>([]);
  useUnsavedChanges(photos.length > 0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  const finish = useMutation({
    mutationFn: () => api.post(`/commissions/${commissionId}/finished`, { photoFileIds: photos.map((photo) => photo.id) }),
    onSuccess: refresh,
  });

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setUploadError(null);
    setUploading(true);
    try {
      const room = LIMITS.finishedPhotos.max - photos.length;
      const added: { id: string; preview: string }[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const stored = await uploadCommissionFile(commissionId, file);
        added.push({ id: stored.id, preview: URL.createObjectURL(file) });
      }
      setPhotos((current) => [...current, ...added]);
    } catch (error) {
      setUploadError(error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink">
        When the piece is done, add photos so the client can see it before paying the rest. Only
        the two of you can see them.
      </p>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <img key={photo.id} src={photo.preview} alt="Finished piece" className="aspect-square w-full rounded-md border border-fiber object-cover" />
          ))}
        </div>
      )}
      {photos.length < LIMITS.finishedPhotos.max && (
        <label className="block">
          <span className="sr-only">Add photos of the finished piece</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading}
            onChange={(event) => void addPhotos(event.target.files)}
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border file:border-fiber-strong file:bg-paper-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
          />
        </label>
      )}
      {uploading && <p className="text-sm text-ink-faint">Uploading…</p>}
      <FormError error={uploadError} />
      <FormError error={finish.error} />
      <Button className="w-full" disabled={photos.length === 0 || uploading} loading={finish.isPending} onClick={() => finish.mutate()}>
        The piece is finished
      </Button>
    </div>
  );
}

function ShippingForm({ commissionId, cod }: { commissionId: string; cod: boolean }) {
  const refresh = useRefresh(commissionId);
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  useUnsavedChanges(courier.trim() !== "" || trackingNumber.trim() !== "");
  const ship = useMutation({
    mutationFn: () => api.put(`/commissions/${commissionId}/shipping`, { courier, trackingNumber }),
    onSuccess: refresh,
  });
  const fields = ship.error instanceof ApiError ? ship.error.fields : {};

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        ship.mutate();
      }}
    >
      <p className="text-sm text-ink">
        {cod
          ? "Send it cash on delivery, then add the courier and tracking number so the client can follow it."
          : "Ship it now, then add the courier and tracking number so the client can follow it."}
      </p>
      <FormError error={ship.error} />
      <Field label="Courier" error={fields.courier} required>
        {({ id, invalid }) => (
          <TextInput id={id} invalid={invalid} placeholder="J&T Express, LBC, Flash…" value={courier} onChange={(event) => setCourier(event.target.value)} />
        )}
      </Field>
      <Field label="Tracking number" hint="Optional, but it saves a lot of messages." error={fields.trackingNumber}>
        {({ id, describedBy }) => (
          <TextInput id={id} aria-describedby={describedBy} value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
        )}
      </Field>
      <Button type="submit" variant="secondary" className="w-full" loading={ship.isPending}>
        It has been sent
      </Button>
    </form>
  );
}

function ReportProblem({ commissionId }: { commissionId: string }) {
  const refresh = useRefresh(commissionId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ProblemReason>("payment_not_received");
  const [details, setDetails] = useState("");
  useUnsavedChanges(open && details.trim() !== "");
  const report = useMutation({
    mutationFn: () => api.post(`/commissions/${commissionId}/problems`, { reason, details }),
    onSuccess: () => {
      setOpen(false);
      refresh();
    },
  });
  const fields = report.error instanceof ApiError ? report.error.fields : {};

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-rust hover:underline">
        Report a problem
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-md border border-rust/30 bg-rust-wash p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        report.mutate();
      }}
    >
      <h3 className="font-display text-lg text-ink">Report a problem</h3>
      <p className="text-sm text-ink-soft">
        Reporting pauses this commission until it is sorted out. Craftbid will look into it with
        you both.
      </p>
      <FormError error={report.error} />
      <Field label="What is wrong?" required>
        {({ id }) => (
          <Select id={id} value={reason} onChange={(event) => setReason(event.target.value as ProblemReason)}>
            {PROBLEM_REASONS.map((value) => (
              <option key={value} value={value}>
                {REASON_LABEL[value]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="What happened?" error={fields.details} required>
        {({ id, invalid }) => (
          <TextArea id={id} invalid={invalid} rows={4} value={details} maxLength={LIMITS.problemDetails.max} onChange={(event) => setDetails(event.target.value)} />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={report.isPending}>
          Report it
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
    </form>
  );
}

function WaitingNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-paper-sunk px-3 py-2.5 text-sm text-ink-soft">{children}</p>;
}

/** The step that is this person's to take right now, or what they are waiting on. */
function CurrentStep({ commission, isClient }: { commission: CommissionDto; isClient: boolean }) {
  const tracking = commission.paymentTracking!;
  const refresh = useRefresh(commission.id);
  const complete = useMutation({
    mutationFn: () => api.post(`/commissions/${commission.id}/complete`),
    onSuccess: refresh,
  });
  const received = useMutation({
    mutationFn: () => api.post(`/commissions/${commission.id}/balance-received`),
    onSuccess: refresh,
  });

  const down = formatPeso(tracking.downPaymentCentavos);
  const balance = formatPeso(tracking.balanceCentavos);
  const pending = tracking.payments.find((payment) => payment.status === "submitted");
  const lastRejected = tracking.payments[0]?.status === "rejected" ? tracking.payments[0] : undefined;

  const rejectedNotice = isClient && lastRejected && (
    <div className="rounded-md border border-rust/30 bg-rust-wash px-3 py-2.5 text-sm text-rust">
      The artist says your last payment did not arrive. Check the amount and reference number with
      your receipt and send the details again, or report a problem.
    </div>
  );

  switch (tracking.stage) {
    case "awaiting_down_payment":
      if (!isClient) {
        return (
          <div className="space-y-3">
            <WaitingNote>Waiting for the client to send the down payment of {down}.</WaitingNote>
            <p className="text-sm text-ink-soft">
              {/* Starts as "after photos" until the client picks, so this
                  names the current option rather than claiming a choice. */}
              How the balance will be paid:{" "}
              <strong className="text-ink">
                {BALANCE_OPTIONS.find((option) => option.value === tracking.balanceMethod)?.title}
              </strong>
              . The client can change this until you confirm the down payment, and you will be notified if they do.
            </p>
            {tracking.payTo.length === 0 && (
              <p className="text-sm text-rust">
                The client cannot pay you yet.{" "}
                <Link to="/settings" className="font-medium underline">
                  Add your GCash, Maya or bank details
                </Link>
                .
              </p>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-5">
          {rejectedNotice}
          <p className="text-sm text-ink">
            Send a down payment of <strong className="tabular">{down}</strong> to start the work.
            The artist starts once they confirm it arrived.
          </p>
          <BalanceMethodPicker commissionId={commission.id} current={tracking.balanceMethod} />
          {tracking.payTo.length === 0 ? (
            <WaitingNote>
              The artist has not added payment details yet. Message them, or check back soon.
            </WaitingNote>
          ) : (
            <>
              <div>
                <span className="mb-2 block text-sm font-medium text-ink">Pay the artist here</span>
                <PayToList accounts={tracking.payTo} />
              </div>
              <TransferForm commissionId={commission.id} kind="down" amountCentavos={tracking.downPaymentCentavos} accounts={tracking.payTo} />
            </>
          )}
        </div>
      );

    case "down_payment_submitted":
    case "balance_submitted":
      return isClient ? (
        <WaitingNote>
          Waiting for the artist to confirm your {tracking.stage === "down_payment_submitted" ? "down payment" : "balance"} arrived.
        </WaitingNote>
      ) : (
        pending && <DecisionCard commissionId={commission.id} payment={pending} />
      );

    case "in_progress":
      return isClient ? (
        <WaitingNote>The artist is making your piece. You will see photos here when it is finished.</WaitingNote>
      ) : (
        <FinishForm commissionId={commission.id} />
      );

    case "awaiting_balance":
      if (tracking.balanceMethod === "transfer") {
        return isClient ? (
          <div className="space-y-5">
            {rejectedNotice}
            <p className="text-sm text-ink">
              Your piece is finished. Send the balance of <strong className="tabular">{balance}</strong>,
              and the artist ships it once they confirm.
            </p>
            <PayToList accounts={tracking.payTo} />
            {tracking.payTo.length > 0 && (
              <TransferForm commissionId={commission.id} kind="balance" amountCentavos={tracking.balanceCentavos} accounts={tracking.payTo} />
            )}
          </div>
        ) : (
          <WaitingNote>
            Waiting for the client to send the balance of {balance}. Do not ship until you have
            confirmed it.
          </WaitingNote>
        );
      }
      if (isClient) {
        return (
          <WaitingNote>
            {tracking.balanceMethod === "cod"
              ? `Your piece will come cash on delivery. Pay ${balance} to the courier when it arrives.`
              : `Pay the balance of ${balance} in cash when you meet the artist.`}
          </WaitingNote>
        );
      }
      return (
        <div className="space-y-5">
          {tracking.balanceMethod === "cod" && !tracking.shipping && <ShippingForm commissionId={commission.id} cod />}
          <div className="space-y-2">
            <p className="text-sm text-ink">
              {tracking.balanceMethod === "cod"
                ? `When the courier sends you the ${balance}, record it here.`
                : `When the client pays you the ${balance} in cash, record it here.`}
            </p>
            <FormError error={received.error} />
            <Button variant="secondary" className="w-full" loading={received.isPending} onClick={() => received.mutate()}>
              I received the balance
            </Button>
          </div>
        </div>
      );

    case "ready_to_complete":
      if (isClient) {
        const waitingToShip = tracking.balanceMethod === "transfer" && !tracking.shipping;
        return (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {waitingToShip
                ? "The balance is confirmed and the artist will ship your piece. Once you have it, mark this complete."
                : "Once you have the piece, mark this complete. You can then both leave a review."}
            </p>
            <FormError error={complete.error} />
            <Button className="w-full" loading={complete.isPending} onClick={() => complete.mutate()}>
              I received the piece
            </Button>
          </div>
        );
      }
      return tracking.balanceMethod === "transfer" && !tracking.shipping ? (
        <ShippingForm commissionId={commission.id} cod={false} />
      ) : (
        <WaitingNote>Waiting for the client to confirm they received the piece.</WaitingNote>
      );
  }
}

function History({ commission }: { commission: CommissionDto }) {
  const tracking = commission.paymentTracking!;
  if (tracking.payments.length === 0) return null;
  const statusText: Record<string, string> = {
    submitted: "Waiting for the artist",
    confirmed: "Received",
    rejected: "Did not arrive",
  };

  return (
    <section>
      <h3 className="font-display text-lg">Payments</h3>
      <ul className="mt-3 space-y-2">
        {tracking.payments.map((payment) => (
          <li key={payment.id} className="flex gap-3 rounded-md border border-fiber bg-paper-raised p-3 text-sm">
            {payment.receiptFileId && (
              <PrivateImage path={`/commissions/${commission.id}/files/${payment.receiptFileId}`} alt="Receipt" className="h-16 w-12 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">
                  {payment.kind === "down" ? "Down payment" : "Balance"} · {METHOD_LABEL[payment.method]}
                </span>
                <span className="tabular font-semibold text-ink">{formatPeso(payment.amountCentavos)}</span>
              </div>
              <span
                className={cx(
                  "text-xs font-semibold",
                  payment.status === "confirmed" ? "text-sage" : payment.status === "rejected" ? "text-rust" : "text-amber",
                )}
              >
                {statusText[payment.status]}
              </span>
              {payment.referenceNumber && (
                <span className="tabular block truncate text-xs text-ink-faint">Ref. {payment.referenceNumber}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProblemBanner({ commission }: { commission: CommissionDto }) {
  const tracking = commission.paymentTracking!;
  const problem = tracking.openProblem!;
  const refresh = useRefresh(commission.id);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/commissions/${commission.id}/problems/${problem.id}/withdraw`),
    onSuccess: refresh,
  });
  const who = problem.openedByViewer ? "You" : problem.openedBy === "client" ? "The client" : "The artist";

  return (
    <div role="status" className="space-y-2 rounded-md border border-rust/40 bg-rust-wash p-4 text-sm">
      <strong className="block text-rust">This commission is paused</strong>
      <p className="text-ink">
        {who} reported a problem on {formatDate(problem.createdAt)}: {REASON_LABEL[problem.reason].toLowerCase()}.
        Nothing can move forward until it is sorted out.
      </p>
      <p className="whitespace-pre-wrap text-ink-soft">“{problem.details}”</p>
      {problem.openedByViewer && (
        <>
          <FormError error={withdraw.error} />
          <Button size="sm" variant="secondary" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            It is sorted, withdraw my report
          </Button>
        </>
      )}
    </div>
  );
}

export function PaymentPanel({ commission, isClient }: { commission: CommissionDto; isClient: boolean }) {
  const tracking = commission.paymentTracking!;
  const active = commission.status === "active";

  return (
    <Card className="p-5">
      <div className="space-y-6 pl-3">
        <div>
          <h2 className="font-display text-xl">Payment and progress</h2>
          <ThreadRule className="mt-3 w-14" />
        </div>

        <Progress tracking={tracking} status={commission.status} />

        {active && tracking.openProblem && <ProblemBanner commission={commission} />}
        {active && !tracking.openProblem && <CurrentStep commission={commission} isClient={isClient} />}

        {tracking.finishedPhotoIds.length > 0 && (
          <section>
            <h3 className="font-display text-lg">The finished piece</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tracking.finishedPhotoIds.map((fileId) => (
                <PrivateImage key={fileId} path={`/commissions/${commission.id}/files/${fileId}`} alt="Photo of the finished piece" className="aspect-square w-full" />
              ))}
            </div>
          </section>
        )}

        {tracking.shipping && (
          <p className="text-sm text-ink">
            Sent with <strong>{tracking.shipping.courier}</strong>
            {tracking.shipping.trackingNumber && (
              <>
                , tracking number <strong className="tabular">{tracking.shipping.trackingNumber}</strong>
              </>
            )}
            .
          </p>
        )}

        <History commission={commission} />

        <details className="rounded-md border border-fiber bg-paper-sunk px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink">How payment works on Craftbid</summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-soft">
            <li>You pay the artist directly. Craftbid does not hold the money and cannot refund it.</li>
            <li>Half is paid first to start the work. The artist confirms when it arrives.</li>
            <li>Once the artist confirms the down payment and starts, it cannot be refunded.</li>
            <li>The other half is paid before the piece is shipped, by cash on delivery, or in person.</li>
            <li>If something goes wrong, report a problem and the commission pauses until it is sorted out.</li>
          </ul>
        </details>

        {active && !tracking.openProblem && <ReportProblem commissionId={commission.id} />}
      </div>
    </Card>
  );
}
