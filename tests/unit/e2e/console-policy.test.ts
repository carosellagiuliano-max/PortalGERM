import { describe, expect, it } from "vitest";

import { isCriticalBrowserConsoleMessage } from "@/tests/e2e/console-policy";

describe("browser console policy", () => {
  it.each([
    "Content Security Policy blocked a script.",
    "Refused to connect to https://external.example.",
    "Uncaught TypeError: failed",
    "Hydration mismatch detected.",
    "Error occurred in the Server Components render.",
    "Failed to find Server Action 123.",
  ])("treats a security or runtime failure as critical: %s", (message) => {
    expect(isCriticalBrowserConsoleMessage(message)).toBe(true);
  });

  it.each([
    "DeprecationWarning: Calling client.query() while another query is active.",
    "Download the React DevTools for a better development experience.",
    "Image has width modified but not height.",
  ])("does not turn a development-only warning into a browser failure: %s", (message) => {
    expect(isCriticalBrowserConsoleMessage(message)).toBe(false);
  });
});
