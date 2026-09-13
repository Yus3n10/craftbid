import { useEffect, useRef, useState } from "react";
import { loadPrivateImage } from "../../lib/api.js";
import { cx } from "../../lib/cx.js";
import { CloseIcon } from "../ui/Icons.js";

/**
 * A receipt or a photo of a commission, which only its two parties may see.
 *
 * The bytes are fetched with the session and shown from memory, so no link to
 * the file exists anywhere to be copied or forwarded. Tapping opens it full
 * size, because a receipt is read, not glanced at.
 */
export function PrivateImage({
  commissionId,
  fileId,
  alt,
  className,
}: {
  commissionId: string;
  fileId: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    loadPrivateImage(commissionId, fileId)
      .then((created) => {
        objectUrl = created;
        if (active) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [commissionId, fileId]);

  if (failed) {
    return (
      <div className={cx("flex items-center justify-center rounded-md border border-fiber bg-paper-sunk p-4 text-xs text-ink-faint", className)}>
        Could not load this image.
      </div>
    );
  }

  if (!url) {
    return <div className={cx("animate-pulse rounded-md bg-paper-sunk", className)} aria-label="Loading image" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={cx("block overflow-hidden rounded-md border border-fiber bg-paper-sunk", className)}
        aria-label={`${alt}. Open full size`}
      >
        <img src={url} alt={alt} className="h-full w-full object-contain" />
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto max-h-[92dvh] max-w-[92vw] rounded-md bg-paper-raised p-0 backdrop:bg-ink/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-full bg-paper-raised/90 text-ink"
            aria-label="Close"
          >
            <CloseIcon width={18} height={18} />
          </button>
          <img src={url} alt={alt} className="max-h-[92dvh] max-w-[92vw] object-contain" />
        </div>
      </dialog>
    </>
  );
}
