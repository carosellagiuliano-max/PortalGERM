import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  resolveStripePaymentRuntime,
  readBoundedStripeWebhookBody,
  stripePaymentConfigurationDigest,
  StripePaymentProvider,
  StripePaymentProviderError,
} from "@/lib/providers/payments";

const ACCOUNT = "acct_phase33merchant";
const WEBHOOK_SECRET = "whsec_phase33webhook";

describe("Phase-33 Stripe mode identity", () => {
  it("resolves only the three explicit adapters and exposes no fallback", () => {
    expect(resolveStripePaymentRuntime("stripe_contract")).toMatchObject({
      adapterKey: "stripe_contract",
      activationMode: "ALLOWLIST",
      expectedLiveMode: false,
      providerMode: "CONTRACT",
    });
    expect(resolveStripePaymentRuntime("stripe_sandbox")).toMatchObject({
      adapterKey: "stripe_sandbox",
      activationMode: "SANDBOX",
      expectedLiveMode: false,
      providerMode: "SANDBOX",
    });
    expect(resolveStripePaymentRuntime("stripe_live")).toMatchObject({
      adapterKey: "stripe_live",
      activationMode: "LIVE",
      expectedLiveMode: true,
      providerMode: "LIVE",
    });
    expect(resolveStripePaymentRuntime("disabled")).toBeNull();
    expect(resolveStripePaymentRuntime("stripe")).toBeNull();
    expect(resolveStripePaymentRuntime(undefined)).toBeNull();
  });

  it("rejects cross-mode secret classes before creating a client", () => {
    expect(
      () =>
        new StripePaymentProvider({
          accountId: ACCOUNT,
          mode: "stripe_live",
          secretKey: "sk_test_phase33secret",
          webhookSecret: WEBHOOK_SECRET,
        }),
    ).toThrow(StripePaymentProviderError);
    expect(
      () =>
        new StripePaymentProvider({
          accountId: ACCOUNT,
          mode: "stripe_sandbox",
          secretKey: "sk_live_phase33secret",
          webhookSecret: WEBHOOK_SECRET,
        }),
    ).toThrow(StripePaymentProviderError);
  });

  it("binds ledger configuration evidence to mode and merchant account", () => {
    const sandbox = resolveStripePaymentRuntime("stripe_sandbox");
    const live = resolveStripePaymentRuntime("stripe_live");
    if (sandbox === null || live === null) {
      throw new Error("Expected explicit Stripe runtimes.");
    }
    const sandboxDigest = stripePaymentConfigurationDigest({
      providerAccountReference: ACCOUNT,
      runtime: sandbox,
    });
    expect(sandboxDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      stripePaymentConfigurationDigest({
        providerAccountReference: ACCOUNT,
        runtime: sandbox,
      }),
    ).toBe(sandboxDigest);
    expect(
      stripePaymentConfigurationDigest({
        providerAccountReference: "acct_phase33othermerchant",
        runtime: sandbox,
      }),
    ).not.toBe(sandboxDigest);
    expect(
      stripePaymentConfigurationDigest({
        providerAccountReference: ACCOUNT,
        runtime: live,
      }),
    ).not.toBe(sandboxDigest);
  });

  it("bounds a chunked webhook stream before signature parsing", async () => {
    const maximum = 256 * 1_024;
    const safeRequest = streamedRequest([
      new TextEncoder().encode("safe-"),
      new TextEncoder().encode("webhook"),
    ]);
    expect(safeRequest.headers.get("content-length")).toBeNull();
    await expect(readBoundedStripeWebhookBody(safeRequest)).resolves.toBe(
      "safe-webhook",
    );

    const oversizedRequest = streamedRequest([
      new Uint8Array(maximum),
      new Uint8Array(1),
    ]);
    expect(oversizedRequest.headers.get("content-length")).toBeNull();
    await expect(
      readBoundedStripeWebhookBody(oversizedRequest),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it.each([
    ["stripe_contract", "sk_test_phase33contract", false],
    ["stripe_sandbox", "sk_test_phase33sandbox", false],
    ["stripe_live", "sk_live_phase33live", true],
  ] as const)(
    "binds %s to the single merchant and event livemode",
    (mode, secretKey, liveMode) => {
      const stripe = new Stripe("sk_test_phase33signing");
      const provider = new StripePaymentProvider({
        accountId: ACCOUNT,
        mode,
        secretKey,
        webhookSecret: WEBHOOK_SECRET,
        stripeClient: stripe,
      });
      const payload = eventPayload({ liveMode });
      const signatureHeader = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      });
      expect(
        provider.verifyWebhook({ rawBody: payload, signatureHeader }),
      ).toMatchObject({
        liveMode,
        providerAccountReference: ACCOUNT,
      });

      const wrongModePayload = eventPayload({
        liveMode: !liveMode,
      });
      const wrongModeSignature = stripe.webhooks.generateTestHeaderString({
        payload: wrongModePayload,
        secret: WEBHOOK_SECRET,
      });
      expect(() =>
        provider.verifyWebhook({
          rawBody: wrongModePayload,
          signatureHeader: wrongModeSignature,
        }),
      ).toThrow(/livemode/iu);

      const connectedPayload = eventPayload({
        account: ACCOUNT,
        liveMode,
      });
      const connectedSignature = stripe.webhooks.generateTestHeaderString({
        payload: connectedPayload,
        secret: WEBHOOK_SECRET,
      });
      expect(() =>
        provider.verifyWebhook({
          rawBody: connectedPayload,
          signatureHeader: connectedSignature,
        }),
      ).toThrow(/connected-account/iu);
    },
  );
});

function eventPayload(input: {
  account?: string;
  liveMode: boolean;
}) {
  return JSON.stringify({
    id: `evt_phase33_${input.liveMode ? "live" : "test"}_${input.account ?? "none"}`,
    object: "event",
    ...(input.account === undefined ? {} : { account: input.account }),
    created: Math.floor(Date.now() / 1_000),
    livemode: input.liveMode,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_phase33mode",
        object: "checkout.session",
      },
    },
  });
}

function streamedRequest(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("http://phase33.invalid/webhook", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
