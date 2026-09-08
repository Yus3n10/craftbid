import { describe, expect, it } from "vitest";
import { CRAFT_CATEGORIES } from "@raxtan/shared";
import { db } from "../db/query.js";
import { bufToUuid, newId, uuidToBuf } from "../db/ids.js";

describe("schema", () => {
  /**
   * The frontend renders category filters from the shared constant before it
   * has called the API, while postings reference the database rows. If the two
   * drift, a filter silently matches nothing.
   */
  it("keeps the seeded categories identical to the shared constant", async () => {
    const rows = await db.many<{ slug: string; name: string; description: string }>(
      `SELECT slug, name, description FROM craft_categories ORDER BY sort_order`,
    );

    expect(rows).toHaveLength(CRAFT_CATEGORIES.length);
    expect(rows.map((row) => row.slug)).toEqual(
      CRAFT_CATEGORIES.map((category) => category.slug),
    );
    for (const [index, row] of rows.entries()) {
      expect(row.name).toBe(CRAFT_CATEGORIES[index]!.name);
      expect(row.description).toBe(CRAFT_CATEGORIES[index]!.description);
    }
  });

  it("round-trips a UUID through RAW(16) unchanged", async () => {
    const id = newId();
    const row = await db.one<{ value: Buffer }>(
      `SELECT :id AS value FROM dual`,
      { id: uuidToBuf(id) },
    );
    expect(bufToUuid(row!.value)).toBe(id);
  });

  it("generates time-ordered ids so the primary key index stays dense", async () => {
    const ids = Array.from({ length: 50 }, () => newId());
    const sorted = [...ids].sort();
    // UUIDv7 leads with a millisecond timestamp, so generation order and
    // lexical order agree. UUIDv4 would fail this.
    expect(ids).toEqual(sorted);
  });
});
