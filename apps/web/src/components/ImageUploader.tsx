import { useRef, useState } from "react";
import { UPLOAD } from "@craftbid/shared";
import { ApiError, uploadImage } from "../lib/api.js";
import { Button } from "./ui/Button.js";

export interface UploadedImage {
  id: string;
  url: string;
}

/**
 * Uploads happen as files are chosen rather than on submit, so a slow upload
 * does not hold the form hostage and a rejected file is reported next to the
 * file, not after the whole form is filled in.
 */
export function ImageUploader({
  images,
  onChange,
  max,
  label,
  hint,
}: {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  max: number;
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = max - images.length;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    const chosen = Array.from(fileList).slice(0, remaining);
    if (chosen.length < fileList.length) {
      setError(`You can add ${max} images at most. The extra files were skipped.`);
    }

    setBusy(true);
    const uploaded: UploadedImage[] = [];
    try {
      for (const file of chosen) {
        // Checked here for a fast, specific message; the server checks the real
        // bytes regardless, because a client-side limit is only a courtesy.
        if (file.size > UPLOAD.maxBytes) {
          setError(
            `"${file.name}" is larger than ${Math.floor(UPLOAD.maxBytes / (1024 * 1024))} MB.`,
          );
          continue;
        }
        const image = await uploadImage(file);
        uploaded.push({ id: image.id, url: image.url });
      }
      if (uploaded.length > 0) onChange([...images, ...uploaded]);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That image could not be uploaded. Try another file.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-ink">{label}</span>
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}

      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <li key={image.id} className="group relative">
              <img
                src={image.url}
                alt=""
                className="aspect-square w-full rounded-md border border-fiber object-cover"
              />
              {index === 0 && (
                <span className="absolute left-1 top-1 rounded-sm bg-indigo px-1.5 py-0.5 text-[10px] font-semibold text-paper-raised">
                  Cover
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(images.filter((item) => item.id !== image.id))}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-ink/75 text-paper-raised transition-opacity hover:bg-ink"
                aria-label="Remove this image"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2 2l8 8M10 2L2 10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD.allowedMimeTypes.join(",")}
        multiple
        className="sr-only"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={remaining <= 0}
        onClick={() => inputRef.current?.click()}
      >
        {remaining <= 0
          ? `Maximum of ${max} images added`
          : images.length === 0
            ? "Add images"
            : `Add more (${remaining} left)`}
      </Button>

      {error && (
        <p role="alert" className="text-sm font-medium text-rust">
          {error}
        </p>
      )}
    </div>
  );
}
