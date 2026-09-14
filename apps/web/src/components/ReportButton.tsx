import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ReportTargetType } from "@craftbid/shared";
import { ApiError, api } from "../lib/api.js";
import { useRequireAccount } from "../lib/authPrompt.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, TextArea } from "./ui/Field.js";
import { FormError } from "./ui/States.js";

const REASONS = [
  { value: "harassment", label: "Bullying or harassment" },
  { value: "inappropriate", label: "Sexual or inappropriate content" },
  { value: "scam", label: "A scam or fraud" },
  { value: "stolen_work", label: "It's stolen work" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
] as const;

const NOUN: Record<ReportTargetType, string> = {
  artist_post: "post",
  comment: "comment",
  posting: "request",
  user: "profile",
  application: "bid",
};

/**
 * Report something to Craftbid. A plain dialog: a reason, optional details,
 * and an answer that does not change whether it was the first report or not,
 * so nobody learns how many other people reported the same thing.
 */
export function ReportDialog({
  open,
  onClose,
  targetType,
  targetId,
}: {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const name = useId();

  const send = useMutation({
    mutationFn: () =>
      api.post("/reports", { targetType, targetId, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
  });
  const already = send.error instanceof ApiError && send.error.status === 409;
  const done = send.isSuccess || already;

  const close = () => {
    onClose();
    setReason("");
    setDetails("");
    send.reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Report this ${NOUN[targetType]}`}
      size="md"
      actions={
        done ? (
          <Button type="button" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="button" disabled={!reason} loading={send.isPending} onClick={() => send.mutate()}>
              Send report
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p>{already ? "You already reported this. Craftbid will review it." : "Thanks. Craftbid will review it."}</p>
      ) : (
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium text-ink">What is wrong with it?</legend>
            {REASONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2.5 text-sm text-ink-soft">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <Field label="Anything else? (optional)">
            {({ id }) => (
              <TextArea id={id} value={details} maxLength={1000} onChange={(event) => setDetails(event.target.value)} />
            )}
          </Field>
          {!already && <FormError error={send.error} />}
        </div>
      )}
    </Dialog>
  );
}

/** A "Report" button for a place with room for one, which opens the dialog. */
export function ReportButton({
  targetType,
  targetId,
  className,
}: {
  targetType: ReportTargetType;
  targetId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const requireAccount = useRequireAccount();
  return (
    <>
      <button
        type="button"
        className={className ?? "text-sm text-ink-faint hover:text-rust hover:underline"}
        onClick={() => requireAccount("report something") && setOpen(true)}
      >
        Report
      </button>
      <ReportDialog open={open} onClose={() => setOpen(false)} targetType={targetType} targetId={targetId} />
    </>
  );
}
