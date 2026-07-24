const CRITICAL_BROWSER_CONSOLE_PATTERNS = Object.freeze([
  /content security policy/iu,
  /refused to (?:execute|load|connect|frame)/iu,
  /uncaught/iu,
  /hydration (?:failed|error|mismatch)/iu,
  /error occurred in the server components render/iu,
  /failed to find server action/iu,
]);

export function isCriticalBrowserConsoleMessage(value: string) {
  return CRITICAL_BROWSER_CONSOLE_PATTERNS.some((pattern) =>
    pattern.test(value),
  );
}
