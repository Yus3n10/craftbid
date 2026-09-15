/**
 * Shrinks a photo in the browser before it is sent in chat.
 *
 * A phone photo is often 3 to 5 MB at 4000 pixels wide. Chat shows it on a
 * phone screen, so it is scaled to at most 1600 pixels on its longest side and
 * re-encoded, which usually leaves 150 to 300 KB. That is what keeps uploads
 * quick on mobile data and storage within the free tier. The server checks and
 * re-encodes it again either way, so nothing here is trusted.
 */

/** Refused before reading: decoding a huge file can stall a small phone. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1600;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the camera's rotation, so a portrait photo stays upright.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Older Safari refuses the options object; fall back to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A photo that cannot be sent, with a reason written for the person sending it. */
export class ImagePreparationError extends Error {}

export async function compressForChat(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new ImagePreparationError("Only images can be sent.");
  if (file.size > MAX_INPUT_BYTES) throw new ImagePreparationError("That image is over 15 MB. Choose a smaller one.");

  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new ImagePreparationError("That image could not be opened. Try a JPEG or PNG.");
  }

  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImagePreparationError("That image could not be prepared.");
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    // A browser that cannot encode WebP hands back a PNG instead, which would
    // be bigger than what it was given; JPEG is the fallback that shrinks.
    const webp = await encode(canvas, "image/webp", 0.8);
    if (webp && webp.type === "image/webp") return webp;
    const jpeg = await encode(canvas, "image/jpeg", 0.82);
    if (!jpeg) throw new ImagePreparationError("That image could not be prepared.");
    return jpeg;
  } finally {
    decoded.close();
  }
}
