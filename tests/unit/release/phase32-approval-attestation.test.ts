import {
  generateKeyPairSync,
  sign,
  type KeyObject,
  type KeyPairKeyObjectResult,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizePhase32ApprovalKeyRegistryPayload,
  canonicalizePhase32ApprovalPayload,
  canonicalizePhase32ApprovalRootTrustAnchor,
  parsePhase32ApprovalAttestation,
  parsePhase32ApprovalKeyRegistryEnvelope,
  parsePhase32ApprovalRootTrustAnchor,
  PHASE32_APPROVAL_ATTESTATION_VERSION,
  PHASE32_APPROVAL_KEY_REGISTRY_VERSION,
  PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_VERSION,
  PHASE32_LC1_APPROVAL_SCOPES,
  phase32ApprovalKeyRegistryPayloadFromEnvelope,
  phase32ApprovalPayloadFromAttestation,
  phase32ApprovalRootTrustAnchorSha256,
  phase32Ed25519SpkiPublicKeySha256,
  verifyPhase32ApprovalAttestation,
  verifyPhase32Lc1ApprovalSet,
  type Phase32ApprovalKeyRegistryPayload,
  type Phase32ApprovalPayload,
  type Phase32Lc1ApprovalScope,
} from "@/lib/release/phase32-approval-attestation";

const COMMIT = "1".repeat(40);
const ARTIFACT = "2".repeat(64);
const WALKTHROUGH = "3".repeat(64);
const ROLLBACK = "4".repeat(64);
const PRE_APPROVAL_EVIDENCE = "a".repeat(64);
const ROOT_PROVISIONING_EVIDENCE = "9".repeat(64);
const ROOT_VALID_FROM = "2026-07-30T08:00:00.000+00:00";
const ROOT_EXPIRES_AT = "2026-07-30T14:00:00.000+00:00";
const REGISTRY_ISSUED_AT = "2026-07-30T09:30:00.000+00:00";
const REGISTRY_EXPIRES_AT = "2026-07-30T13:30:00.000+00:00";
const KEY_VALID_FROM = "2026-07-30T09:00:00.000+00:00";
const RECORDED_AT = "2026-07-30T10:00:00.000+00:00";
const DECISION_AT = "2026-07-30T11:00:00.000+00:00";
const EXPIRES_AT = "2026-07-30T12:00:00.000+00:00";
const KEY_EXPIRES_AT = "2026-07-30T13:00:00.000+00:00";

