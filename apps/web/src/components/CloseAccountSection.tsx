import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";
import { Field, PasswordInput } from "./ui/Field.js";
import { Card, ThreadRule } from "./ui/Primitives.js";
import { FormError } from "./ui/States.js";

/**
 * Closing the account for good.
 *
 * The server decides whether it is allowed (not with a commission in
 * progress or an open problem) and says why not; the dialog shows that
 * answer. The password is asked for so a borrowed, signed-in phone cannot be
 * used to close someone else's account.
 */
export function CloseAccountSection() {
  const { closeAccount } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [closing, setClosing] = useState(false);

  function dismiss() {
    setOpen(false);
    setPassword("");
    setError(null);
  }

  async function confirm() {
    setError(null);
    setClosing(true);
    try {
      await closeAccount(password);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setClosing(false);
    }
  }

  const fields = error instanceof ApiError ? error.fields : {};

  return (
    <section id="close-account" aria-labelledby="close-account-title" className="scroll-mt-24">
      <Card className="p-6">
        <div className="pl-3">
          <h2 id="close-account-title" className="font-display text-xl">
            Close your account
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Removes your profile, portfolio, links and payment details, and signs you out
            everywhere. This cannot be undone.
          </p>
          <ThreadRule className="my-4 w-14" />
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Close account
          </Button>
        </div>
      </Card>

      <Dialog
        open={open}
        onClose={dismiss}
        title="Close your Craftbid account?"
        actions={
          <>
            <Button type="button" variant="ghost" onClick={dismiss}>
              Keep my account
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={closing}
              disabled={password.length === 0}
              onClick={() => void confirm()}
            >
              Close account
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Your profile, posts, comments, shares and saved posts are removed.</li>
          <li>Open requests are cancelled and bids waiting for an answer are withdrawn.</li>
          <li>
            Finished commissions and their payment records stay for the other person, shown
            as "Removed account".
          </li>
          <li>You can sign up again later with the same email, as a new account.</li>
        </ul>
        <div className="mt-4">
          <FormError error={fields.password ? null : error} />
          <Field label="Your password" error={fields.password} required>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                aria-describedby={describedBy}
                invalid={invalid}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  );
}
