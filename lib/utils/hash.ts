import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type VersionedHashKey = Readonly<{
  version: string;
  secret: string;
}>;

export type VersionedHashKeyringEntry = Readonly<{
  version: string;
  key: Readonly<{
    withValue<TResult>(consumer: (value: string) => TResult): TResult;
  }>;
}>;

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function normalizeIpv4(ip: string): string {
  return ip.split(".").map((octet) => String(Number(octet))).join(".");
}

function ipv4TailToHextets(tail: string): readonly [string, string] {
  const bytes = tail.split(".").map(Number);
  if (bytes.length !== 4) {
    throw new TypeError("Invalid embedded IPv4 address.");
  }
  return [
    ((bytes[0] as number) * 256 + (bytes[1] as number)).toString(16),
    ((bytes[2] as number) * 256 + (bytes[3] as number)).toString(16),
  ];
}

function normalizeIpv6(ip: string): string {
  const lower = ip.toLowerCase();
  const embeddedIpv4 = lower.includes(".");
  let expandedInput = lower;

  if (embeddedIpv4) {
    const lastColon = lower.lastIndexOf(":");
    const [first, second] = ipv4TailToHextets(lower.slice(lastColon + 1));
    expandedInput = `${lower.slice(0, lastColon)}:${first}:${second}`;
  }

  const halves = expandedInput.split("::");
  if (halves.length > 2) {
    throw new TypeError("Invalid IPv6 address.");
  }

  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    throw new TypeError("Invalid IPv6 address.");
  }

  return [...left, ...Array.from({ length: missing }, () => "0"), ...right]
    .map((hextet) => Number.parseInt(hextet, 16).toString(16))
    .join(":");
}

export function normalizeIpAddress(ip: string): string {
  const candidate = ip.trim();
  const version = isIP(candidate);
  if (version === 4) {
    return normalizeIpv4(candidate);
  }
  if (version === 6) {
    return normalizeIpv6(candidate);
  }
  throw new TypeError("IP address must be a valid IPv4 or IPv6 literal.");
}

export function hashIp(ip: string, key: VersionedHashKey): string {
  if (!VERSION_PATTERN.test(key.version)) {
    throw new TypeError("Hash key version is invalid.");
  }
  if (key.secret.length === 0) {
    throw new TypeError("Hash key secret must not be empty.");
  }

  const digest = createHmac("sha256", key.secret)
    .update(normalizeIpAddress(ip), "utf8")
    .digest("hex");
  return `${key.version}:${digest}`;
}

export function hashIpWithFirstKey(
  ip: string,
  keyring: readonly VersionedHashKeyringEntry[],
  keyringName: string,
): string {
  const writer = keyring[0];
  if (writer === undefined) {
    throw new TypeError(`${keyringName} requires an active writer key.`);
  }
  return writer.key.withValue((secret) =>
    hashIp(ip, { version: writer.version, secret }),
  );
}
