import { useRef, useState } from "react";
import { AVATAR_CROP, COVER_CROP, UPLOAD } from "@craftbid/shared";
import { ApiError, uploadImage } from "../lib/api.js";
import { Button } from "./ui/Button.js";
import { CropDialog } from "./CropDialog.js";
import type { UploadedImage } from "./ImageUploader.js";

/**
 * A profile picture or cover, chosen and framed before it is saved.
 *
 * The preview here is the same shape as on the profile (a circle, or a 3:1
 * band), and the uploaded file is the cropped image itself, so the three
 * places it appears (editor, this preview, the profile) cannot disagree.
 */
export function CroppedImageField({
  kind,
  label,
  hint,
  image,
  onChange,
}: {
  kind: "avatar" | "cover";
  label: string;
  hint?: string;
  image: UploadedImage | null;
  onChange: (image: UploadedImage | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = kind === "avatar" ? AVATAR_CROP : COVER_CROP;

  async function upload(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImage(new File([blob], kind === "avatar" ? "profile.jpg" : "cover.jpg", { type: "image/jpeg" }));
      onChange({ id: uploaded.id, url: uploaded.url });
      setFile(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That photo could not be uploaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-ink">{label}</span>
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}

      <div className={kind === "avatar" ? "flex items-center gap-4" : "space-y-3"}>
        {kind === "avatar" ? (
          <span className="block size-24 shrink-0 overflow-hidden rounded-full border border-fiber bg-paper-sunk">
            {image && <img src={image.url} alt="Your profile picture" className="size-full object-cover" />}
          </span>
        ) : (
          <span className="block aspect-[3/1] w-full overflow-hidden rounded-md border border-fiber bg-paper-sunk">
            {image && <img src={image.url} alt="Your cover photo" className="size-full object-cover" />}
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
            {image ? "Change photo" : "Choose photo"}
          </Button>
          {image && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept={UPLOAD.allowedMimeTypes.join(",")}
        className="sr-only"
        aria-label={`Choose a ${kind === "avatar" ? "profile picture" : "cover photo"}`}
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (!chosen) return;
          setError(null);
          setFile(chosen);
        }}
      />

      <CropDialog
        file={file}
        spec={spec}
        shape={kind === "avatar" ? "circle" : "rect"}
        title={kind === "avatar" ? "Frame your profile picture" : "Frame your cover photo"}
        busy={busy}
        error={error}
        onCancel={() => setFile(null)}
        onCrop={(blob) => void upload(blob)}
      />
    </div>
  );
}
