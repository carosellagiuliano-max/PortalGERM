import { describe, expect, it } from "vitest";

import { loginSchema } from "@/lib/validation/auth";
import { toDeChValidationErrors } from "@/lib/validation/errors";

describe("de-CH validation mapping", () => {
  it("maps stable issue codes without reflecting sensitive input", () => {
    const canary = "not-an-email-sensitive-canary";
    const result = loginSchema.safeParse({ email: canary, password: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = toDeChValidationErrors(result.error);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "email", message: "Die Eingabe hat kein gültiges Format." }),
      expect.objectContaining({ field: "password" }),
    ]));
    expect(JSON.stringify(errors)).not.toContain(canary);
  });
});
