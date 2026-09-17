import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { Page } from "../components/layout/Shell.js";
import { ResendLink } from "../components/CheckYourEmail.js";
import { ButtonLink } from "../components/ui/Button.js";
import { ThreadRule } from "../components/ui/Primitives.js";
import { usePageMeta } from "../lib/pageMeta.js";

/**
 * Where the link in a verification email lands.
 *
 * The token is sent to the API by this page rather than the API verifying on
 * a plain GET of the link. Mail providers and link scanners open links in
 * emails to check them, and a GET that verified would spend the token before
 * the person ever tapped it. Scanners fetch the page; they do not run it.
 *
 * The token is also taken out of the address bar straight away, so it is not
 * left in the history, in a screenshot, or in a link copied from the page.
 */
export function VerifyEmailPage() {
  usePageMeta({ title: "Confirm your email" });
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const [failure, setFailure] = useState<ApiError | Error | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once per page load. StrictMode runs effects twice in development, and a
    // second request with the same token would report it already used.
    if (started.current) return;
    started.current = true;

    const token = params.get("token") ?? "";
    window.history.replaceState(null, "", "/verify-email");

    verifyEmail(token)
      .then(() => navigate("/", { replace: true, state: { welcome: true } }))
      .catch((error: unknown) =>
        setFailure(error instanceof Error ? error : new Error("Something went wrong.")),
      );
  }, [params, navigate, verifyEmail]);

  if (!failure) {
    return (
      <Page width="narrow">
        <p className="text-ink-soft" role="status">
          Confirming your email…
        </p>
      </Page>
    );
  }

  const code = failure instanceof ApiError ? failure.code : "unknown";

  if (code === "already_verified") {
    return (
      <Page width="narrow">
        <h1 className="font-display text-3xl">Your email is already confirmed</h1>
        <ThreadRule className="mt-4 w-16" />
        <p className="mt-4 text-ink-soft">
          This link was used before. Sign in to continue.
        </p>
        <div className="mt-6">
          <ButtonLink to="/login">Sign in</ButtonLink>
        </div>
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <h1 className="font-display text-3xl">
        {code === "link_expired" ? "This link has expired" : "This link did not work"}
      </h1>
      <ThreadRule className="mt-4 w-16" />
      <p className="mt-4 text-ink-soft">{failure.message}</p>
      <p className="mt-3 text-sm text-ink-faint">
        Links last 24 hours and work once, and only the newest one you asked for
        counts. Enter your email and we will send a fresh one.
      </p>
      <div className="mt-6">
        <ResendLink />
      </div>
      <p className="mt-8 text-sm text-ink-soft">
        Already confirmed?{" "}
        <Link to="/login" className="font-medium text-indigo hover:underline">
          Sign in
        </Link>
      </p>
    </Page>
  );
}
