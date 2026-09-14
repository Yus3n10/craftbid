import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { postForm } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, TextArea } from "./ui/Field.js";
import { FormError } from "./ui/States.js";

/**
 * "Report a problem with the site". The page and browser are filled in and
 * shown before sending, so nothing is collected that the person cannot see.
 */
export function BugReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname, search } = useLocation();
  const pageUrl = `${pathname}${search}`;
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("description", description.trim());
      form.append("pageUrl", pageUrl);
      form.append("userAgent", navigator.userAgent.slice(0, 500));
      if (screenshot) form.append("screenshot", screenshot);
      return postForm<{ id: string }>("/bug-reports", form);
    },
  });

  const close = () => {
    onClose();
    setDescription("");
    setScreenshot(null);
    send.reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Report a problem with the site"
      size="md"
      actions={
        send.isSuccess ? (
          <Button type="button" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={description.trim().length < 10}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              Send
            </Button>
          </>
        )
      }
    >
      {send.isSuccess ? (
        <p>Thanks. This goes straight to the people who fix Craftbid.</p>
      ) : (
        <div className="space-y-4">
          <Field label="What went wrong?" hint="What you did, what you expected, and what happened instead.">
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                value={description}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
          <Field label="Screenshot (optional)">
            {({ id }) => (
              <input
                id={id}
                type="file"
                accept="image/*"
                className="block w-full text-sm text-ink-soft"
                onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)}
              />
            )}
          </Field>
          <dl className="rounded-md bg-paper-sunk px-3 py-2 text-xs text-ink-faint">
            <div>
              <dt className="inline font-medium">Page: </dt>
              <dd className="inline break-all">{pageUrl}</dd>
            </div>
            <div className="mt-1">
              <dt className="inline font-medium">Browser: </dt>
              <dd className="inline break-all">{navigator.userAgent}</dd>
            </div>
          </dl>
          <FormError error={send.error} />
        </div>
      )}
    </Dialog>
  );
}
