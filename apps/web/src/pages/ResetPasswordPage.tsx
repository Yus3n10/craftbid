import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api.js";
import { clearTokens } from "../lib/session.js";
import { Page } from "../components/layout/Shell.js";
import { Button, ButtonLink } from "../components/ui/Button.js";
import { Field, PasswordInput } from "../components/ui/Field.js";
import { FormError } from "../components/ui/States.js";
import { ThreadRule } from "../components/ui/Primitives.js";
import { usePageMeta } from "../lib/pageMeta.js";

/**
 * Where a password reset link lands.
 *
 * Like the verification page, the token is sent by this page's own POST, never
 * spent by opening the link, because mail scanners open links. It is taken
 * out of the address bar at once so it does not sit in history or a screenshot.
 */
export function ResetPasswordPage() {
  usePageMeta({ title: "Choose a new password" });
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const token = useRef(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // The token is already held in the ref.
    window.history.replaceState(null, "", "/reset-password");
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post<void>("/auth/reset-password", { token: token.current, password });
      // Every session was just ended, this browser's included.
      clearTokens();
      queryClient.setQueryData(["me"], null);
      queryClient.clear();
      setDone(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <Page width="narrow">
        <div className="mx-auto max-w-sm">
          <h1 className="font-display text-3xl">Your password is changed</h1>
          <ThreadRule className="mt-4 w-16" />
          <p className="mt-4 text-ink-soft" role="status">
            You are signed out on every device. Sign in with your new password.
          </p>
          <div className="mt-6">
            <ButtonLink to="/login">Sign in</ButtonLink>
          </div>
        </div>
      </Page>
    );
  }

  const code = error instanceof ApiError ? error.code : null;
  const linkProblem = code === "link_invalid" || code === "link_used" || code === "link_expired";
  const fields = error instanceof ApiError ? error.fields : {};

  if (linkProblem || !token.current) {
    return (
      <Page width="narrow">
        <div className="mx-auto max-w-sm">
          <h1 className="font-display text-3xl">
            {code === "link_expired" ? "This link has expired" : "This link did not work"}
          </h1>
          <ThreadRule className="mt-4 w-16" />
          <p className="mt-4 text-ink-soft">
            {error instanceof ApiError
              ? error.message
              : "The link is missing part of its address. Ask for a new one."}
          </p>
          <p className="mt-3 text-sm text-ink-faint">
            Reset links last one hour, work once, and stop working when you use a newer
            one.
          </p>
          <div className="mt-6">
            <ButtonLink to="/forgot-password">Send a new link</ButtonLink>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-3xl">Choose a new password</h1>
        <ThreadRule className="mt-4 w-16" />

        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
          <FormError error={fields.password ? null : error} />
          <Field
            label="New password"
            hint="At least 10 characters. A short phrase is easier to remember and harder to guess than a short word."
            error={fields.password}
            required
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                aria-describedby={describedBy}
                invalid={invalid}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            )}
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={saving}
            disabled={password.length === 0}
            className="w-full"
          >
            Save new password
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
