const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|secret|token|authorization|cookie|credential|session|api.?key|encryption.?key|hash.?key|lookup.?key|reveal.?key|confirmation.?key|keyring|database.?url|connection.?string|email|phone|message|content|cv)/i;

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMetadata = Readonly<Record<string, unknown>>;

export type StructuredLogRecord = Readonly<{
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  metadata?: unknown;
}>;

type LogSink = (record: StructuredLogRecord) => void;

const defaultSink: LogSink = (record) => {
  const serialized = JSON.stringify(record);
  if (record.level === "error") {
    console.error(serialized);
  } else if (record.level === "warn") {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
};

export function createLogger(sink: LogSink = defaultSink) {
  const write = (
    level: LogLevel,
    event: string,
    metadata?: LogMetadata,
    correlationId?: string,
  ) => {
    sink(
      Object.freeze({
        timestamp: new Date().toISOString(),
        level,
        event: sanitizeEventName(event),
        ...(correlationId ? { correlationId } : {}),
        ...(metadata ? { metadata: redactLogValue(metadata) } : {}),
      }),
    );
  };

  return Object.freeze({
    debug: (event: string, metadata?: LogMetadata, correlationId?: string) =>
      write("debug", event, metadata, correlationId),
    info: (event: string, metadata?: LogMetadata, correlationId?: string) =>
      write("info", event, metadata, correlationId),
    warn: (event: string, metadata?: LogMetadata, correlationId?: string) =>
      write("warn", event, metadata, correlationId),
    error: (event: string, metadata?: LogMetadata, correlationId?: string) =>
      write("error", event, metadata, correlationId),
  });
}

export function redactLogValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: "Internal error",
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return value.map((entry) => redactLogValue(entry, "", seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey, seen),
      ]),
    );
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}

function sanitizeEventName(event: string) {
  return /^[a-z0-9_.-]{1,80}$/i.test(event) ? event : "invalid_event_name";
}