describe("Phase 32 approval attestations", () => {
  it("verifies provisioned root -> signed registry -> four independent LC1 approvals", () => {
    const input = fixture();

    const result = verifyPhase32Lc1ApprovalSet(
      input.attestations,
      input.registry,
      input.rootTrustAnchor,
      input.expectedRootPublicKeyFingerprintSha256,
      input.context,
    );

    expect(result).toEqual({
      launchClass: "LC1",
      decisionAt: DECISION_AT,
      rootKeyId: "root:phase32-release-approvals",
      rootTrustAnchorSha256: phase32ApprovalRootTrustAnchorSha256(
        input.rootTrustAnchor,
      ),
      registryIssuedAt: REGISTRY_ISSUED_AT,
      registryExpiresAt: REGISTRY_EXPIRES_AT,
      preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
      approvals: PHASE32_LC1_APPROVAL_SCOPES.map((scope, index) => ({
        scope,
        keyId: `key:${scope.toLowerCase()}`,
        approverRef: `approver:${scope.toLowerCase()}`,
        approvalEvidenceRef: `evidence:approval-${scope.toLowerCase()}`,
        approvalEvidenceSha256: String(index + 5).repeat(64),
        recordedAt: RECORDED_AT,
        expiresAt: EXPIRES_AT,
      })),
    });
  });

  it("exports strict, domain-separated canonical payloads independent of property order", () => {
    const input = fixture();
    const approvalPayload = phase32ApprovalPayloadFromAttestation(
      input.attestations[0],
    );
    const registryPayload = phase32ApprovalKeyRegistryPayloadFromEnvelope(
      input.registry,
    );

    expect(
      canonicalizePhase32ApprovalPayload(
        Object.fromEntries(Object.entries(approvalPayload).reverse()),
      ),
    ).toBe(canonicalizePhase32ApprovalPayload(approvalPayload));
    expect(
      canonicalizePhase32ApprovalKeyRegistryPayload(
        Object.fromEntries(Object.entries(registryPayload).reverse()),
      ),
    ).toBe(canonicalizePhase32ApprovalKeyRegistryPayload(registryPayload));
    expect(canonicalizePhase32ApprovalPayload(approvalPayload)).toContain(
      '"domain":"SwissTalentHub/phase32/approval-attestation/v1"',
    );
    expect(
      canonicalizePhase32ApprovalKeyRegistryPayload(registryPayload),
    ).toContain('"domain":"SwissTalentHub/phase32/approval-key-registry/v1"');
    expect(
      canonicalizePhase32ApprovalRootTrustAnchor(input.rootTrustAnchor),
    ).toContain(
      '"domain":"SwissTalentHub/phase32/approval-root-trust-anchor/v1"',
    );
  });

  it("rejects a tampered provisioned root trust anchor", () => {
    const input = fixture();
    const tampered = {
      ...input.rootTrustAnchor,
      provisioningEvidenceSha256: "b".repeat(64),
    };

    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        input.attestations,
        input.registry,
        tampered,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/rootTrustAnchorSha256 does not match/u);
  });

  it("rejects registry tampering and a registry self-signed by a child key", () => {
    const tamperedInput = fixture();
    const tamperedRegistry = {
      ...tamperedInput.registry,
      keys: tamperedInput.registry.keys.map((key, index) => ({
        ...key,
        approverRef: index === 0 ? "approver:tampered" : key.approverRef,
      })),
    };
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        tamperedInput.attestations,
        tamperedRegistry,
        tamperedInput.rootTrustAnchor,
        tamperedInput.expectedRootPublicKeyFingerprintSha256,
        tamperedInput.context,
      ),
    ).toThrow(/root signature verification failed/u);

    const selfSignedInput = fixture();
    const selfSignedPayload = phase32ApprovalKeyRegistryPayloadFromEnvelope(
      selfSignedInput.registry,
    );
    const selfSignedRegistry = signRegistry(
      selfSignedPayload,
      selfSignedInput.privateKeys[0]!,
    );
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        selfSignedInput.attestations,
        selfSignedRegistry,
        selfSignedInput.rootTrustAnchor,
        selfSignedInput.expectedRootPublicKeyFingerprintSha256,
        selfSignedInput.context,
      ),
    ).toThrow(/root signature verification failed/u);
  });

  it("rejects a wrong root, expired registry and revoked root", () => {
    const wrongRootInput = fixture();
    const wrongRoot = {
      ...wrongRootInput.rootTrustAnchor,
      rootKeyId: "root:unexpected",
    };
    expect(() =>
      verifyPhase32ApprovalAttestation(
        wrongRootInput.attestations[0],
        wrongRootInput.registry,
        wrongRoot,
        wrongRootInput.expectedRootPublicKeyFingerprintSha256,
        wrongRootInput.context,
      ),
    ).toThrow(/rootKeyId does not match/u);

    const expiredRegistryInput = fixture({
      registryExpiresAt: DECISION_AT,
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        expiredRegistryInput.attestations[0],
        expiredRegistryInput.registry,
        expiredRegistryInput.rootTrustAnchor,
        expiredRegistryInput.expectedRootPublicKeyFingerprintSha256,
        expiredRegistryInput.context,
      ),
    ).toThrow(/registry is expired/u);

    const revokedRootInput = fixture({
      rootRevokedAt: "2026-07-30T10:30:00.000+00:00",
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        revokedRootInput.attestations[0],
        revokedRootInput.registry,
        revokedRootInput.rootTrustAnchor,
        revokedRootInput.expectedRootPublicKeyFingerprintSha256,
        revokedRootInput.context,
      ),
    ).toThrow(/root key is revoked/u);
  });

  it("rejects an expired root and registry validity beyond its root", () => {
    const expiredRootInput = fixture({
      rootExpiresAt: DECISION_AT,
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        expiredRootInput.attestations[0],
        expiredRootInput.registry,
        expiredRootInput.rootTrustAnchor,
        expiredRootInput.expectedRootPublicKeyFingerprintSha256,
        expiredRootInput.context,
      ),
    ).toThrow(/root key is expired/u);

    const excessiveRegistryInput = fixture({
      rootExpiresAt: "2026-07-30T13:00:00.000+00:00",
      registryExpiresAt: "2026-07-30T13:30:00.000+00:00",
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        excessiveRegistryInput.attestations[0],
        excessiveRegistryInput.registry,
        excessiveRegistryInput.rootTrustAnchor,
        excessiveRegistryInput.expectedRootPublicKeyFingerprintSha256,
        excessiveRegistryInput.context,
      ),
    ).toThrow(/must not exceed root key validity/u);
  });

  it("binds every approval to the pre-approval evidence root", () => {
    const input = fixture();
    const wrongContext = {
      ...input.context,
      preApprovalEvidenceSha256: "b".repeat(64),
    };
    expect(() =>
      verifyPhase32ApprovalAttestation(
        input.attestations[0],
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        wrongContext,
      ),
    ).toThrow(/preApprovalEvidenceSha256 does not match/u);

    const tamperedAttestation = {
      ...input.attestations[0]!,
      preApprovalEvidenceSha256: "b".repeat(64),
    };
    expect(() =>
      verifyPhase32ApprovalAttestation(
        tamperedAttestation,
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        {
          ...input.context,
          preApprovalEvidenceSha256: "b".repeat(64),
        },
      ),
    ).toThrow(/signature verification failed/u);
  });

  it("fails closed when signed approval content or signature encoding is tampered", () => {
    const input = fixture();
    const tampered = [
      {
        ...input.attestations[0]!,
        approvalEvidenceSha256: "f".repeat(64),
      },
      ...input.attestations.slice(1),
    ];

    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        tampered,
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/signature verification failed/u);

    const nonCanonical = {
      ...input.attestations[0]!,
      signature: input.attestations[0]!.signature.replace(/==$/u, ""),
    };
    expect(() => parsePhase32ApprovalAttestation(nonCanonical)).toThrow(
      /signature/u,
    );
  });

  it("rejects unknown child keys and duplicate child key identifiers", () => {
    const input = fixture();
    const unknown = signPayload(
      {
        ...phase32ApprovalPayloadFromAttestation(input.attestations[0]),
        keyId: "key:unknown",
      },
      input.privateKeys[0]!,
    );
    expect(() =>
      verifyPhase32ApprovalAttestation(
        unknown,
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/unknown keyId/u);

    const duplicatePayload = {
      ...phase32ApprovalKeyRegistryPayloadFromEnvelope(input.registry),
      keys: input.registry.keys.map((key, index) => ({
        ...key,
        keyId: index === 1 ? input.registry.keys[0]!.keyId : key.keyId,
      })),
    };
    expect(() =>
      parsePhase32ApprovalKeyRegistryEnvelope({
        ...duplicatePayload,
        signature: input.registry.signature,
      }),
    ).toThrow(/keyId must be unique/u);
  });

  it("rejects duplicate child public material, approval keys and approvers", () => {
    const duplicateMaterialInput = fixture();
    const duplicateMaterialPayload = {
      ...phase32ApprovalKeyRegistryPayloadFromEnvelope(
        duplicateMaterialInput.registry,
      ),
      keys: duplicateMaterialInput.registry.keys.map((key, index) => ({
        ...key,
        publicKeyPem:
          index === 1
            ? duplicateMaterialInput.registry.keys[0]!.publicKeyPem
            : key.publicKeyPem,
      })),
    };
    expect(() =>
      parsePhase32ApprovalKeyRegistryEnvelope({
        ...duplicateMaterialPayload,
        signature: duplicateMaterialInput.registry.signature,
      }),
    ).toThrow(/public key material is duplicated/u);

    const duplicateApprovalInput = fixture();
    const duplicateApproval = [
      duplicateApprovalInput.attestations[0]!,
      duplicateApprovalInput.attestations[1]!,
      duplicateApprovalInput.attestations[2]!,
      duplicateApprovalInput.attestations[0]!,
    ];
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        duplicateApproval,
        duplicateApprovalInput.registry,
        duplicateApprovalInput.rootTrustAnchor,
        duplicateApprovalInput.expectedRootPublicKeyFingerprintSha256,
        duplicateApprovalInput.context,
      ),
    ).toThrow(/approval scope values must be distinct/u);

    const sharedApproverInput = fixture({
      approverForSecondScope: "approver:release",
    });
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        sharedApproverInput.attestations,
        sharedApproverInput.registry,
        sharedApproverInput.rootTrustAnchor,
        sharedApproverInput.expectedRootPublicKeyFingerprintSha256,
        sharedApproverInput.context,
      ),
    ).toThrow(/approval approverRef values must be distinct/u);
  });

  it("rejects a missing LC1 approval and a child key used for the wrong scope", () => {
    const input = fixture();
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        input.attestations.slice(0, 3),
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/exactly four approval attestations/u);

    const wrongScope = signPayload(
      {
        ...phase32ApprovalPayloadFromAttestation(input.attestations[0]),
        scope: "SECURITY",
      },
      input.privateKeys[0]!,
    );
    expect(() =>
      verifyPhase32ApprovalAttestation(
        wrongScope,
        input.registry,
        input.rootTrustAnchor,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/does not match the claimed approver and scope/u);
  });

  it("rejects expired approvals, stale child keys and revoked child keys", () => {
    const expiredInput = fixture();
    const expired = signPayload(
      {
        ...phase32ApprovalPayloadFromAttestation(expiredInput.attestations[0]),
        expiresAt: DECISION_AT,
      },
      expiredInput.privateKeys[0]!,
    );
    expect(() =>
      verifyPhase32ApprovalAttestation(
        expired,
        expiredInput.registry,
        expiredInput.rootTrustAnchor,
        expiredInput.expectedRootPublicKeyFingerprintSha256,
        expiredInput.context,
      ),
    ).toThrow(/approval is expired/u);

    const staleInput = fixture({
      firstKeyValidFrom: "2026-07-30T10:30:00.000+00:00",
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        staleInput.attestations[0],
        staleInput.registry,
        staleInput.rootTrustAnchor,
        staleInput.expectedRootPublicKeyFingerprintSha256,
        staleInput.context,
      ),
    ).toThrow(/was not valid when approval was recorded/u);

    const revokedInput = fixture({
      firstKeyRevokedAt: "2026-07-30T10:30:00.000+00:00",
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        revokedInput.attestations[0],
        revokedInput.registry,
        revokedInput.rootTrustAnchor,
        revokedInput.expectedRootPublicKeyFingerprintSha256,
        revokedInput.context,
      ),
    ).toThrow(/is revoked at the launch decision/u);
  });

  it("rejects expired child keys, stale release evidence and pre-registry approvals", () => {
    const expiredKeyInput = fixture({
      firstKeyExpiresAt: DECISION_AT,
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        expiredKeyInput.attestations[0],
        expiredKeyInput.registry,
        expiredKeyInput.rootTrustAnchor,
        expiredKeyInput.expectedRootPublicKeyFingerprintSha256,
        expiredKeyInput.context,
      ),
    ).toThrow(/key .* is expired/u);

    const mismatchedInput = fixture();
    const wrongContext = {
      ...mismatchedInput.context,
      walkthroughEvidenceSha256: "b".repeat(64),
    };
    expect(() =>
      verifyPhase32ApprovalAttestation(
        mismatchedInput.attestations[0],
        mismatchedInput.registry,
        mismatchedInput.rootTrustAnchor,
        mismatchedInput.expectedRootPublicKeyFingerprintSha256,
        wrongContext,
      ),
    ).toThrow(/walkthroughEvidenceSha256 does not match/u);

    const earlyInput = fixture({
      recordedAt: "2026-07-30T09:00:00.000+00:00",
    });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        earlyInput.attestations[0],
        earlyInput.registry,
        earlyInput.rootTrustAnchor,
        earlyInput.expectedRootPublicKeyFingerprintSha256,
        earlyInput.context,
      ),
    ).toThrow(/before the signed key registry/u);
  });

  it("accepts only strict Ed25519 roots, child keys and one closed LC1 scope", () => {
    const rootInput = fixture();
    const rsaRoot = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    expect(() =>
      parsePhase32ApprovalRootTrustAnchor({
        ...rootInput.rootTrustAnchor,
        publicKeyPem: rsaRoot.publicKey.export({
          type: "spki",
          format: "pem",
        }),
      }),
    ).toThrow(/must be an Ed25519 public key/u);

    const childInput = fixture();
    const rsaChild = generateKeyPairSync("rsa", { modulusLength: 2_048 });
    const childPayload = {
      ...phase32ApprovalKeyRegistryPayloadFromEnvelope(childInput.registry),
      keys: childInput.registry.keys.map((key, index) => ({
        ...key,
        publicKeyPem:
          index === 0
            ? rsaChild.publicKey.export({ type: "spki", format: "pem" })
            : key.publicKeyPem,
      })),
    };
    expect(() =>
      parsePhase32ApprovalKeyRegistryEnvelope({
        ...childPayload,
        signature: childInput.registry.signature,
      }),
    ).toThrow(/must be an Ed25519 public key/u);

    const multipleScopesInput = fixture();
    const multipleScopesPayload = {
      ...phase32ApprovalKeyRegistryPayloadFromEnvelope(
        multipleScopesInput.registry,
      ),
      keys: multipleScopesInput.registry.keys.map((key, index) =>
        index === 0 ? { ...key, scopes: ["RELEASE", "SECURITY"] } : key,
      ),
    };
    expect(() =>
      parsePhase32ApprovalKeyRegistryEnvelope({
        ...multipleScopesPayload,
        signature: multipleScopesInput.registry.signature,
      }),
    ).toThrow(/Unrecognized key/u);
  });

  it("rejects root material reused as a child or provisioning authority reused as approver", () => {
    const rootReuseInput = fixture({ reuseRootAsFirstChild: true });
    expect(() =>
      verifyPhase32ApprovalAttestation(
        rootReuseInput.attestations[0],
        rootReuseInput.registry,
        rootReuseInput.rootTrustAnchor,
        rootReuseInput.expectedRootPublicKeyFingerprintSha256,
        rootReuseInput.context,
      ),
    ).toThrow(/must not reuse the provisioned root public key/u);

    const authorityReuseInput = fixture({
      approverForSecondScope: "authority:security-governance",
    });
    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        authorityReuseInput.attestations,
        authorityReuseInput.registry,
        authorityReuseInput.rootTrustAnchor,
        authorityReuseInput.expectedRootPublicKeyFingerprintSha256,
        authorityReuseInput.context,
      ),
    ).toThrow(/independent of the provisioning authority/u);
  });

  it("never treats a registry as trusted without a provisioned root anchor", () => {
    const input = fixture();

    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        input.attestations,
        input.registry,
        undefined,
        input.expectedRootPublicKeyFingerprintSha256,
        input.context,
      ),
    ).toThrow(/root trust anchor invalid/u);
  });

  it("requires the actual root SPKI key to match an independently provisioned pin", () => {
    const provisioned = fixture();
    const attackerControlledCandidate = fixture();

    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        attackerControlledCandidate.attestations,
        attackerControlledCandidate.registry,
        attackerControlledCandidate.rootTrustAnchor,
        provisioned.expectedRootPublicKeyFingerprintSha256,
        attackerControlledCandidate.context,
      ),
    ).toThrow(/does not match the independently provisioned pin/u);

    expect(() =>
      verifyPhase32Lc1ApprovalSet(
        provisioned.attestations,
        provisioned.registry,
        provisioned.rootTrustAnchor,
        "candidate:declared-root",
        provisioned.context,
      ),
    ).toThrow(/expected root public key fingerprint invalid/u);
  });
});

