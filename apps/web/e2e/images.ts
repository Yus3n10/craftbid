import { randomBytes } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";

/**
 * A real PNG, built by hand so the web package needs no image library. Each
 * call has different bytes, as two real receipts do: Craftbid refuses a
 * receipt file it has already seen, including one from an earlier test run.
 *
 * The difference is a 16 by 16 block of random pixels in the corner.
 */
export function receiptPng(red: number): Buffer {
  const noise = randomBytes(16 * 16 * 3);
  const width = 240;
  const height = 320;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    rows[start] = 0; // no filter
    for (let x = 0; x < width; x++) {
      if (x < 16 && y < 16) {
        noise.copy(rows, start + 1 + x * 3, (y * 16 + x) * 3, (y * 16 + x) * 3 + 3);
        continue;
      }
      const band = (x + y) % 40 < 20;
      rows[start + 1 + x * 3] = band ? red : 250;
      rows[start + 2 + x * 3] = band ? 90 : 250;
      rows[start + 3 + x * 3] = band ? 160 : 250;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
