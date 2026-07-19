export type PostgresTarget = Readonly<{
  databaseName: string;
  hostname: string;
  identity: string;
  schemaName: string;
}>;

export function inspectPostgresTarget(value: string): PostgresTarget | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
      url.pathname.length <= 1
    ) {
      return undefined;
    }

    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (databaseName.length === 0) {
      return undefined;
    }

    const hostname = normalizeDatabaseHostname(url.hostname);
    const port = url.port || "5432";
    const schemaName = (url.searchParams.get("schema") ?? "public").toLowerCase();
    const identity = [
      hostname,
      port,
      databaseName.toLowerCase(),
      schemaName,
    ].join("|");

    return Object.freeze({ databaseName, hostname, identity, schemaName });
  } catch {
    return undefined;
  }
}

function normalizeDatabaseHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
    ? "loopback"
    : normalized;
}
