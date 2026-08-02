import { describe, expect, it } from "vitest";

import { parsePhase33RenderedComposeEvidence } from "@/lib/release/phase33-compose-evidence";

const PROJECT = "swisstalenthub-phase33-run-1234-abcdef01-local";

describe("Phase-33 rendered Compose evidence", () => {
  it("binds the exact rendered model while exposing only resource names", () => {
    const serialized = JSON.stringify({
      name: PROJECT,
      services: {
        app: { environment: { SESSION_SECRET: "do-not-retain" } },
        worker: { image: "candidate" },
      },
      networks: { back: {}, front: {} },
    });

    const evidence = parsePhase33RenderedComposeEvidence(
      serialized,
      "local-mock",
      PROJECT,
    );

    expect(evidence).toMatchObject({
      profile: "local-mock",
      projectName: PROJECT,
      services: ["app", "worker"],
      networks: ["back", "front"],
      sizeBytes: Buffer.byteLength(serialized),
    });
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(evidence)).not.toContain("do-not-retain");
  });

  it("rejects a mismatched project and malformed resource maps", () => {
    expect(() =>
      parsePhase33RenderedComposeEvidence(
        JSON.stringify({ name: "other", services: {}, networks: {} }),
        "local-mock",
        PROJECT,
      ),
    ).toThrow("PHASE33_RENDERED_COMPOSE_PROJECT_MISMATCH");

    expect(() =>
      parsePhase33RenderedComposeEvidence(
        JSON.stringify({ name: PROJECT, services: [], networks: {} }),
        "local-mock",
        PROJECT,
      ),
    ).toThrow("PHASE33_RENDERED_COMPOSE_SERVICES_INVALID");
  });
});
