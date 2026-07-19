export const CORRELATION_ID_HEADER = "x-correlation-id";

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCorrelationId() {
  return globalThis.crypto.randomUUID();
}

export function normalizeCorrelationId(value: string | null | undefined) {
  if (value && CORRELATION_ID_PATTERN.test(value)) {
    return value.toLowerCase();
  }

  return createCorrelationId();
}
