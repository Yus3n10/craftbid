import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { Button } from "../components/ui/Button.js";
import { Dialog } from "../components/ui/Dialog.js";

/**
 * Asking before someone loses what they typed.
 *
 * A form reports whether it holds anything unsent with useUnsavedChanges(dirty).
 * While any form does, three ways of losing it are stopped:
 *
 * - following a link or pressing Back inside the app, which opens a dialog
 *   (React Router allows one blocker per router, so there is exactly one,
 *   here, reading every form's report);
 * - closing the tab, reloading or typing a new address, which only the
 *   browser's own "Leave site?" prompt can intercept;
 * - signing out, which the header asks about through useUnsavedChangesState.
 *
 * A form that navigates away after a successful submit calls
 * leaveWithoutPrompt() first, since what it held has just been sent.
 */

interface UnsavedChangesValue {
  report: (source: string, dirty: boolean) => void;
  hasUnsavedChanges: () => boolean;
  leaveWithoutPrompt: () => void;
}

const Context = createContext<UnsavedChangesValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtySources = useRef(new Set<string>());
  // When a form last said it is leaving on purpose. A window rather than a
  // one-shot flag: a flag left set by a navigation that never happened (to
  // the same address, say) would let a later, unrelated one through.
  const bypassUntil = useRef(0);
  // Only drives re-rendering for the beforeunload listener; the blocker reads
  // the ref, so a navigation in the same tick as a report sees the truth.
  const [anyDirty, setAnyDirty] = useState(false);

  const report = useCallback((source: string, dirty: boolean) => {
    if (dirty) dirtySources.current.add(source);
    else dirtySources.current.delete(source);
    setAnyDirty(dirtySources.current.size > 0);
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (Date.now() < bypassUntil.current) return false;
    return (
      dirtySources.current.size > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search)
    );
  });

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required by some browsers to show the prompt at all; the text itself
      // is ignored and the browser shows its own.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const value = useMemo<UnsavedChangesValue>(
    () => ({
      report,
      hasUnsavedChanges: () => dirtySources.current.size > 0,
      leaveWithoutPrompt: () => {
        bypassUntil.current = Date.now() + 1000;
      },
    }),
    [report],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <Dialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        actions={
          <>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              Stay on this page
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                // What they typed is being abandoned on purpose.
                dirtySources.current.clear();
                setAnyDirty(false);
                blocker.proceed?.();
              }}
            >
              Leave
            </Button>
          </>
        }
      >
        You have started filling something in on this page. If you leave now,
        what you typed will be lost.
      </Dialog>
    </Context.Provider>
  );
}

function useUnsavedChangesContext(): UnsavedChangesValue {
  const value = useContext(Context);
  if (!value) throw new Error("Unsaved changes hooks need an UnsavedChangesProvider");
  return value;
}

/** Reports whether this form holds something unsent. Cleared on unmount. */
export function useUnsavedChanges(dirty: boolean): void {
  const { report } = useUnsavedChangesContext();
  const source = useId();

  useEffect(() => {
    report(source, dirty);
  }, [report, source, dirty]);

  useEffect(() => () => report(source, false), [report, source]);
}

export function useUnsavedChangesState(): Pick<
  UnsavedChangesValue,
  "hasUnsavedChanges" | "leaveWithoutPrompt"
> {
  const { hasUnsavedChanges, leaveWithoutPrompt } = useUnsavedChangesContext();
  return { hasUnsavedChanges, leaveWithoutPrompt };
}