type FixtureOptions = Readonly<{
  rootExpiresAt?: string;
  rootRevokedAt?: string | null;
  registryExpiresAt?: string;
  firstKeyValidFrom?: string;
  firstKeyExpiresAt?: string | null;
  firstKeyRevokedAt?: string | null;
  recordedAt?: string;
  approverForSecondScope?: string;
  reuseRootAsFirstChild?: boolean;
}>;

function fixture(options: FixtureOptions = {}) {
  const rootKeyPair = generateKeyPairSync("ed25519");
  const expectedRootPublicKeyFingerprintSha256 =
    phase32Ed25519SpkiPublicKeySha256(pem(rootKeyPair));
  const generatedChildPairs = PHASE32_LC1_APPROVAL_SCOPES.map(() =>
    generateKeyPairSync("ed25519"),
  );
  const childKeyPairs = generatedChildPairs.map((pair, index) =>
    index === 0 && options.reuseRootAsFirstChild ? rootKeyPair : pair,
  );
  const rootTrustAnchor = {
    schemaVersion: PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_VERSION,
    algorithm: "Ed25519" as const,
    rootKeyId: "root:phase32-release-approvals",
    publicKeyPem: pem(rootKeyPair),
    validFrom: ROOT_VALID_FROM,
    expiresAt: options.rootExpiresAt ?? ROOT_EXPIRES_AT,
    revokedAt: options.rootRevokedAt ?? null,
    provisioningAuthorityRef: "authority:security-governance",
    provisioningEvidenceSha256: ROOT_PROVISIONING_EVIDENCE,
  };
  const keys = PHASE32_LC1_APPROVAL_SCOPES.map((scope, index) => ({
    keyId: `key:${scope.toLowerCase()}`,
    approverRef:
      index === 1 && options.approverForSecondScope !== undefined
        ? options.approverForSecondScope
        : `approver:${scope.toLowerCase()}`,
    scope,
    publicKeyPem: pem(childKeyPairs[index]!),
    validFrom:
      index === 0 && options.firstKeyValidFrom !== undefined
        ? options.firstKeyValidFrom
        : KEY_VALID_FROM,
    expiresAt:
      index === 0 && options.firstKeyExpiresAt !== undefined
        ? options.firstKeyExpiresAt
        : (KEY_EXPIRES_AT as string | null),
    revokedAt:
      index === 0 && options.firstKeyRevokedAt !== undefined
        ? options.firstKeyRevokedAt
        : (null as string | null),
  }));
  const registryPayload: Phase32ApprovalKeyRegistryPayload = {
    schemaVersion: PHASE32_APPROVAL_KEY_REGISTRY_VERSION,
    algorithm: "Ed25519",
    rootKeyId: rootTrustAnchor.rootKeyId,
    rootTrustAnchorSha256:
      phase32ApprovalRootTrustAnchorSha256(rootTrustAnchor),
    issuedAt: REGISTRY_ISSUED_AT,
    expiresAt: options.registryExpiresAt ?? REGISTRY_EXPIRES_AT,
    keys,
  };
  const registry = signRegistry(registryPayload, rootKeyPair.privateKey);
  const privateKeys = childKeyPairs.map(({ privateKey }) => privateKey);
  const recordedAt = options.recordedAt ?? RECORDED_AT;
  const attestations = PHASE32_LC1_APPROVAL_SCOPES.map((scope, index) =>
    signPayload(
      payload(scope, index, {
        approverRef: keys[index]!.approverRef,
        recordedAt,
      }),
      privateKeys[index]!,
    ),
  );
  const context = {
    candidateCommitSha: COMMIT,
    artifactSha256: ARTIFACT,
    deploymentId: "deployment:staging-lc1",
    walkthroughEvidenceSha256: WALKTHROUGH,
    rollbackEvidenceSha256: ROLLBACK,
    preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
    decisionAt: DECISION_AT,
  };
  return {
    rootTrustAnchor,
    registry,
    expectedRootPublicKeyFingerprintSha256,
    privateKeys,
    attestations,
    context,
  };
}

