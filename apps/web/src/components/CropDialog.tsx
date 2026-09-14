import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampFrame,
  cropProblem,
  cropRect,
  initialFrame,
  maxZoom,
  outputSize,
  type CropFrame,
  type CropSpec,
} from "@craftbid/shared";
import { cx } from "../lib/cx.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";

interface Loaded {
  image: HTMLImageElement;
  url: string;
  width: number;
  height: number;
}

/**
 * Framing a profile picture or cover before it is saved.
 *
 * Drag to move, pinch, scroll or use the slider to zoom. The frame is the same
 * shape the picture is shown in (a circle cut from a square, or a 3:1 cover),
 * and the saved image is drawn from exactly the rectangle on screen, so what
 * someone frames here is what everyone else sees. The limits come from the
 * shared crop rules: no empty edges, and no zooming in so far the result is a
 * blur.
 *
 * Browsers draw an image with its EXIF orientation already applied, so a phone
 * photo taken sideways is framed the right way up.
 */
export function CropDialog({
  file,
  spec,
  shape,
  title,
  busy,
  error,
  onCancel,
  onCrop,
}: {
  file: File | null;
  spec: CropSpec;
  shape: "circle" | "rect";
  title: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onCrop: (blob: Blob) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [frame, setFrame] = useState<CropFrame | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ frame: CropFrame; distance: number | null } | null>(null);

  useEffect(() => {
    setLoaded(null);
    setLoadError(null);
    setFrame(null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const problem = cropProblem(width, height, spec);
      if (problem) {
        setLoadError(problem);
        return;
      }
      setLoaded({ image, url, width, height });
      setFrame(initialFrame(width, height));
    };
    image.onerror = () => setLoadError("That file could not be opened as a photo. Try a JPEG, PNG or WebP.");
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, spec]);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setFrameWidth(element.clientWidth));
    observer.observe(element);
    setFrameWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [loaded]);

  const rect = loaded && frame ? cropRect(frame, loaded.width, loaded.height, spec) : null;
  const scale = rect && frameWidth ? frameWidth / rect.width : 0;
  const zoomLimit = loaded ? maxZoom(loaded.width, loaded.height, spec) : 1;

  function update(next: CropFrame) {
    if (!loaded) return;
    setFrame(clampFrame(next, loaded.width, loaded.height, spec));
  }

  // Scrolling over the frame zooms instead of scrolling the page.
  useEffect(() => {
    const element = area.current;
    if (!element || !loaded) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setFrame((current) =>
        current ? clampFrame({ ...current, zoom: current.zoom * Math.exp(-event.deltaY * 0.0015) }, loaded.width, loaded.height, spec) : current,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [loaded, spec]);

  function distance(): number | null {
    const points = [...pointers.current.values()];
    if (points.length < 2) return null;
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  }

  function crop() {
    if (!loaded || !rect) return;
    const size = outputSize(rect, spec);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingQuality = "high";
    context.drawImage(loaded.image, rect.x, rect.y, rect.width, rect.height, 0, 0, size.width, size.height);
    canvas.toBlob((blob) => blob && onCrop(blob), "image/jpeg", 0.9);
  }

  return (
    <Dialog
      open={file !== null}
      onClose={onCancel}
      title={title}
      size="lg"
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={crop} loading={busy} disabled={!rect}>
            Use this photo
          </Button>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="text-sm text-rust">
          {loadError}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {shape === "circle"
              ? "Other people see what is inside the circle. Drag to move the photo, and zoom to fit."
              : "This is how your cover shows on your profile. Drag to move the photo, and zoom to fit."}
          </p>

          <div
            ref={area}
            className={cx(
              "relative mx-auto w-full touch-none select-none overflow-hidden rounded-md bg-ink",
              shape === "circle" ? "max-w-sm" : "",
              loaded ? "cursor-grab active:cursor-grabbing" : "",
            )}
            style={{ aspectRatio: String(spec.aspect) }}
            data-testid="crop-area"
            onPointerDown={(event) => {
              if (!frame) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              gesture.current = { frame, distance: distance() };
            }}
            onPointerMove={(event) => {
              const start = pointers.current.get(event.pointerId);
              if (!start || !gesture.current || !scale) return;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const now = distance();
              if (now && gesture.current.distance) {
                // Two fingers: zoom by how far apart they have moved.
                update({ ...gesture.current.frame, zoom: gesture.current.frame.zoom * (now / gesture.current.distance) });
                return;
              }
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              update({
                ...gesture.current.frame,
                centerX: gesture.current.frame.centerX - dx / scale,
                centerY: gesture.current.frame.centerY - dy / scale,
              });
            }}
            onPointerUp={(event) => {
              pointers.current.delete(event.pointerId);
              if (frame) gesture.current = pointers.current.size > 0 ? { frame, distance: distance() } : null;
            }}
            onPointerCancel={(event) => {
              pointers.current.delete(event.pointerId);
              gesture.current = null;
            }}
          >
            {loaded && rect && scale > 0 && (
              <img
                src={loaded.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none"
                style={{
                  width: loaded.width * scale,
                  height: loaded.height * scale,
                  transform: `translate(${-rect.x * scale}px, ${-rect.y * scale}px)`,
                }}
              />
            )}
            {shape === "circle" ? (
              <div
                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-paper-raised/80"
                style={{ boxShadow: "0 0 0 9999px rgba(20, 38, 47, 0.55)" }}
              />
            ) : (
              <div className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-inset ring-paper-raised/70" />
            )}
          </div>

          <label className="flex items-center gap-3 text-sm text-ink-soft">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              aria-label="Zoom"
              min={1}
              max={zoomLimit}
              step={0.01}
              value={frame?.zoom ?? 1}
              disabled={!frame || zoomLimit <= 1}
              onChange={(event) => frame && update({ ...frame, zoom: Number(event.target.value) })}
              className="w-full accent-indigo"
            />
          </label>
          {loaded && zoomLimit <= 1 && (
            <p className="text-xs text-ink-faint">This photo is only just big enough, so it cannot be zoomed in.</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-rust">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
