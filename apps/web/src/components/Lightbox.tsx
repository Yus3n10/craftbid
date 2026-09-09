import { useCallback, useEffect, useRef } from "react";
import type { ImageDto } from "@craftbid/shared";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./ui/Icons.js";

/**
 * Full-size viewing for a set of images.
 *
 * A reference photo is the brief, and a portfolio photo is the product. Card
 * sizes are a compromise for the grid, so there has to be somewhere the whole
 * thing can be seen at the size the screen allows.
 *
 * Implemented as a real dialog rather than a styled div: Escape closes it, the
 * page behind cannot be tabbed into, and focus comes back to the thumbnail
 * that opened it.
 */
export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
  alt,
}: {
  images: ImageDto[];
  /** null when closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  alt: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = index !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      // showModal, not the open attribute: it is what gives the top layer, the
      // inert background and Escape-to-close without any of it being written
      // here by hand.
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const step = useCallback(
    (delta: number) => {
      if (index === null || images.length < 2) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [index, images.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  // Narrowed to a number here, so the counter below does not have to keep
  // re-proving that an open lightbox has an index.
  if (index === null || !images[index]) {
    return <dialog ref={dialogRef} className="hidden" onClose={onClose} />;
  }
  const position = index;
  const current = images[position]!;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // Clicking the backdrop closes. The dialog element itself fills the
      // screen, so the check is whether the click landed on the frame rather
      // than on anything inside it.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="max-h-none max-w-none bg-transparent p-0 backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
      style={{ width: "100vw", height: "100dvh" }}
      aria-label={alt}
    >
      <div className="pointer-events-none flex h-full w-full items-center justify-center p-4 sm:p-8">
        <img
          src={current.url}
          alt={alt}
          width={current.width}
          height={current.height}
          className="pointer-events-auto max-h-full max-w-full rounded-sm object-contain shadow-2xl"
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="pointer-events-auto absolute right-3 top-3 rounded-full bg-paper/90 p-2 text-ink transition-colors hover:bg-paper"
      >
        <CloseIcon className="size-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous image"
            className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-paper/90 p-2 text-ink transition-colors hover:bg-paper"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next image"
            className="pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-paper/90 p-2 text-ink transition-colors hover:bg-paper"
          >
            <ChevronRightIcon className="size-5" />
          </button>
          <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-paper/90 px-3 py-1 text-xs tabular text-ink-soft">
            {position + 1} of {images.length}
          </p>
        </>
      )}
    </dialog>
  );
}
