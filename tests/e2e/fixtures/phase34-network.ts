const PROJECT_SOURCE_IPS = Object.freeze({
  "chromium-phase34": "198.51.100.31",
  "chromium-phase34-trust": "198.51.100.34",
  "firefox-phase34": "198.51.100.32",
  "webkit-phase34": "198.51.100.33",
});

export function phase34LocalSourceIp(projectName: string) {
  const sourceIp =
    PROJECT_SOURCE_IPS[projectName as keyof typeof PROJECT_SOURCE_IPS];
  if (sourceIp === undefined) {
    throw new Error(`PHASE34_UNKNOWN_BROWSER_PROJECT:${projectName}`);
  }
  return sourceIp;
}
