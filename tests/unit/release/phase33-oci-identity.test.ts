import { describe, expect, it } from "vitest";

import {
  assertPhase33OciImageMatchesReceipt,
  parsePhase33ComposeImageBinding,
  parsePhase33OciImageIdentity,
} from "@/lib/release/phase33-oci-identity";

const candidateCommitSha = "a".repeat(40);
const imageId = `sha256:${"b".repeat(64)}`;
const projectName = "swisstalenthub-phase33-run-123-abcdef01-contract";
const reference = `${projectName}-app-contract:latest`;

describe("Phase-33 OCI image identity", () => {
  it("captures and re-verifies the exact gate image", () => {
    const inspection = validInspection();
    const receipt = parsePhase33OciImageIdentity(inspection, {
      candidateCommitSha,
      projectName,
      reference,
    });

    expect(receipt).toEqual({
      imageId,
      sizeBytes: 420_000_000,
      service: "app-contract",
      revision: candidateCommitSha,
      projectName,
      reference,
    });
    expect(
      assertPhase33OciImageMatchesReceipt(inspection, receipt, {
        candidateCommitSha,
        requestedReference: reference,
      }),
    ).toBe(imageId);
  });

  it("binds the image to the exact Compose project and app service", () => {
    expect(
      parsePhase33ComposeImageBinding(
        [
          {
            Id: "d".repeat(64),
            Image: imageId,
            Config: {
              Image: reference,
              Labels: {
                "com.docker.compose.project": projectName,
                "com.docker.compose.service": "app-contract",
              },
            },
          },
        ],
        { projectName, service: "app-contract" },
      ),
    ).toEqual({
      containerId: "d".repeat(64),
      imageId,
      reference,
    });

    expect(() =>
      parsePhase33ComposeImageBinding(
        [
          {
            Id: "d".repeat(64),
            Image: imageId,
            Config: {
              Image: reference,
              Labels: {
                "com.docker.compose.project": "wrong-project",
                "com.docker.compose.service": "app-contract",
              },
            },
          },
        ],
        { projectName, service: "app-contract" },
      ),
    ).toThrow("PHASE33_COMPOSE_IMAGE_BINDING_INVALID");
  });

  it("rejects tag, revision, digest and size drift independently", () => {
    const receipt = parsePhase33OciImageIdentity(validInspection(), {
      candidateCommitSha,
      projectName,
      reference,
    });
    const mutations: unknown[] = [
      [{ ...validInspection()[0], Id: `sha256:${"c".repeat(64)}` }],
      [{ ...validInspection()[0], Size: 420_000_001 }],
      [
        {
          ...validInspection()[0],
          Config: {
            Labels: { "org.opencontainers.image.revision": "c".repeat(40) },
          },
        },
      ],
    ];
    for (const mutation of mutations) {
      expect(() =>
        assertPhase33OciImageMatchesReceipt(mutation, receipt, {
          candidateCommitSha,
          requestedReference: reference,
        }),
      ).toThrow();
    }
    expect(() =>
      assertPhase33OciImageMatchesReceipt(validInspection(), receipt, {
        candidateCommitSha,
        requestedReference: "unrelated:latest",
      }),
    ).toThrow("OCI_IMAGE_REFERENCE_REPORT_MISMATCH");
  });
});

function validInspection() {
  return [
    {
      Id: imageId,
      Size: 420_000_000,
      RepoTags: [reference],
      Config: {
        Labels: { "org.opencontainers.image.revision": candidateCommitSha },
      },
    },
  ];
}
