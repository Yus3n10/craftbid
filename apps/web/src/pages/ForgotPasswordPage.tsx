import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextInput } from "../components/ui/Field.js";
import { FormError } from "../components/ui/States.js";
import { ThreadRule } from "../components/ui/Primitives.js";

/**
 * Asking for a password reset link.
 *
 * The answer is the same whether or not the address has an account, so the
 * page never says "we found you": it says where to look if there is one.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const address = email.trim();
      await api.post<void>("/auth/forgot-password", { email: address });
      setSentTo(address);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <Page width="narrow">
        <div className="mx-auto max-w-sm">
          <h1 className="font-display text-3xl">Check your email</h1>
          <ThreadRule className="mt-4 w-16" />
          <p className="mt-4 text-ink-soft" role="status">
            If <strong className="text-ink">{sentTo}</strong> has a Craftbid account, a link
            to choose a new password is on its way. It works once and lasts one hour.
          </p>
          <p className="mt-3 text-sm text-ink-faint">
            Not there after a few minutes? Look in Spam or Promotions, and check the
            address is spelled right.
          </p>
          <p className="mt-8 text-sm text-ink-soft">
            Remembered it?{" "}
            <Link to="/login" className="font-medium text-indigo hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-3xl">Reset your password</h1>
        <ThreadRule className="mt-4 w-16" />
        <p className="mt-4 text-ink-soft">
          Enter the email you signed up with and we will send a link to choose a new
          password.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
          <FormError error={error} />
          <Field label="Email" required>
            {({ id }) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={sending}
            disabled={!email.includes("@")}
            className="w-full"
          >
            Send the link
          </Button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          <Link to="/login" className="font-medium text-indigo hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </Page>
  );
}
