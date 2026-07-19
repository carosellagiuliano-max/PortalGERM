import { cn } from "@/lib/utils/cn";
import { describe, expect, it } from "vitest";

describe("cn", () => {
  it("combines conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2 text-sm", false && "hidden", ["px-4", "font-bold"])).toBe(
      "text-sm px-4 font-bold",
    );
  });
});
