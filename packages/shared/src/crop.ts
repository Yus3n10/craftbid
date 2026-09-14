/**
 * Cropping a profile picture or a cover photo.
 *
 * The editor and the server agree on these, so what someone frames in the
 * editor is the shape and minimum sharpness the profile shows. Everything is in
 * the source image's own pixels, which keeps the maths the same whatever size
 * the editor happens to be drawn at on a phone or a desktop.
 */

export interface CropSpec {
  /** Width divided by height of the saved image and of every place it shows. */
  aspect: number;
  /** The saved image is at most this wide; smaller crops are saved as they are. */
  outputWidth: number;
  /**
   * The narrowest part of the original a crop may take. Zooming in further
   * would save a blurry enlargement of a few pixels.
   */
  minCropWidth: number;
  /** How far the saved aspect may drift from `aspect` through rounding. */
  tolerance: number;
}

/** A circle on every screen, cut from a square. */
export const AVATAR_CROP: CropSpec = { aspect: 1, outputWidth: 512, minCropWidth: 256, tolerance: 0.02 };

/** Three times as wide as tall, shown at that shape on the profile. */
export const COVER_CROP: CropSpec = { aspect: 3, outputWidth: 1500, minCropWidth: 750, tolerance: 0.02 };

export interface CropFrame {
  /** Centre of the crop, in source pixels. */
  centerX: number;
  centerY: number;
  /** 1 is the largest crop of this shape the image allows; higher is closer in. */
  zoom: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The largest crop of the spec's shape that fits inside the image, at zoom 1. */
function baseWidth(imageWidth: number, imageHeight: number, spec: CropSpec): number {
  return Math.min(imageWidth, imageHeight * spec.aspect);
}

/**
 * Whether an image is big enough to crop at all, and if not, why. A photo
 * smaller than the minimum crop would only ever produce a blurry picture.
 */
export function cropProblem(imageWidth: number, imageHeight: number, spec: CropSpec): string | null {
  const minHeight = Math.ceil(spec.minCropWidth / spec.aspect);
  if (baseWidth(imageWidth, imageHeight, spec) < spec.minCropWidth) {
    return spec.aspect === 1
      ? `Choose a photo at least ${spec.minCropWidth} pixels on its shortest side.`
      : `Choose a photo at least ${spec.minCropWidth} pixels wide and ${minHeight} pixels tall.`;
  }
  return null;
}

/** How far the editor lets someone zoom in on this image. Never below 1. */
export function maxZoom(imageWidth: number, imageHeight: number, spec: CropSpec): number {
  return Math.max(1, baseWidth(imageWidth, imageHeight, spec) / spec.minCropWidth);
}

/** The starting frame: centred, as wide as the image allows. */
export function initialFrame(imageWidth: number, imageHeight: number): CropFrame {
  return { centerX: imageWidth / 2, centerY: imageHeight / 2, zoom: 1 };
}

/**
 * Brings a frame back inside the rules: zoom between 1 and the maximum, and the
 * crop wholly inside the image, so there is never an empty edge.
 */
export function clampFrame(frame: CropFrame, imageWidth: number, imageHeight: number, spec: CropSpec): CropFrame {
  const zoom = Math.min(Math.max(frame.zoom, 1), maxZoom(imageWidth, imageHeight, spec));
  const width = baseWidth(imageWidth, imageHeight, spec) / zoom;
  const height = width / spec.aspect;
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  return {
    zoom,
    centerX: clamp(frame.centerX, width / 2, imageWidth - width / 2),
    centerY: clamp(frame.centerY, height / 2, imageHeight - height / 2),
  };
}

/** The part of the original a frame selects, in source pixels. */
export function cropRect(frame: CropFrame, imageWidth: number, imageHeight: number, spec: CropSpec): CropRect {
  const safe = clampFrame(frame, imageWidth, imageHeight, spec);
  const width = baseWidth(imageWidth, imageHeight, spec) / safe.zoom;
  const height = width / spec.aspect;
  return { x: safe.centerX - width / 2, y: safe.centerY - height / 2, width, height };
}

/** The size to save a crop at: its own size, capped at the spec's output width. */
export function outputSize(rect: CropRect, spec: CropSpec): { width: number; height: number } {
  const width = Math.round(Math.min(spec.outputWidth, rect.width));
  return { width, height: Math.round(width / spec.aspect) };
}

/**
 * Whether a stored image has the shape and size a crop with this spec saves.
 * The server checks a new profile picture or cover with this, so an image
 * that did not come through the editor cannot be shown in a shape it is not.
 */
export function fitsCropSpec(width: number, height: number, spec: CropSpec): boolean {
  if (width < Math.min(spec.minCropWidth, spec.outputWidth) - 1) return false;
  return Math.abs(width / height - spec.aspect) / spec.aspect <= spec.tolerance;
}
