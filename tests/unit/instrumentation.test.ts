import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "@/instrumentation";

describe("request error instrumentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the proxy correlation ID and server digest without raw error data", async () => {
    const correlationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";
    const secretCanary = "raw-request-error-secret-canary";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = Object.assign(new Error(secretCanary), {
      digest: "next-error-digest-123",
    });

    await onRequestError(
      error,
      {
        path: `/reset-password?token=${secretCanary}`,
        method: "GET",
        headers: { "x-correlation-id": correlationId },
      },
      {
        routerKind: "App Router",
        routePath: "/reset-password",
        routeType: "render",
        revalidateReason: undefined,
      },
    );

    expect(consoleError).toHaveBeenCalledOnce();
    const serializedLog = String(consoleError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain('"event":"request_failed"');
    expect(serializedLog).toContain(`"correlationId":"${correlationId}"`);
    expect(serializedLog).toContain("next-error-digest-123");
    expect(serializedLog).toContain("/reset-password");
    expect(serializedLog).not.toContain(secretCanary);
  });

  it.each([
    [
      "/invite/[token]",
      "/invite/raw-invite-token-canary",
      "raw-invite-token-canary",
    ],
    ["/support/[id]", "/support/raw-case-id-canary", "raw-case-id-canary"],
    [
      "/alerts/unsubscribe/[token]",
      "/alerts/unsubscribe/raw-alert-token-canary",
      "raw-alert-token-canary",
    ],
    [
      "/mock/checkout/[orderId]",
      "/mock/checkout/raw-order-id-canary",
      "raw-order-id-canary",
    ],
  ])(
    "logs the route template %s instead of a sensitive dynamic segment",
    async (routePath, requestPath, canary) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await onRequestError(
        Object.assign(new Error(canary), { digest: "safe-digest" }),
        {
          path: requestPath,
          method: "GET",
          headers: {},
        },
        {
          routerKind: "App Router",
          routePath,
          routeType: "render",
          revalidateReason: undefined,
        },
      );

      const serializedLog = String(consoleError.mock.calls[0]?.[0]);
      expect(serializedLog).toContain(`"routePath":"${routePath}"`);
      expect(serializedLog).not.toContain(requestPath);
      expect(serializedLog).not.toContain(canary);
    },
  );
});
