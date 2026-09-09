import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import type { UserRole } from "@craftbid/shared";
import { LIMITS } from "@craftbid/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { cx } from "../lib/cx.js";
import { Page } from "../components/layout/Shell.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextInput } from "../components/ui/Field.js";
import { FormError } from "../components/ui/States.js";
import { ThreadRule } from "../components/ui/Primitives.js";

const ROLES: { value: UserRole; title: string; description: string }[] = [
  {
    value: "client",
    title: "I want something made",
    description: "Post craft requests and choose the artist who makes them.",
  },
  {
    value: "artist",
    title: "I make things",
    description: "Build a portfolio and bid on requests in your craft.",
  },
];

export function RegisterPage() {
  const { user, register } = useAuth();
  const [params] = useSearchParams();

  const [role, setRole] = useState<UserRole>(
    params.get("role") === "artist" ? "artist" : "client",
  );
  const [form, setForm] = useState({
    displayName: "",
    username: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  // Redirecting here rather than calling navigate() after the mutation. Doing
  // both meant this guard re-rendered the moment the session landed and raced
  // the imperative navigation, dropping new users on the home page instead of
  // where they need to go: an artist at their craft settings, a client at the
  // requests they came to post against.
  if (user) {
    return <Navigate to={user.role === "artist" ? "/settings" : "/postings"} replace />;
  }

  const fields = error instanceof ApiError ? error.fields : {};

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The redirect above takes over as soon as the session lands.
      await register({ ...form, role });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page width="narrow">
      <h1 className="font-display text-3xl">Join Craftbid</h1>
      <ThreadRule className="mt-4 w-16" />
      <p className="mt-4 text-ink-soft">
        Choose how you will use Craftbid. This decides what you can do, and it
        cannot be switched later.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
        <fieldset>
          <legend className="mb-3 text-sm font-medium text-ink">
            How will you use Craftbid?
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLES.map((option) => {
              const selected = role === option.value;
              return (
                <label
                  key={option.value}
                  className={cx(
                    "cursor-pointer rounded-md border p-4 transition-colors",
                    selected
                      ? "border-indigo bg-indigo-wash ring-2 ring-indigo/25"
                      : "border-fiber-strong bg-paper-raised hover:border-indigo",
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={selected}
                    onChange={() => setRole(option.value)}
                    className="sr-only"
                  />
                  <span className="block font-display text-lg text-ink">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-sm text-ink-soft">
                    {option.description}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <FormError error={error} />

        <Field label="Display name" error={fields.displayName} required>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              autoComplete="name"
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.displayName}
              onChange={(event) => update("displayName", event.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label="Username"
          hint="Your public handle, used in your profile link."
          error={fields.username}
          required
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              autoComplete="username"
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.username}
              onChange={(event) => update("username", event.target.value)}
              required
            />
          )}
        </Field>

        <Field label="Email" error={fields.email} required>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label="Password"
          hint={`At least ${LIMITS.password.min} characters. A short phrase is easier to remember and harder to guess than a short word.`}
          error={fields.password}
          required
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
              required
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-indigo hover:underline">
          Sign in
        </Link>
      </p>
    </Page>
  );
}
