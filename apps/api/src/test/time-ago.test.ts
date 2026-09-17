import { describe, expect, it } from "vitest";
import { daysAgo, shortAgo } from "@craftbid/shared";

// 06:00 on 15 September in Manila, which is 22:00 on the 14th in UTC.
const NOW = Date.parse("2026-09-14T22:00:00.000Z");

describe("daysAgo", () => {
  it("never goes negative when the server's clock is ahead of the phone's", () => {
    expect(daysAgo("2026-09-14T22:00:05.000Z", { now: NOW })).toBe("Today");
    // Across midnight in Manila: the phone reads 23:59:58, the server stamped
    // 00:00:03 on the next day.
    expect(daysAgo("2026-09-14T16:00:03.000Z", { now: Date.parse("2026-09-14T15:59:58.000Z") })).toBe("Today");
  });

  it("counts calendar days in Manila, not 24-hour windows", () => {
    // 23:00 on the 14th in Manila, only seven hours earlier.
    expect(daysAgo("2026-09-14T15:00:00.000Z", { now: NOW })).toBe("Yesterday");
    // 00:30 on the 15th in Manila.
    expect(daysAgo("2026-09-14T16:30:00.000Z", { now: NOW })).toBe("Today");
  });

  it("counts days, then shows a date or months", () => {
    expect(daysAgo("2026-09-10T22:00:00.000Z", { now: NOW })).toBe("4 days ago");
    expect(daysAgo("2026-07-01T00:00:00.000Z", { now: NOW })).toBe("Jul 1, 2026");
    expect(daysAgo("2026-07-01T00:00:00.000Z", { now: NOW, older: "months" })).toBe("2 months ago");
  });
});

describe("shortAgo", () => {
  it("treats a timestamp slightly in the future as just now", () => {
    expect(shortAgo("2026-09-14T22:00:30.000Z", NOW)).toBe("just now");
  });

  it("steps through minutes, hours and days", () => {
    expect(shortAgo("2026-09-14T21:55:00.000Z", NOW)).toBe("5m");
    expect(shortAgo("2026-09-14T19:00:00.000Z", NOW)).toBe("3h");
    expect(shortAgo("2026-09-12T22:00:00.000Z", NOW)).toBe("2d");
  });
});
