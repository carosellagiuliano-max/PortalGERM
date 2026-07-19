import { describe, expect, it } from "vitest";

import { createSeededRandom } from "@/lib/utils/random";

describe("createSeededRandom", () => {
  it("replays the same sequence for the same string seed", () => {
    const first = createSeededRandom("swiss-talent-hub");
    const second = createSeededRandom("swiss-talent-hub");

    expect([first.next(), first.next(), first.integer(2, 7)]).toEqual([
      second.next(),
      second.next(),
      second.integer(2, 7),
    ]);
  });

  it("selects only members and rejects empty collections", () => {
    const random = createSeededRandom(42);
    expect(["a", "b", "c"]).toContain(random.pick(["a", "b", "c"]));
    expect(() => random.pick([])).toThrow(RangeError);
  });
});
