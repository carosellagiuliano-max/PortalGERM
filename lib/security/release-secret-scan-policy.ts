const DATABASE_VARIABLES = new Set(["DATABASE_URL", "TEST_DATABASE_URL"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isSafeTrackedEnvironmentTemplateMatch(
  variable: string,
  value: string,
  path: string,
  publicTemplateValue?: string,
) {
  if (
    !DATABASE_VARIABLES.has(variable) ||
    (path !== ".env.example" && value !== publicTemplateValue)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    const query = [...url.searchParams.entries()];
    const safeSchemaQuery =
      query.length === 0 ||
      (query.length === 1 &&
        query[0]?.[0] === "schema" &&
        query[0]?.[1] === "public");
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
      url.username.length > 0 &&
      url.password.length > 0 &&
      url.pathname.length > 1 &&
      safeSchemaQuery &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
