export function normalizeErrorReference(value: unknown) {
  return typeof value === "string" && /^[a-z0-9._-]{1,128}$/i.test(value)
    ? value
    : undefined;
}
