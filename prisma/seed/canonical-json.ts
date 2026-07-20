import { createHash } from "node:crypto";

export type CanonicalJsonPrimitive = boolean | null | number | string;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | Readonly<{ [key: string]: CanonicalJsonValue }>;

export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

/**
 * Serializes a JSON value with recursively sorted object keys. Array order is
 * preserved because it is semantically significant in JSON.
 */
export function canonicalJson(value: CanonicalJsonValue): string {
  return serializeCanonical(value, "$", new Set<object>());
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256CanonicalJson(value: CanonicalJsonValue): string {
  return sha256Utf8(canonicalJson(value));
}

function serializeCanonical(
  value: CanonicalJsonValue,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(`${path} must contain a finite number.`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value !== "object") {
    throw new CanonicalJsonError(`${path} contains a non-JSON value.`);
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError(`${path} contains a circular reference.`);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry, index) =>
          serializeCanonical(entry, `${path}[${index}]`, ancestors),
        )
        .join(",")}]`;
    }

    assertPlainDataObject(value, path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();

    return `{${keys
      .map((key) => {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new CanonicalJsonError(
            `${path}.${key} must be an enumerable data property.`,
          );
        }

        return `${JSON.stringify(key)}:${serializeCanonical(
          descriptor.value as CanonicalJsonValue,
          `${path}.${key}`,
          ancestors,
        )}`;
      })
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertPlainDataObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(`${path} must contain only plain objects.`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError(`${path} must not contain symbol properties.`);
  }
}
