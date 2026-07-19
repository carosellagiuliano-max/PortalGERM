import { z } from "zod";

export const trimmedString = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export const uuidSchema = z.uuid();
export const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());

export const swissPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+41[1-9]\d{8}$/, "Use the international Swiss format +41XXXXXXXXX.");

export const swissCantonCodeSchema = z.enum([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU",
  "LU", "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR",
  "VD", "VS", "ZG", "ZH",
]);

export const wholeChfSchema = z.number().int().positive().max(10_000_000);
export const percentageSchema = z.number().int().min(0).max(100);

export function isSafeAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function addOrderedRangeIssue(
  context: z.RefinementCtx,
  minimum: number | undefined,
  maximum: number | undefined,
  maximumPath: string,
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    context.addIssue({
      code: "custom",
      path: [maximumPath],
      message: "Maximum must be greater than or equal to minimum.",
    });
  }
}
