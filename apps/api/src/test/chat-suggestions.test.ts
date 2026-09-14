import { expect, it } from "vitest";
import { CHAT_SUGGESTIONS } from "@craftbid/shared";

it("offers at most three chat suggestions per role and stage", () => {
  // More than three pushed the row off the side of a phone screen.
  for (const stages of Object.values(CHAT_SUGGESTIONS)) {
    for (const list of Object.values(stages)) expect(list.length).toBeLessThanOrEqual(3);
  }
});
