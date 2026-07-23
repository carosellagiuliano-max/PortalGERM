export const BUILD_IDENTIFIER_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const LOCAL_BUILD_IDENTIFIER = "local-development";

export function getBuildIdentifier(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const candidates = [
    environment.APP_BUILD_ID,
    environment.VERCEL_GIT_COMMIT_SHA,
    environment.GITHUB_SHA,
    environment.SOURCE_VERSION,
    environment.npm_package_version,
  ];

  return (
    candidates.find(
      (candidate): candidate is string =>
        candidate !== undefined &&
        BUILD_IDENTIFIER_PATTERN.test(candidate),
    ) ?? LOCAL_BUILD_IDENTIFIER
  );
}
