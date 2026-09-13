import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../../lib/cx.js";
import { CloseIcon } from "./Icons.js";

/**
 * A small modal: a title, a message, actions, and an X in the corner.
 *
 * Built on <dialog> with showModal, like the Lightbox, so Escape closes it,
 * the page behind is inert, and focus returns to whatever opened it, without
 * any of that written by hand. Closing by Escape, the X or the backdrop all
 * call onClose, so a dialog never disappears without its owner knowing.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  size = "sm",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        // Escape. Let the owner decide, so state and the element agree.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-fiber bg-paper-raised p-0 text-ink shadow-lift backdrop:bg-ink/40",
        size === "sm" ? "max-w-sm" : "max-w-lg",
      )}
    >
      {open && (
        // Focus lands on the dialog's content rather than its first button.
        // showModal otherwise focuses the X, which draws a heavy focus ring
        // around it on a phone and makes closing look like the suggestion.
        <div className="relative p-6 outline-none" tabIndex={-1} autoFocus>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            <CloseIcon className="size-4" />
          </button>
          <h2 id={titleId} className="pr-8 font-display text-xl">
            {title}
          </h2>
          {children && <div className="mt-3 text-sm text-ink-soft">{children}</div>}
          {actions && <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}
