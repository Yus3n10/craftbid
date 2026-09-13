import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth.js";
import { ResendLink } from "../CheckYourEmail.js";

/**
 * Notices about the account itself, under the header on every page.
 *
 * - Unconfirmed email: signed in, but refused posting, bidding and the social
 *   actions until the address is confirmed. Saying so on every page, with the
 *   way to fix it, beats letting someone discover it one refused click at a
 *   time. Accounts from before verification existed see this too.
 * - Just confirmed: the link from the email lands here, and this is the moment
 *   to say it worked.
 */
export function AccountNotices() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [resendOpen, setResendOpen] = useState(false);
  const welcome = (location.state as { welcome?: boolean } | null)?.welcome === true;

  if (user && !user.emailVerified) {
    return (
      <div className="border-b border-amber/30 bg-amber-wash" role="region" aria-label="Confirm your email">
        <div className="mx-auto max-w-6xl px-4 py-3 text-sm text-ink">
          <p>
            <strong>Confirm your email to post, bid, react, comment, save and share.</strong>{" "}
            We sent a link to {user.email}.{" "}
            {!resendOpen && (
              <button
                type="button"
                onClick={() => setResendOpen(true)}
                className="font-medium text-indigo underline"
              >
                Send a new link
              </button>
            )}
          </p>
          {resendOpen && (
            <div className="mt-3">
              <ResendLink />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (user && welcome) {
    return (
      <div className="border-b border-sage/30 bg-sage-wash" role="status">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 text-sm text-ink">
          <p>
            <strong>Your email is confirmed.</strong> Welcome to Craftbid, {user.displayName}.
          </p>
          <button
            type="button"
            onClick={() => navigate(location.pathname, { replace: true, state: null })}
            className="shrink-0 font-medium text-indigo underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
