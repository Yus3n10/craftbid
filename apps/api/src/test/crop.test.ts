import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_CROP,
  COVER_CROP,
  clampFrame,
  cropProblem,
  cropRect,
  fitsCropSpec,
  initialFrame,
  maxZoom,
  outputSize,
} from "@craftbid/shared";
import { newId, uuidToBuf } from "../db/ids.js";
import { db } from "../db/query.js";
import { authHeaders, getTestApp, registerUser, resetData, type Session } from "./helpers.js";

/**
 * The crop rules the editor and the server share. The editor is exercised in
 * the browser tests; these hold the numbers.
 */
describe("crop maths", () => {
  it("starts with the largest centred crop of the right shape", () => {
    // A landscape photo for a round profile picture: the full height, centred.
    expect(cropRect(initialFrame(4000, 3000), 4000, 3000, AVATAR_CROP)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    // A tall photo for a cover: the full width, centred vertically.
    expect(cropRect(initialFrame(1200, 1600), 1200, 1600, COVER_CROP)).toEqual({ x: 0, y: 600, width: 1200, height: 400 });
  });

  it("never lets a crop leave the image, however far it is dragged", () => {
    const frame = clampFrame({ centerX: -9999, centerY: 99999, zoom: 2 }, 4000, 3000, AVATAR_CROP);
    const rect = cropRect(frame, 4000, 3000, AVATAR_CROP);
    expect(rect.x).toBe(0);
    expect(rect.y + rect.height).toBe(3000);
    expect(rect.width).toBe(1500);
  });

  it("stops zooming in before the crop gets narrower than the minimum", () => {
    expect(maxZoom(4000, 3000, AVATAR_CROP)).toBeCloseTo(3000 / 256);
    const tooClose = cropRect({ centerX: 2000, centerY: 1500, zoom: 1000 }, 4000, 3000, AVATAR_CROP);
    expect(tooClose.width).toBeCloseTo(256);
    // And never zooms out past the whole image.
    expect(cropRect({ centerX: 2000, centerY: 1500, zoom: 0.1 }, 4000, 3000, AVATAR_CROP).width).toBe(3000);
  });

  it("allows no zoom at all on an image that is only just big enough", () => {
    expect(maxZoom(256, 256, AVATAR_CROP)).toBe(1);
    expect(cropProblem(256, 256, AVATAR_CROP)).toBeNull();
  });

  it("refuses an image too small to make a sharp crop", () => {
    expect(cropProblem(255, 900, AVATAR_CROP)).toMatch(/256 pixels/);
    expect(cropProblem(3000, 240, COVER_CROP)).toMatch(/750 pixels wide and 250 pixels tall/);
    expect(cropProblem(700, 5000, COVER_CROP)).not.toBeNull();
  });

  it("saves at the crop's own size, capped, and at the exact shape", () => {
    expect(outputSize({ x: 0, y: 0, width: 3000, height: 3000 }, AVATAR_CROP)).toEqual({ width: 512, height: 512 });
    expect(outputSize({ x: 0, y: 0, width: 900, height: 300 }, COVER_CROP)).toEqual({ width: 900, height: 300 });
    const saved = outputSize({ x: 0, y: 0, width: 4000, height: 4000 / 3 }, COVER_CROP);
    expect(fitsCropSpec(saved.width, saved.height, COVER_CROP)).toBe(true);
  });

  it("recognises a stored image that could have come from the editor", () => {
    expect(fitsCropSpec(512, 512, AVATAR_CROP)).toBe(true);
    expect(fitsCropSpec(300, 300, AVATAR_CROP)).toBe(true);
    expect(fitsCropSpec(800, 600, AVATAR_CROP)).toBe(false);
    expect(fitsCropSpec(1500, 500, COVER_CROP)).toBe(true);
    expect(fitsCropSpec(1500, 1000, COVER_CROP)).toBe(false);
    expect(fitsCropSpec(120, 40, COVER_CROP)).toBe(false);
  });
});

describe("saving a profile picture or cover", () => {
  let user: Session;

  beforeEach(async () => {
    await resetData();
    user = await registerUser("artist");
  });

  async function image(width: number, height: number): Promise<string> {
    const id = newId();
    await db.run(
      `INSERT INTO images (id, owner_id, object_key, content_type, byte_size, width, height)
       VALUES (:id, :ownerId, :key, 'image/webp', 1024, :width, :height)`,
      { id: uuidToBuf(id), ownerId: uuidToBuf(user.id), key: `${user.id}/${id}.webp`, width, height },
    );
    return id;
  }

  async function save(payload: object) {
    const app = await getTestApp();
    return app.inject({ method: "PATCH", url: "/me/profile", headers: authHeaders(user), payload });
  }

  it("accepts a square profile picture and a 3:1 cover", async () => {
    expect((await save({ avatarImageId: await image(512, 512) })).statusCode).toBe(200);
    expect((await save({ coverImageId: await image(1500, 500) })).statusCode).toBe(200);
  });

  it("refuses a profile picture or cover in a shape the profile would distort", async () => {
    expect((await save({ avatarImageId: await image(800, 600) })).statusCode).toBe(400);
    expect((await save({ coverImageId: await image(1500, 1000) })).statusCode).toBe(400);
  });

  it("keeps saving other details when an older picture is already in place", async () => {
    // Set directly, as a picture from before the editor would have been.
    const older = await image(800, 600);
    await db.run(`UPDATE users SET avatar_image_id = :image WHERE id = :id`, { image: uuidToBuf(older), id: uuidToBuf(user.id) });
    expect((await save({ avatarImageId: older, bio: "Crochet to order" })).statusCode).toBe(200);
  });
});