function payload(
  scope: Phase32Lc1ApprovalScope,
  index: number,
  options: Readonly<{ approverRef?: string; recordedAt?: string }> = {},
): Phase32ApprovalPayload {
  return {
    schemaVersion: PHASE32_APPROVAL_ATTESTATION_VERSION,
    algorithm: "Ed25519",
    decision: "APPROVED",
    keyId: `key:${scope.toLowerCase()}`,
    approverRef: options.approverRef ?? `approver:${scope.toLowerCase()}`,
    scope,
    launchClass: "LC1",
    candidateCommitSha: COMMIT,
    artifactSha256: ARTIFACT,
    deploymentId: "deployment:staging-lc1",
    walkthroughEvidenceSha256: WALKTHROUGH,
    rollbackEvidenceSha256: ROLLBACK,
    preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
    approvalEvidenceRef: `evidence:approval-${scope.toLowerCase()}`,
    approvalEvidenceSha256: String(index + 5).repeat(64),
    recordedAt: options.recordedAt ?? RECORDED_AT,
    expiresAt: EXPIRES_AT,
  };
}

function signPayload(payloadInput: Phase32ApprovalPayload, key: KeyObject) {
  return {
    ...payloadInput,
    signature: sign(
      null,
      Buffer.from(canonicalizePhase32ApprovalPayload(payloadInput), "utf8"),
      key,
    ).toString("base64"),
  };
}

function signRegistry(
  payloadInput: Phase32ApprovalKeyRegistryPayload,
  rootKey: KeyObject,
) {
  return {
    ...payloadInput,
    signature: sign(
      null,
      Buffer.from(
        canonicalizePhase32ApprovalKeyRegistryPayload(payloadInput),
        "utf8",
      ),
      rootKey,
    ).toString("base64"),
  };
}

function pem(keyPair: KeyPairKeyObjectResult) {
  return keyPair.publicKey.export({
    type: "spki",
    format: "pem",
  }) as string;
}
