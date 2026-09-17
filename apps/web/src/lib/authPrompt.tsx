import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button.js";
import { Dialog } from "../components/ui/Dialog.js";
import { ResendLink } from "../components/CheckYourEmail.js";
import { useAuth } from "./auth.js";

/**
 * The "you need an account" popup: what they tried to do, why it needs an
 * account, and a way to sign in or join that brings them back here. The X,
 * Escape or a tap outside closes it and leaves them where they were.
 *
 * This is presentation only. Every one of these actions is refused by the API
 * without a session regardless of what the page shows.
 */

type Prompt = { action: string; reason: "signed_out" | "unverified" } | null;

const Context = createContext<((action: string) => boolean) | null>(null);

export function AuthPromptProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [prompt, setPrompt] = useState<Prompt>(null);

  const requireAccount = useCallback(
    (action: string) => {
      if (user?.emailVerified) return true;
      setPrompt({ action, reason: user ? "unverified" : "signed_out" });
      return false;
    },
    [user],
  );

  const go = (to: "/login" | "/register") => {
    setPrompt(null);
    navigate(to, { state: { from: `${location.pathname}${location.search}` } });
  };

  const value = useMemo(() => requireAccount, [requireAccount]);

  return (
    <Context.Provider value={value}>
      {children}
      <Dialog
        open={prompt?.reason === "unverified"}
        onClose={() => setPrompt(null)}
        title="Confirm your email first"
      >
        {prompt && user && (
          <div className="space-y-4">
            <p>
              To {prompt.action}, confirm that {user.email} is yours: send
              yourself a link, then open it from your inbox.
            </p>
            <ResendLink />
          </div>
        )}
      </Dialog>
      <Dialog
        open={prompt?.reason === "signed_out"}
        onClose={() => setPrompt(null)}
        title="You need an account for that"
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/register")}>
              Create an account
            </Button>
            <Button onClick={() => go("/login")}>Sign in</Button>
          </>
        }
      >
        {prompt && (
          <p>
            Sign in to {prompt.action}. It is free, and it keeps what you do on
            Craftbid tied to a real person.
          </p>
        )}
      </Dialog>
    </Context.Provider>
  );
}

/**
 * Returns a check to call at the start of an account-only click. It passes
 * only for a signed-in account with a confirmed email, and otherwise opens the
 * popup that says which of the two is missing:
 * `if (!requireAccount("save posts")) return;`
 */
export function useRequireAccount(): (action: string) => boolean {
  const value = useContext(Context);
  if (!value) throw new Error("useRequireAccount needs an AuthPromptProvider");
  return value;
}
