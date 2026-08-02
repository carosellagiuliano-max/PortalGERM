import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const port = parsePort(process.env.PORT ?? "8080");
const maximumBodyBytes = 256 * 1024;
const counters = new Map<string, number>();
const resendApiKey = requiredCredential(
  "CONTRACT_RESEND_API_KEY",
  /^re_[A-Za-z0-9_-]{8,}$/u,
);
const stripeSecretKey = requiredCredential(
  "CONTRACT_STRIPE_SECRET_KEY",
  /^sk_test_[A-Za-z0-9]{8,}$/u,
);

const server = createServer(async (request, response) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "contract.invalid"}`,
  );

  if (
    request.method === "GET" &&
    (url.pathname === "/health/live" || url.pathname === "/health/ready")
  ) {
    return json(response, 200, {
      status: "ready",
      providerMode: "CONTRACT_STUB_ONLY",
    });
  }

  try {
    if (request.method === "GET" && url.pathname === "/v1/account") {
      if (request.headers.authorization !== `Bearer ${stripeSecretKey}`) {
        return json(response, 401, { status: "contract_unauthorized" });
      }
      count("stripe-account-health");
      if (applyFailureScenario(request, response)) return;
      return json(response, 200, {
        id: process.env.CONTRACT_STRIPE_ACCOUNT_ID ?? "acct_phase33contract",
        object: "account",
        livemode: false,
      });
    }

    if (request.method === "POST" && url.pathname === "/resend/emails") {
      if (
        request.headers.authorization !== `Bearer ${resendApiKey}` ||
        !boundedHeader(request, "idempotency-key", 256) ||
        !isExpectedContentType(request, "application/json")
      ) {
        return json(response, 401, { status: "contract_unauthorized" });
      }
      const body = await readBoundedBody(request);
      count("resend");
      if (applyFailureScenario(request, response)) return;
      return json(response, 200, {
        id: `contract_email_${digest(body).slice(0, 24)}`,
      });
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/checkout/sessions" ||
        url.pathname === "/v1/refunds")
    ) {
      if (
        request.headers.authorization !== `Bearer ${stripeSecretKey}` ||
        !boundedHeader(request, "idempotency-key", 256) ||
        !isExpectedContentType(request, "application/x-www-form-urlencoded")
      ) {
        return json(response, 401, { status: "contract_unauthorized" });
      }
      const body = await readBoundedBody(request);
      count(
        url.pathname.includes("refunds") ? "stripe-refund" : "stripe-checkout",
      );
      if (applyFailureScenario(request, response)) return;
      const reference = digest(body).slice(0, 24);
      if (url.pathname.endsWith("/refunds")) {
        return json(response, 200, {
          id: `re_contract_${reference}`,
          amount: 100,
          currency: "chf",
          status: "succeeded",
        });
      }
      return json(response, 200, {
        id: `cs_contract_${reference}`,
        object: "checkout.session",
        url: `https://checkout.contract.invalid/session/${reference}`,
      });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/company/register/")
    ) {
      count("company-register");
      if (applyFailureScenario(request, response)) return;
      const reference = digest(url.pathname).slice(0, 16);
      return json(response, 200, {
        status: "MATCHED_CONTRACT_FIXTURE",
        reference: `company_contract_${reference}`,
      });
    }

    if (request.method === "GET" && url.pathname === "/contract/summary") {
      return json(response, 200, {
        providerMode: "CONTRACT_STUB_ONLY",
        counters: Object.fromEntries([...counters.entries()].sort()),
      });
    }

    return json(response, 404, { status: "not_found" });
  } catch (error) {
    const status = error instanceof BodyLimitError ? 413 : 400;
    return json(response, status, { status: "invalid_contract_request" });
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-provider-contract-stub",
      providerMode: "CONTRACT_STUB_ONLY",
      status: "READY",
    })}\n`,
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function applyFailureScenario(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const scenario = request.headers["x-phase33-contract-scenario"];
  if (typeof scenario !== "string" || scenario === "success") return false;
  const statuses: Readonly<Record<string, number>> = Object.freeze({
    invalid: 400,
    unauthorized: 401,
    conflict: 409,
    rate_limited: 429,
    unavailable: 500,
  });
  const status = statuses[scenario];
  if (status !== undefined) {
    json(response, status, { status: `contract_${scenario}` });
    return true;
  }
  if (scenario === "timeout") {
    setTimeout(
      () => json(response, 504, { status: "contract_timeout" }),
      12_000,
    ).unref();
    return true;
  }
  json(response, 400, { status: "unknown_contract_scenario" });
  return true;
}

async function readBoundedBody(request: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    total += value.byteLength;
    if (total > maximumBodyBytes) throw new BodyLimitError();
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-phase33-provider-mode": "CONTRACT_STUB_ONLY",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function count(key: string) {
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

function boundedHeader(
  request: IncomingMessage,
  name: string,
  maximumLength: number,
) {
  const value = request.headers[name];
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength
  );
}

function isExpectedContentType(request: IncomingMessage, expected: string) {
  const value = request.headers["content-type"];
  return typeof value === "string" && value.split(";", 1)[0] === expected;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parsePort(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error("PORT_INVALID");
  }
  return parsed;
}

function requiredCredential(name: string, pattern: RegExp) {
  const value = process.env[name];
  if (value === undefined || !pattern.test(value)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

class BodyLimitError extends Error {}
