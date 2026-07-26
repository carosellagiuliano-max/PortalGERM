import { Buffer } from "node:buffer";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  EmailDeliveryFailure,
  type EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { ResendSandboxEmailProvider } from "@/lib/providers/email/resend-email-provider";
import { parseResendDeliveryEvent } from "@/lib/providers/email/resend-event";

const argumentsMap = parseArguments(process.argv.slice(2));
if (argumentsMap.mode !== "sandbox") {
  throw new Error("Only the isolated sandbox contract is available in Phase 20.");
}
const requestedScenarios = argumentsMap.scenario.split(",").filter(Boolean);
const expectedScenarios = [
  "deliver",
  "duplicate",
  "bounce",
  "429",
  "500",
  "timeout",
  "bad-config",
];
if (
  requestedScenarios.length !== expectedScenarios.length ||
  expectedScenarios.some((scenario) => !requestedScenarios.includes(scenario))
) {
  throw new Error(
    `The complete scenario set is required: ${expectedScenarios.join(",")}.`,
  );
}

const results: Array<Readonly<{ scenario: string; status: "PASS" }>> = [];
const request = deliveryRequest();
const environment = smokeEnvironment();

await run("deliver", async () => {
  const provider = providerFor(async () =>
    jsonResponse(200, { id: "sandbox-receipt-1" }),
  );
  const receipt = await provider.deliver(request);
  assert(receipt.providerReceipt === "sandbox-receipt-1");
});

await run("duplicate", async () => {
  const provider = providerFor(async () =>
    jsonResponse(200, { id: "sandbox-stable-receipt" }),
  );
  const first = await provider.deliver(request);
  const second = await provider.deliver(request);
  assert(first.providerReceipt === second.providerReceipt);
});

await run("bounce", async () => {
  const event = parseResendDeliveryEvent({
    type: "email.bounced",
    created_at: "2026-07-26T12:00:00.000Z",
    data: {
      email_id: "sandbox-bounce-receipt",
      to: ["bounced@resend.dev"],
      bounce: { type: "Permanent", subType: "MessageRejected" },
    },
  });
  assert(event?.kind === "BOUNCED");
  assert(event.recipientHashes.length === 1);
  assert(!JSON.stringify(event).includes("bounced@resend.dev"));
});

await run("429", () =>
  expectFailure(
    providerFor(async () =>
      jsonResponse(429, { name: "rate_limit_exceeded" }),
    ),
    request,
    "TRANSIENT",
  ),
);

await run("500", () =>
  expectFailure(
    providerFor(async () => jsonResponse(500, { name: "internal_error" })),
    request,
    "TRANSIENT",
  ),
);

await run("timeout", () =>
  expectFailure(
    providerFor(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
    { ...request, timeoutMilliseconds: 100 },
    "TIMEOUT",
  ),
);

await run("bad-config", async () => {
  let failed = false;
  try {
    new ResendSandboxEmailProvider({
      apiKey: undefined,
      from: undefined,
    });
  } catch (error) {
    failed =
      error instanceof EmailDeliveryFailure &&
      error.kind === "CONFIGURATION";
  }
  assert(failed);
});

console.info(
  JSON.stringify({
    mode: "provider-contract-sandbox",
    externalNetwork: false,
    activation: "DISABLED",
    expectedExitCode: 1,
    scenarios: results,
  }),
);

// The complete acceptance command deliberately contains the invalid-secret
// boot probe. A non-zero exit is the evidence that this configuration cannot
// silently start or fall back to a mock provider.
process.exitCode = 1;

async function run(scenario: string, operation: () => Promise<void>) {
  await operation();
  results.push(Object.freeze({ scenario, status: "PASS" }));
}

function providerFor(
  fetchImplementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  return new ResendSandboxEmailProvider({
    apiKey: environment.secrets.emailProvider,
    from: environment.EMAIL_FROM,
    fetch: fetchImplementation,
  });
}

async function expectFailure(
  provider: ResendSandboxEmailProvider,
  input: EmailDeliveryRequest,
  kind: EmailDeliveryFailure["kind"],
) {
  try {
    await provider.deliver(input);
    throw new Error("Expected provider failure.");
  } catch (error) {
    assert(error instanceof EmailDeliveryFailure && error.kind === kind);
  }
}

function deliveryRequest(): EmailDeliveryRequest {
  return Object.freeze({
    to: "delivered@resend.dev",
    templateKey: "identity_verification",
    subject: "E-Mail-Adresse bei SwissTalentHub bestätigen",
    text: "Isolierter Phase-20-Providervertrag ohne reale Person.",
    templateData: Object.freeze({}),
    idempotencyKey: "phase20-contract-deliver-1",
    timeoutMilliseconds: 500,
  });
}

function smokeEnvironment() {
  const key = (seed: number) => Buffer.alloc(32, seed).toString("base64");
  return parseEnvironment({
    APP_ENV: "local",
    NODE_ENV: "test",
    DATABASE_URL:
      "postgresql://contract:contract@127.0.0.1:5434/swisstalenthub_contract?schema=public",
    TEST_DATABASE_URL:
      "postgresql://contract_test:contract@127.0.0.1:5435/swisstalenthub_contract_test?schema=public",
    APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub",
    APP_BUILD_ID: "phase20-provider-contract",
    SESSION_SECRET: key(1),
    AUDIT_IP_HASH_KEYS: `audit-v1:${key(2)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `lookup-v1:${key(3)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `opaque-v1:${key(4)}`,
    REVEAL_CONFIRMATION_KEYS: `confirm-v1:${key(5)}`,
    PII_REVEAL_KEYS: `reveal-v1:${key(6)}`,
    NOTIFICATION_DELIVERY_KEYS: `notification-v1:${key(7)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    IDENTITY_VERIFICATION_ENFORCEMENT: "false",
    LOGIN_EMAIL_CHANGE: "false",
    NOTIFICATION_OUTBOX_PRODUCERS: "true",
    EMAIL_PROVIDER_MODE: "resend_sandbox",
    NOTIFICATION_DISPATCH: "command",
    OPTIONAL_EMAIL: "false",
    DELIVERY_REPLAY: "false",
    EMAIL_FROM: "SwissTalentHub <sandbox@resend.dev>",
    EMAIL_PROVIDER_API_KEY: "re_contract_only_not_a_live_secret",
    ABUSE_REPORT_ADMIN_EMAILS: "admin@demo.ch",
    LOG_LEVEL: "error",
  });
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseArguments(values: readonly string[]) {
  const result: Record<string, string> = {};
  for (const value of values) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (match === null) throw new Error(`Unknown argument: ${value}`);
    result[match[1]!] = match[2]!;
  }
  return Object.freeze({
    mode: result.mode ?? "",
    scenario: result.scenario ?? "",
  });
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("Phase-20 provider smoke assertion failed.");
}
