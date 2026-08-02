import { createHash } from "node:crypto";

export type Phase33RuntimeProfile = "local-mock" | "production-contract";

const projectPattern = /^swisstalenthub-phase33-[a-z0-9-]{1,42}$/u;
const resourceNamePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/**
 * Bind the fully rendered Compose model without retaining substituted secrets.
 * The caller retains only its digest plus non-sensitive resource identities.
 */
export function parsePhase33RenderedComposeEvidence(
  serialized: string,
  profile: Phase33RuntimeProfile,
  projectName: string,
) {
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes < 2 || sizeBytes > 1024 * 1024) {
    throw new Error("PHASE33_RENDERED_COMPOSE_SIZE_INVALID");
  }
  if (!projectPattern.test(projectName)) {
    throw new Error("PHASE33_RENDERED_COMPOSE_PROJECT_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("PHASE33_RENDERED_COMPOSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || parsed.name !== projectName) {
    throw new Error("PHASE33_RENDERED_COMPOSE_PROJECT_MISMATCH");
  }
  const services = resourceNames(parsed.services, "SERVICES");
  const networks = resourceNames(parsed.networks, "NETWORKS");
  return Object.freeze({
    profile,
    projectName,
    digest: `sha256:${createHash("sha256")
      .update(serialized, "utf8")
      .digest("hex")}` as const,
    sizeBytes,
    services,
    networks,
  });
}

function resourceNames(value: unknown, label: "NETWORKS" | "SERVICES") {
  if (!isRecord(value)) {
    throw new Error(`PHASE33_RENDERED_COMPOSE_${label}_INVALID`);
  }
  const names = Object.keys(value).sort();
  if (
    names.length < 1 ||
    names.length > 64 ||
    names.some(
      (name) =>
        !resourceNamePattern.test(name) || !isRecord(value[name]),
    )
  ) {
    throw new Error(`PHASE33_RENDERED_COMPOSE_${label}_INVALID`);
  }
  return Object.freeze(names);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
