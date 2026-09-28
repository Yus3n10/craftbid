import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth.js";
import { Button } from "./ui/Button.js";
import { Field, TextInput } from "./ui/Field.js";
import { FormError } from "./ui/States.js";
import { ThreadRule } from "./ui/Primitives.js";

const COOLDOWN_SECONDS = 60;

/**
 * Asking for another verification link, with a cooldown that matches the
 * server's one-a-minute limit. Without it, a second tap inside the minute
 * would say "sent" while the server quietly sent nothing.
 */
export function ResendLink({ email: fixedEmail }: { email?: string }) {
  const { user, resendVerification } = useAuth();
  const [email, setEmail] = useState(fixedEmail ?? "");
  const [wait, setWait] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // Signed in, the server uses the account's own address.
  const needsAddress = !user && !fixedEmail;

  async function send() {
    setError(null);
    setSending(true);
    try {
      await resendVerification(user ? undefined : email.trim());
      setSent(true);
      setWait(COOLDOWN_SECONDS);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <FormError error={error} />
      {needsAddress && (
        <Field label="Your email">
          {({ id }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          loading={sending}
          disabled={wait > 0 || (needsAddress && !email.includes("@"))}
        >
          {wait > 0 ? `Send another link in ${wait}s` : "Send a link"}
        </Button>
        {sent && (
          <span className="text-sm text-sage" role="status">
            If that address has an unconfirmed account, a new link is on its way.
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * After sign-up: where the link went, and what to do if it does not arrive.
 *
 * `emailSent` false means the server tried and the sender refused. Saying so
 * is better than leaving someone watching an inbox nothing is coming to, and
 * it gives away nothing: they created this account themselves a moment ago.
 */
export function CheckYourEmail({ email, emailSent = true }: { email: string; emailSent?: boolean }) {
  if (!emailSent) {
    return (
      <div>
        <h1 className="font-display text-3xl">Your account is ready</h1>
        <ThreadRule className="mt-4 w-16" />
        <div className="mt-4 rounded-md bg-amber-wash px-3 py-2.5 text-sm" role="status">
          <p className="font-medium text-amber">
            We could not send the confirmation link just now
          </p>
          <p className="mt-1 text-ink">
            Your account for <strong>{email}</strong> is saved, so nothing is
            lost.
          </p>
        </div>
        <p className="mt-4 text-ink-soft">
          Ask for the link again below. If it still does not arrive, try in a few
          minutes, or report a problem from the footer and we will look into it.
        </p>
        <div className="mt-6">
          <ResendLink email={email} />
        </div>
        <p className="mt-8 text-sm text-ink-soft">
          Typed the wrong address?{" "}
          <Link to="/register" reloadDocument className="font-medium text-indigo hover:underline">
            Start again
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Check your email</h1>
      <ThreadRule className="mt-4 w-16" />
      <p className="mt-4 text-ink-soft">
        We sent a link to <strong className="text-ink">{email}</strong>. Open it
        on this phone or computer to confirm your address and go straight to your
        new account. The link works once and lasts 24 hours.
      </p>
      <p className="mt-3 text-sm text-ink-faint">
        Not there after a few minutes? Look in Spam or Promotions, and check the
        address above is spelled right.
      </p>
      <div className="mt-6">
        <ResendLink email={email} />
      </div>
      <p className="mt-8 text-sm text-ink-soft">
        Typed the wrong address?{" "}
        <Link to="/register" reloadDocument className="font-medium text-indigo hover:underline">
          Start again
        </Link>
      </p>
    </div>
  );
}
