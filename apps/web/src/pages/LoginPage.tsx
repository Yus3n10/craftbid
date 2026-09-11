import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { BEARER_MODE } from "../lib/session.js";
import { RememberMe } from "../components/RememberMe.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextInput } from "../components/ui/Field.js";
import { FormError } from "../components/ui/States.js";
import { ThreadRule } from "../components/ui/Primitives.js";

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = (location.state as { from?: string } | null)?.from ?? "/";

  // Same reason as on the register page: this guard fires as soon as the
  // session lands, so it has to be the thing that decides where you go, or it
  // races an imperative navigate and wins with the wrong destination.
  if (user) return <Navigate to={returnTo} replace />;
  const fields = error instanceof ApiError ? error.fields : {};

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The redirect above takes over as soon as the session lands.
      await login({ email, password, remember });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page width="narrow">
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-3xl">Welcome back</h1>
        <ThreadRule className="mt-4 w-16" />

        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
          <FormError error={error} />

          <Field label="Email" error={fields.email} required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="email"
                aria-describedby={describedBy}
                invalid={invalid}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>

          <Field label="Password" error={fields.password} required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                aria-describedby={describedBy}
                invalid={invalid}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            )}
          </Field>

          {!BEARER_MODE && <RememberMe checked={remember} onChange={setRemember} />}

          <Button type="submit" size="lg" loading={submitting} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          New to Craftbid?{" "}
          <Link to="/register" className="font-medium text-indigo hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </Page>
  );
}
