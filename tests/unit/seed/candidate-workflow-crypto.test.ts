// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import {
  candidateWorkflowSeedCryptoFromEnvironment,
  DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
} from "@/prisma/seed/blocks/candidate-workflows";
import {
  createValidEnvironment,
  keyMaterial,
} from "@/tests/fixtures/environment";

describe("Candidate workflow seed crypto configuration", () => {
  it("unwraps the four typed runtime keyrings through their secret handles", () => {
    const crypto = candidateWorkflowSeedCryptoFromEnvironment(
      parseEnvironment(createValidEnvironment()),
    );

    expect(crypto).toEqual({
      radarLookupKeys: [{ version: "lookup-v1", secret: keyMaterial(3) }],
      radarEncryptionKeys: [{ version: "opaque-v1", secret: keyMaterial(4) }],
      revealConfirmationKeys: [
        { version: "confirm-v1", secret: keyMaterial(5) },
      ],
      piiRevealKeys: [{ version: "reveal-v1", secret: keyMaterial(6) }],
    });
  });

  it("labels the direct-call fallback as demo-only and keeps key purposes separate", () => {
    const config = DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO;
    const secrets = [
      config.radarLookupKeys[0]?.secret,
      config.radarEncryptionKeys[0]?.secret,
      config.revealConfirmationKeys[0]?.secret,
      config.piiRevealKeys[0]?.secret,
    ];

    expect(secrets.every((secret) => typeof secret === "string")).toBe(true);
    expect(new Set(secrets).size).toBe(4);
    expect(
      Object.values(config)
        .flat()
        .every(({ version }) => version.startsWith("demo-")),
    ).toBe(true);
  });
});
