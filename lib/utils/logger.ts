const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|secret|token|authorization|cookie|credential|session|api.?key|encryption.?key|hash.?key|lookup.?key|reveal.?key|confirmation.?key|keyring|database.?url|connection.?string|email|phone|message|content|cv|stack|cause|body|note|address|(?:^|_)(?:ip|ipaddress|sourceip)(?:$|_))/i;
const SENSITIVE_VALUE_PATTERN =
  /(password|passphrase|secret|token|authorization|cookie|credential|bearer|postgres(?:ql)?:\/\/)/i;
const EMAIL_VALUE_PATTERN =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu;
const IPV4_VALUE_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/u;
const IPV6_VALUE_PATTERN = /^(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]+$/iu;
const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_IDENTIFIER_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,199}$/u;
const SAFE_ROUTE_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/iu;
const SAFE_ROUTE_PARAMETER_PATTERN =
  /^(?:\[[a-z][a-z0-9_]*\]|\[\.\.\.[a-z][a-z0-9_]*\]|\[\[\.\.\.[a-z][a-z0-9_]*\]\])$/iu;
const SAFE_STATIC_ROUTE_TEMPLATES = new Set([
  "/",
  "/favicon.ico",
  "/health/live",
  "/health/ready",
  "/logout",
  "/reset-password",
  "/robots.txt",
  "/session/clear",
  "/sitemap.xml",
]);
const SAFE_ERROR_NAMES = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const ALLOWED_METADATA_KEYS = new Set([
  "applicationId",
  "count",
  "durationMs",
  "entityId",
  "entityType",
  "error",
  "errorCode",
  "errorReference",
  "incidentId",
  "leadId",
  "method",
  "operation",
  "reasonCode",
  "referenceSource",
  "routePath",
  "routeTemplate",
  "routeType",
  "routerKind",
  "status",
]);

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMetadata = Readonly<Record<string, unknown>>;

export type StructuredLogRecord = Readonly<{
  timestamp: string;
  level: LogLevel;
  event: string;
  environment: string;
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
        environment: resolveLogEnvironment(),
        ...sanitizeCorrelationId(correlationId),
        ...(metadata ? { metadata: sanitizeLogMetadata(metadata) } : {}),
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

export function sanitizeLogMetadata(metadata: LogMetadata) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(metadata).flatMap(([key, value]) => {
        if (!ALLOWED_METADATA_KEYS.has(key)) return [];
        const sanitized = sanitizeAllowedMetadataValue(key, value);
        return sanitized === undefined ? [] : [[key, sanitized]];
      }),
    ),
  );
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
      name: sanitizeErrorName(value.name),
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
    if (isSensitiveLogString(value)) {
      return REDACTED;
    }
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}

function sanitizeEventName(event: string) {
  return /^[a-z0-9_.-]{1,80}$/i.test(event) ? event : "invalid_event_name";
}

function sanitizeAllowedMetadataValue(key: string, value: unknown) {
  if (key === "error") {
    return value instanceof Error
      ? { name: sanitizeErrorName(value.name), message: "Internal error" }
      : undefined;
  }
  if (key === "count" || key === "durationMs") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  }
  if (key === "routePath" || key === "routeTemplate") {
    return typeof value === "string" && isSafeRouteTemplate(value)
      ? value
      : REDACTED;
  }
  if (typeof value !== "string" || isSensitiveLogString(value)) {
    return value === undefined ? undefined : REDACTED;
  }
  if (key === "method") {
    return /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/u.test(value)
      ? value
      : REDACTED;
  }
  return SAFE_IDENTIFIER_PATTERN.test(value) ? value : REDACTED;
}

function isSafeRouteTemplate(value: string) {
  if (value.length > 256 || value.includes("//")) {
    return false;
  }
  if (SAFE_STATIC_ROUTE_TEMPLATES.has(value)) {
    return true;
  }

  const segments = value.split("/");
  if (segments[0] !== "" || segments.length < 2) {
    return false;
  }

  let containsParameter = false;
  for (const segment of segments.slice(1)) {
    if (SAFE_ROUTE_PARAMETER_PATTERN.test(segment)) {
      containsParameter = true;
      continue;
    }
    if (!SAFE_ROUTE_SEGMENT_PATTERN.test(segment)) {
      return false;
    }
  }
  return containsParameter;
}

function sanitizeCorrelationId(correlationId: string | undefined) {
  return correlationId !== undefined &&
    CORRELATION_ID_PATTERN.test(correlationId)
    ? { correlationId: correlationId.toLowerCase() }
    : {};
}

function sanitizeErrorName(name: string) {
  return SAFE_ERROR_NAMES.has(name) && !isSensitiveLogString(name)
    ? name
    : "Error";
}

function isSensitiveLogString(value: string) {
  return (
    SENSITIVE_VALUE_PATTERN.test(value) ||
    EMAIL_VALUE_PATTERN.test(value) ||
    IPV4_VALUE_PATTERN.test(value) ||
    IPV6_VALUE_PATTERN.test(value)
  );
}

function resolveLogEnvironment() {
  const candidate = process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown";
  return /^(?:local|ci|preview|staging|production|development|test)$/u.test(
    candidate,
  )
    ? candidate
    : "unknown";
}
