import "server-only";

import { createConnection } from "node:net";

import type { ServerEnvironment } from "@/lib/config/env-schema";

const probeTimeoutMilliseconds = 5_000;
const maximumProbeBodyBytes = 16 * 1024;

/**
 * Closed network probes for the isolated Phase-33 production-contract stack.
 * The exact service identities are deliberately repeated here so this helper
 * cannot be repurposed as an SSRF primitive by runtime configuration.
 */
export async function probePhase33ContractDependencies(
  environment: ServerEnvironment,
): Promise<void> {
  assertPhase33ContractTopology(environment);
  await Promise.all([
    probeHttpReady("http://provider-contract:8080/health/ready"),
    probeHttpReady("http://object-store:9000/minio/health/ready"),
    probeClamAvPing("scanner", 3310),
  ]);
}

export function assertPhase33ContractTopology(
  environment: ServerEnvironment,
): void {
  if (
    environment.APP_ENV !== "ci" ||
    environment.NODE_ENV !== "production" ||
    environment.EMAIL_PROVIDER_MODE !== "resend_contract" ||
    environment.EMAIL_PROVIDER_CONTRACT_ENDPOINT !==
      "http://provider-contract:8080/resend/emails" ||
    environment.PAYMENT_PROVIDER_MODE !== "stripe_contract" ||
    environment.STRIPE_CONTRACT_ENDPOINT !==
      "http://provider-contract:8080" ||
    environment.DOCUMENT_STORAGE_MODE !== "s3_contract" ||
    environment.DOCUMENT_STORAGE_ENDPOINT !== "http://object-store:9000" ||
    environment.DOCUMENT_STORAGE_BUCKET !== "phase33-documents" ||
    environment.DOCUMENT_SCANNER_MODE !== "clamav_contract" ||
    environment.DOCUMENT_SCANNER_HOST !== "scanner" ||
    environment.DOCUMENT_SCANNER_PORT !== 3310 ||
    environment.DOCUMENT_SCANNER_TLS
  ) {
    throw new Error("PHASE33_CONTRACT_TOPOLOGY_FORBIDDEN");
  }
}

async function probeHttpReady(url: string): Promise<void> {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(probeTimeoutMilliseconds),
  });
  const body = await readBoundedBody(response);
  if (response.status !== 200) {
    throw new Error("PHASE33_CONTRACT_HTTP_DEPENDENCY_UNAVAILABLE");
  }
  if (url.includes("provider-contract")) {
    const parsed = safeJson(body);
    if (
      parsed?.status !== "ready" ||
      parsed.providerMode !== "CONTRACT_STUB_ONLY"
    ) {
      throw new Error("PHASE33_CONTRACT_PROVIDER_IDENTITY_MISMATCH");
    }
  }
}

async function probeClamAvPing(host: string, port: number): Promise<void> {
  const response = await new Promise<string>((resolvePing, rejectPing) => {
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      rejectPing(new Error("PHASE33_CONTRACT_CLAMAV_TIMEOUT"));
    }, probeTimeoutMilliseconds);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
    };
    socket.once("connect", () => socket.write("zPING\0", "ascii"));
    socket.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 256) {
        cleanup();
        socket.destroy();
        rejectPing(new Error("PHASE33_CONTRACT_CLAMAV_RESPONSE_INVALID"));
        return;
      }
      chunks.push(Buffer.from(chunk));
      const joined = Buffer.concat(chunks, size);
      const end = joined.indexOf(0);
      if (end < 0) return;
      cleanup();
      socket.end();
      resolvePing(joined.subarray(0, end).toString("ascii").trim());
    });
    socket.once("error", () => {
      cleanup();
      rejectPing(new Error("PHASE33_CONTRACT_CLAMAV_UNAVAILABLE"));
    });
    socket.once("end", () => {
      const value = Buffer.concat(chunks, size).toString("ascii").trim();
      cleanup();
      resolvePing(value);
    });
  });
  if (response !== "PONG") {
    throw new Error("PHASE33_CONTRACT_CLAMAV_IDENTITY_MISMATCH");
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumProbeBodyBytes) {
        await reader.cancel("Phase-33 probe body exceeded its bound");
        throw new Error("PHASE33_CONTRACT_PROBE_BODY_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString(
    "utf8",
  );
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
