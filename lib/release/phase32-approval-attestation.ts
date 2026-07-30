import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import { z } from "zod";

export const PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_VERSION =
  "phase32-approval-root-trust-anchor-v1" as const;
export const PHASE32_APPROVAL_KEY_REGISTRY_VERSION =
  "phase32-approval-key-registry-v1" as const;
export const PHASE32_APPROVAL_ATTESTATION_VERSION =
  "phase32-approval-attestation-v1" as const;
export const PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_DOMAIN =
  "SwissTalentHub/phase32/approval-root-trust-anchor/v1" as const;
export const PHASE32_APPROVAL_KEY_REGISTRY_DOMAIN =
  "SwissTalentHub/phase32/approval-key-registry/v1" as const;
export const PHASE32_APPROVAL_ATTESTATION_DOMAIN =
  "SwissTalentHub/phase32/approval-attestation/v1" as const;

export const PHASE32_LC1_APPROVAL_SCOPES = Object.freeze([
  "RELEASE",
  "SECURITY",
  "PRODUCT",
  "OPERATIONS",
] as const);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const safeReferenceSchema = z
  .string()
  .min(2)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });
const lc1ApprovalScopeSchema = z.enum(PHASE32_LC1_APPROVAL_SCOPES);
const publicKeyPemSchema = z
  .string()
  .min(100)
  .max(8_192)
  .regex(
    /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u,
  );
const canonicalEd25519SignatureSchema = z
  .string()
  .length(88)
  .regex(/^[A-Za-z0-9+/]{86}==$/u)
  .refine((value) => {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 64 && decoded.toString("base64") === value;
  }, "must be a canonical Base64-encoded 64-byte Ed25519 signature");

const approvalRootTrustAnchorSchema = z
  .strictObject({
    schemaVersion: z.literal(PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_VERSION),
    algorithm: z.literal("Ed25519"),
    rootKeyId: safeReferenceSchema,
    publicKeyPem: publicKeyPemSchema,
    validFrom: instantSchema,
    expiresAt: instantSchema,
    revokedAt: instantSchema.nullable(),
    provisioningAuthorityRef: safeReferenceSchema,
    provisioningEvidenceSha256: sha256Schema,
  })
  .superRefine((anchor, context) => {
    const validFrom = Date.parse(anchor.validFrom);
    if (Date.parse(anchor.expiresAt) <= validFrom) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than validFrom",
      });
    }
    if (anchor.revokedAt !== null && Date.parse(anchor.revokedAt) < validFrom) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "revokedAt must not precede validFrom",
      });
    }
    if (anchor.provisioningAuthorityRef === anchor.rootKeyId) {
      context.addIssue({
        code: "custom",
        path: ["provisioningAuthorityRef"],
        message: "provisioning authority must be independent of the root key",
      });
    }
  });

const trustedApprovalKeySchema = z.strictObject({
  keyId: safeReferenceSchema,
  approverRef: safeReferenceSchema,
  scope: lc1ApprovalScopeSchema,
  publicKeyPem: publicKeyPemSchema,
  validFrom: instantSchema,
  expiresAt: instantSchema.nullable(),
  revokedAt: instantSchema.nullable(),
});

const approvalKeyRegistryPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(PHASE32_APPROVAL_KEY_REGISTRY_VERSION),
    algorithm: z.literal("Ed25519"),
    rootKeyId: safeReferenceSchema,
    rootTrustAnchorSha256: sha256Schema,
    issuedAt: instantSchema,
    expiresAt: instantSchema,
    keys: z.array(trustedApprovalKeySchema).min(1).max(256),
  })
  .superRefine((registry, context) => {
    if (Date.parse(registry.expiresAt) <= Date.parse(registry.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than issuedAt",
      });
    }

    const seenKeyIds = new Set<string>();
    for (const [index, key] of registry.keys.entries()) {
      if (seenKeyIds.has(key.keyId)) {
        context.addIssue({
          code: "custom",
          path: ["keys", index, "keyId"],
          message: "keyId must be unique",
        });
      }
      seenKeyIds.add(key.keyId);

      const validFrom = Date.parse(key.validFrom);
      if (key.expiresAt !== null && Date.parse(key.expiresAt) <= validFrom) {
        context.addIssue({
          code: "custom",
          path: ["keys", index, "expiresAt"],
          message: "expiresAt must be later than validFrom",
        });
      }
      if (key.revokedAt !== null && Date.parse(key.revokedAt) < validFrom) {
        context.addIssue({
          code: "custom",
          path: ["keys", index, "revokedAt"],
          message: "revokedAt must not precede validFrom",
        });
      }
    }
  });

const approvalKeyRegistryEnvelopeSchema =
  approvalKeyRegistryPayloadSchema.safeExtend({
    signature: canonicalEd25519SignatureSchema,
  });

const approvalPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(PHASE32_APPROVAL_ATTESTATION_VERSION),
    algorithm: z.literal("Ed25519"),
    decision: z.literal("APPROVED"),
    keyId: safeReferenceSchema,
    approverRef: safeReferenceSchema,
    scope: lc1ApprovalScopeSchema,
    launchClass: z.literal("LC1"),
    candidateCommitSha: gitObjectIdSchema,
    artifactSha256: sha256Schema,
    deploymentId: safeReferenceSchema,
    walkthroughEvidenceSha256: sha256Schema,
    rollbackEvidenceSha256: sha256Schema,
    preApprovalEvidenceSha256: sha256Schema,
    approvalEvidenceRef: safeReferenceSchema,
    approvalEvidenceSha256: sha256Schema,
    recordedAt: instantSchema,
    expiresAt: instantSchema,
  })
  .superRefine((payload, context) => {
    if (Date.parse(payload.expiresAt) <= Date.parse(payload.recordedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than recordedAt",
      });
    }
  });

const approvalAttestationSchema = approvalPayloadSchema.safeExtend({
  signature: canonicalEd25519SignatureSchema,
});

const verificationContextSchema = z.strictObject({
  candidateCommitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  deploymentId: safeReferenceSchema,
  walkthroughEvidenceSha256: sha256Schema,
  rollbackEvidenceSha256: sha256Schema,
  preApprovalEvidenceSha256: sha256Schema,
  decisionAt: instantSchema,
});

type ParsedApprovalRootTrustAnchor = z.infer<
  typeof approvalRootTrustAnchorSchema
>;
type ParsedTrustedApprovalKey = z.infer<typeof trustedApprovalKeySchema>;
type ParsedApprovalKeyRegistryPayload = z.infer<
  typeof approvalKeyRegistryPayloadSchema
>;
type ParsedApprovalKeyRegistryEnvelope = z.infer<
  typeof approvalKeyRegistryEnvelopeSchema
>;
type ParsedApprovalPayload = z.infer<typeof approvalPayloadSchema>;
type ParsedApprovalAttestation = z.infer<typeof approvalAttestationSchema>;

export type Phase32Lc1ApprovalScope =
  (typeof PHASE32_LC1_APPROVAL_SCOPES)[number];
export type Phase32ApprovalRootTrustAnchor =
  Readonly<ParsedApprovalRootTrustAnchor>;
export type Phase32TrustedApprovalKey = Readonly<ParsedTrustedApprovalKey>;
export type Phase32ApprovalKeyRegistryPayload = Readonly<
  Omit<ParsedApprovalKeyRegistryPayload, "keys"> & {
    keys: readonly Phase32TrustedApprovalKey[];
  }
>;
export type Phase32ApprovalKeyRegistryEnvelope = Readonly<
  Omit<ParsedApprovalKeyRegistryEnvelope, "keys"> & {
    keys: readonly Phase32TrustedApprovalKey[];
  }
>;
export type Phase32ApprovalPayload = Readonly<ParsedApprovalPayload>;
export type Phase32ApprovalAttestation = Readonly<ParsedApprovalAttestation>;
export type Phase32ApprovalVerificationContext = Readonly<
  z.infer<typeof verificationContextSchema>
>;
export type Phase32VerifiedApproval = Readonly<{
  scope: Phase32Lc1ApprovalScope;
  keyId: string;
  approverRef: string;
  approvalEvidenceRef: string;
  approvalEvidenceSha256: string;
  recordedAt: string;
  expiresAt: string;
}>;
export type Phase32VerifiedLc1ApprovalSet = Readonly<{
  launchClass: "LC1";
  decisionAt: string;
  rootKeyId: string;
  rootTrustAnchorSha256: string;
  registryIssuedAt: string;
  registryExpiresAt: string;
  preApprovalEvidenceSha256: string;
  approvals: readonly Phase32VerifiedApproval[];
}>;

type PreparedPublicKey = Readonly<{
  publicKey: KeyObject;
  publicKeyFingerprint: string;
}>;

type PreparedTrustedApprovalKey = Readonly<{
  record: Phase32TrustedApprovalKey;
  publicKey: KeyObject;
  publicKeyFingerprint: string;
}>;

type PreparedApprovalKeyRegistry = Readonly<{
  envelope: Phase32ApprovalKeyRegistryEnvelope;
  rootTrustAnchor: Phase32ApprovalRootTrustAnchor;
  rootTrustAnchorSha256: string;
  keysById: ReadonlyMap<string, PreparedTrustedApprovalKey>;
}>;

export function parsePhase32ApprovalRootTrustAnchor(
  raw: unknown,
): Phase32ApprovalRootTrustAnchor {
  const parsed = approvalRootTrustAnchorSchema.safeParse(raw);
  if (!parsed.success) {
    failRootTrust(`schema invalid: ${formatIssues(parsed.error)}`);
  }
  parseEd25519PublicKey(
    parsed.data.publicKeyPem,
    `root key ${parsed.data.rootKeyId}`,
    failRootTrust,
  );
  return Object.freeze(parsed.data);
}

export function canonicalizePhase32ApprovalRootTrustAnchor(
  raw: unknown,
): string {
  const anchor = parsePhase32ApprovalRootTrustAnchor(raw);
  return canonicalJson({
    domain: PHASE32_APPROVAL_ROOT_TRUST_ANCHOR_DOMAIN,
    anchor,
  });
}

export function phase32ApprovalRootTrustAnchorSha256(raw: unknown): string {
  return createHash("sha256")
    .update(canonicalizePhase32ApprovalRootTrustAnchor(raw), "utf8")
    .digest("hex");
}

/**
 * Returns the lowercase SHA-256 fingerprint of the canonical DER-encoded
 * SubjectPublicKeyInfo for an Ed25519 public key. The expected value must be
 * provisioned independently from candidate-controlled release metadata.
 */
export function phase32Ed25519SpkiPublicKeySha256(
  rawPublicKeyPem: unknown,
): string {
  const parsed = publicKeyPemSchema.safeParse(rawPublicKeyPem);
  if (!parsed.success) {
    failRootTrust(`public key PEM invalid: ${formatIssues(parsed.error)}`);
  }
  const publicKey = parseEd25519PublicKey(
    parsed.data,
    "pinned root public key",
    failRootTrust,
  );
  return fingerprintPublicKey(publicKey);
}

export function parsePhase32ApprovalKeyRegistryPayload(
  raw: unknown,
): Phase32ApprovalKeyRegistryPayload {
  const parsed = approvalKeyRegistryPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    failRegistry(`payload schema invalid: ${formatIssues(parsed.error)}`);
  }
  const keys = prepareChildKeyRecords(parsed.data.keys);
  return Object.freeze({
    ...parsed.data,
    keys: Object.freeze(keys.map(({ record }) => record)),
  });
}

export function parsePhase32ApprovalKeyRegistryEnvelope(
  raw: unknown,
): Phase32ApprovalKeyRegistryEnvelope {
  const parsed = approvalKeyRegistryEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    failRegistry(`schema invalid: ${formatIssues(parsed.error)}`);
  }
  const keys = prepareChildKeyRecords(parsed.data.keys);
  return Object.freeze({
    ...parsed.data,
    keys: Object.freeze(keys.map(({ record }) => record)),
  });
}

export function phase32ApprovalKeyRegistryPayloadFromEnvelope(
  raw: unknown,
): Phase32ApprovalKeyRegistryPayload {
  const { signature: _signature, ...payload } =
    parsePhase32ApprovalKeyRegistryEnvelope(raw);
  return parsePhase32ApprovalKeyRegistryPayload(payload);
}

export function canonicalizePhase32ApprovalKeyRegistryPayload(
  raw: unknown,
): string {
  const payload = parsePhase32ApprovalKeyRegistryPayload(raw);
  return canonicalJson({
    domain: PHASE32_APPROVAL_KEY_REGISTRY_DOMAIN,
    payload,
  });
}

export function parsePhase32ApprovalAttestation(
  raw: unknown,
): Phase32ApprovalAttestation {
  const parsed = approvalAttestationSchema.safeParse(raw);
  if (!parsed.success) {
    failAttestation(`schema invalid: ${formatIssues(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}

export function parsePhase32ApprovalPayload(
  raw: unknown,
): Phase32ApprovalPayload {
  const parsed = approvalPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    failAttestation(`payload schema invalid: ${formatIssues(parsed.error)}`);
  }
  return Object.freeze(parsed.data);
}

export function phase32ApprovalPayloadFromAttestation(
  raw: unknown,
): Phase32ApprovalPayload {
  const { signature: _signature, ...payload } =
    parsePhase32ApprovalAttestation(raw);
  return parsePhase32ApprovalPayload(payload);
}

/**
 * Returns the exact UTF-8 string that must be signed. The envelope is
 * domain-separated and every object key is sorted recursively, so input
 * property order cannot change the signature payload.
 */
export function canonicalizePhase32ApprovalPayload(raw: unknown): string {
  const payload = parsePhase32ApprovalPayload(raw);
  return canonicalJson({
    domain: PHASE32_APPROVAL_ATTESTATION_DOMAIN,
    payload,
  });
}

export function verifyPhase32ApprovalAttestation(
  rawAttestation: unknown,
  rawRegistryEnvelope: unknown,
  rawRootTrustAnchor: unknown,
  rawExpectedRootPublicKeyFingerprintSha256: unknown,
  rawContext: unknown,
): Phase32VerifiedApproval {
  const context = parseVerificationContext(rawContext);
  const preparedRegistry = prepareApprovalKeyRegistry(
    rawRegistryEnvelope,
    rawRootTrustAnchor,
    rawExpectedRootPublicKeyFingerprintSha256,
    context,
  );
  return verifyPreparedAttestation(rawAttestation, preparedRegistry, context)
    .approval;
}

export function verifyPhase32Lc1ApprovalSet(
  rawAttestations: unknown,
  rawRegistryEnvelope: unknown,
  rawRootTrustAnchor: unknown,
  rawExpectedRootPublicKeyFingerprintSha256: unknown,
  rawContext: unknown,
): Phase32VerifiedLc1ApprovalSet {
  if (!Array.isArray(rawAttestations) || rawAttestations.length !== 4) {
    failAttestation("LC1 requires exactly four approval attestations");
  }

  const context = parseVerificationContext(rawContext);
  const preparedRegistry = prepareApprovalKeyRegistry(
    rawRegistryEnvelope,
    rawRootTrustAnchor,
    rawExpectedRootPublicKeyFingerprintSha256,
    context,
  );
  const verified = rawAttestations.map((attestation) =>
    verifyPreparedAttestation(attestation, preparedRegistry, context),
  );

  assertUnique(
    verified.map(({ approval }) => approval.scope),
    "approval scope",
  );
  assertUnique(
    verified.map(({ approval }) => approval.keyId),
    "approval keyId",
  );
  assertUnique(
    verified.map(({ approval }) => approval.approverRef),
    "approval approverRef",
  );
  assertUnique(
    verified.map(({ publicKeyFingerprint }) => publicKeyFingerprint),
    "approval public key",
  );

  const scopes = new Set(verified.map(({ approval }) => approval.scope));
  if (PHASE32_LC1_APPROVAL_SCOPES.some((scope) => !scopes.has(scope))) {
    failAttestation(
      "LC1 approvals must contain RELEASE, SECURITY, PRODUCT and OPERATIONS exactly once",
    );
  }

  const byScope = new Map(
    verified.map(({ approval }) => [approval.scope, approval]),
  );
  const approvals = PHASE32_LC1_APPROVAL_SCOPES.map((scope) => {
    const approval = byScope.get(scope);
    if (approval === undefined) {
      failAttestation(`verified approval missing for ${scope}`);
    }
    return approval;
  });

  return Object.freeze({
    launchClass: "LC1",
    decisionAt: context.decisionAt,
    rootKeyId: preparedRegistry.rootTrustAnchor.rootKeyId,
    rootTrustAnchorSha256: preparedRegistry.rootTrustAnchorSha256,
    registryIssuedAt: preparedRegistry.envelope.issuedAt,
    registryExpiresAt: preparedRegistry.envelope.expiresAt,
    preApprovalEvidenceSha256: context.preApprovalEvidenceSha256,
    approvals: Object.freeze(approvals),
  });
}

function prepareApprovalKeyRegistry(
  rawRegistryEnvelope: unknown,
  rawRootTrustAnchor: unknown,
  rawExpectedRootPublicKeyFingerprintSha256: unknown,
  context: Phase32ApprovalVerificationContext,
): PreparedApprovalKeyRegistry {
  const rootTrustAnchor =
    parsePhase32ApprovalRootTrustAnchor(rawRootTrustAnchor);
  const envelope = parsePhase32ApprovalKeyRegistryEnvelope(rawRegistryEnvelope);
  const expectedRootPublicKeyFingerprintSha256 = parseExpectedRootFingerprint(
    rawExpectedRootPublicKeyFingerprintSha256,
  );
  const rootTrustAnchorSha256 =
    phase32ApprovalRootTrustAnchorSha256(rootTrustAnchor);
  const actualRootPublicKeyFingerprintSha256 =
    phase32Ed25519SpkiPublicKeySha256(rootTrustAnchor.publicKeyPem);

  if (
    actualRootPublicKeyFingerprintSha256 !==
    expectedRootPublicKeyFingerprintSha256
  ) {
    failRootTrust(
      "root public key fingerprint does not match the independently provisioned pin",
    );
  }

  if (envelope.rootKeyId !== rootTrustAnchor.rootKeyId) {
    failRegistry("rootKeyId does not match the provisioned root trust anchor");
  }
  if (envelope.rootTrustAnchorSha256 !== rootTrustAnchorSha256) {
    failRegistry(
      "rootTrustAnchorSha256 does not match the provisioned root trust anchor",
    );
  }

  assertRootAndRegistryTimeWindow(rootTrustAnchor, envelope, context);
  const preparedRootKey = preparePublicKey(
    rootTrustAnchor.publicKeyPem,
    `root key ${rootTrustAnchor.rootKeyId}`,
    failRootTrust,
  );
  const signingBytes = Buffer.from(
    canonicalizePhase32ApprovalKeyRegistryPayload(
      phase32ApprovalKeyRegistryPayloadFromEnvelope(envelope),
    ),
    "utf8",
  );
  if (
    !verifySignature(
      null,
      signingBytes,
      preparedRootKey.publicKey,
      Buffer.from(envelope.signature, "base64"),
    )
  ) {
    failRegistry(
      `root signature verification failed for ${rootTrustAnchor.rootKeyId}`,
    );
  }

  const preparedKeys = prepareChildKeyRecords(envelope.keys);
  const keysById = new Map<string, PreparedTrustedApprovalKey>();
  for (const key of preparedKeys) {
    if (key.record.keyId === rootTrustAnchor.rootKeyId) {
      failRegistry("a child approval key must not reuse the root keyId");
    }
    if (key.record.approverRef === rootTrustAnchor.provisioningAuthorityRef) {
      failRegistry(
        "a child approver must be independent of the provisioning authority",
      );
    }
    if (key.publicKeyFingerprint === preparedRootKey.publicKeyFingerprint) {
      failRegistry(
        "a child approval key must not reuse the provisioned root public key",
      );
    }
    keysById.set(key.record.keyId, key);
  }

  return Object.freeze({
    envelope,
    rootTrustAnchor,
    rootTrustAnchorSha256,
    keysById,
  });
}

function prepareChildKeyRecords(
  rawKeys: readonly Phase32TrustedApprovalKey[],
): readonly PreparedTrustedApprovalKey[] {
  const preparedKeys: PreparedTrustedApprovalKey[] = [];
  const keyIdsByFingerprint = new Map<string, string>();

  for (const rawKey of rawKeys) {
    const key = Object.freeze({ ...rawKey });
    const prepared = preparePublicKey(
      key.publicKeyPem,
      `key ${key.keyId}`,
      failRegistry,
    );
    const existingKeyId = keyIdsByFingerprint.get(
      prepared.publicKeyFingerprint,
    );
    if (existingKeyId !== undefined) {
      failRegistry(
        `public key material is duplicated by ${existingKeyId} and ${key.keyId}`,
      );
    }
    keyIdsByFingerprint.set(prepared.publicKeyFingerprint, key.keyId);
    preparedKeys.push(
      Object.freeze({
        record: key,
        publicKey: prepared.publicKey,
        publicKeyFingerprint: prepared.publicKeyFingerprint,
      }),
    );
  }

  return Object.freeze(preparedKeys);
}

function preparePublicKey(
  publicKeyPem: string,
  label: string,
  fail: (message: string) => never,
): PreparedPublicKey {
  const publicKey = parseEd25519PublicKey(publicKeyPem, label, fail);
  return Object.freeze({
    publicKey,
    publicKeyFingerprint: fingerprintPublicKey(publicKey),
  });
}

function parseEd25519PublicKey(
  publicKeyPem: string,
  label: string,
  fail: (message: string) => never,
): KeyObject {
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    fail(`${label} is not a valid public key PEM`);
  }
  if (
    publicKey.type !== "public" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    fail(`${label} must be an Ed25519 public key`);
  }
  return publicKey;
}

function fingerprintPublicKey(publicKey: KeyObject) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  if (typeof spki === "string") {
    failRegistry("Ed25519 public key could not be exported as DER");
  }
  return createHash("sha256").update(spki).digest("hex");
}

function parseVerificationContext(
  raw: unknown,
): Phase32ApprovalVerificationContext {
  const parsed = verificationContextSchema.safeParse(raw);
  if (!parsed.success) {
    failAttestation(
      `verification context invalid: ${formatIssues(parsed.error)}`,
    );
  }
  return Object.freeze(parsed.data);
}

function parseExpectedRootFingerprint(raw: unknown): string {
  const parsed = sha256Schema.safeParse(raw);
  if (!parsed.success) {
    failRootTrust(
      `expected root public key fingerprint invalid: ${formatIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

function verifyPreparedAttestation(
  rawAttestation: unknown,
  registry: PreparedApprovalKeyRegistry,
  context: Phase32ApprovalVerificationContext,
) {
  const attestation = parsePhase32ApprovalAttestation(rawAttestation);
  const trustedKey = registry.keysById.get(attestation.keyId);
  if (trustedKey === undefined) {
    failAttestation(`unknown keyId ${attestation.keyId}`);
  }
  if (
    trustedKey.record.approverRef !== attestation.approverRef ||
    trustedKey.record.scope !== attestation.scope
  ) {
    failAttestation(
      `key ${attestation.keyId} does not match the claimed approver and scope`,
    );
  }

  assertExpectedBindings(attestation, context);
  assertApprovalTimeWindow(
    attestation,
    trustedKey.record,
    registry.envelope,
    context,
  );

  const payload = phase32ApprovalPayloadFromAttestation(attestation);
  const signingBytes = Buffer.from(
    canonicalizePhase32ApprovalPayload(payload),
    "utf8",
  );
  const signature = Buffer.from(attestation.signature, "base64");
  if (!verifySignature(null, signingBytes, trustedKey.publicKey, signature)) {
    failAttestation(`signature verification failed for ${attestation.keyId}`);
  }

  return Object.freeze({
    approval: Object.freeze({
      scope: attestation.scope,
      keyId: attestation.keyId,
      approverRef: attestation.approverRef,
      approvalEvidenceRef: attestation.approvalEvidenceRef,
      approvalEvidenceSha256: attestation.approvalEvidenceSha256,
      recordedAt: attestation.recordedAt,
      expiresAt: attestation.expiresAt,
    }),
    publicKeyFingerprint: trustedKey.publicKeyFingerprint,
  });
}

function assertExpectedBindings(
  attestation: Phase32ApprovalAttestation,
  context: Phase32ApprovalVerificationContext,
) {
  const bindings = [
    ["candidateCommitSha", context.candidateCommitSha],
    ["artifactSha256", context.artifactSha256],
    ["deploymentId", context.deploymentId],
    ["walkthroughEvidenceSha256", context.walkthroughEvidenceSha256],
    ["rollbackEvidenceSha256", context.rollbackEvidenceSha256],
    ["preApprovalEvidenceSha256", context.preApprovalEvidenceSha256],
  ] as const;
  for (const [field, expected] of bindings) {
    if (attestation[field] !== expected) {
      failAttestation(`${field} does not match the release candidate`);
    }
  }
}

function assertRootAndRegistryTimeWindow(
  anchor: Phase32ApprovalRootTrustAnchor,
  registry: Phase32ApprovalKeyRegistryEnvelope,
  context: Phase32ApprovalVerificationContext,
) {
  const validFrom = Date.parse(anchor.validFrom);
  const rootExpiresAt = Date.parse(anchor.expiresAt);
  const registryIssuedAt = Date.parse(registry.issuedAt);
  const registryExpiresAt = Date.parse(registry.expiresAt);
  const decisionAt = Date.parse(context.decisionAt);

  if (registryIssuedAt > decisionAt) {
    failRegistry("registry was issued after the launch decision");
  }
  if (registryExpiresAt <= decisionAt) {
    failRegistry("registry is expired at the launch decision");
  }
  if (validFrom > registryIssuedAt) {
    failRootTrust("root key was not valid when the registry was issued");
  }
  if (validFrom > decisionAt) {
    failRootTrust("root key is not yet valid at the launch decision");
  }
  if (rootExpiresAt <= decisionAt) {
    failRootTrust("root key is expired at the launch decision");
  }
  if (registryExpiresAt > rootExpiresAt) {
    failRegistry("registry validity must not exceed root key validity");
  }
  if (anchor.revokedAt !== null && Date.parse(anchor.revokedAt) <= decisionAt) {
    failRootTrust("root key is revoked at the launch decision");
  }
}

function assertApprovalTimeWindow(
  attestation: Phase32ApprovalAttestation,
  key: Phase32TrustedApprovalKey,
  registry: Phase32ApprovalKeyRegistryEnvelope,
  context: Phase32ApprovalVerificationContext,
) {
  const recordedAt = Date.parse(attestation.recordedAt);
  const decisionAt = Date.parse(context.decisionAt);
  if (recordedAt < Date.parse(registry.issuedAt)) {
    failAttestation("approval was recorded before the signed key registry");
  }
  if (recordedAt > decisionAt) {
    failAttestation("approval was recorded after the launch decision");
  }
  if (Date.parse(attestation.expiresAt) <= decisionAt) {
    failAttestation("approval is expired at the launch decision");
  }
  if (Date.parse(key.validFrom) > recordedAt) {
    failAttestation(
      `key ${key.keyId} was not valid when approval was recorded`,
    );
  }
  if (key.expiresAt !== null && Date.parse(key.expiresAt) <= decisionAt) {
    failAttestation(`key ${key.keyId} is expired at the launch decision`);
  }
  if (key.revokedAt !== null && Date.parse(key.revokedAt) <= decisionAt) {
    failAttestation(`key ${key.keyId} is revoked at the launch decision`);
  }
}

type CanonicalJsonPrimitive = null | boolean | number | string;
type CanonicalJsonValue =
  CanonicalJsonPrimitive | readonly CanonicalJsonValue[] | CanonicalJsonObject;

interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}

function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry as CanonicalJsonValue)}`,
    )
    .join(",")}}`;
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    failAttestation(`${label} values must be distinct`);
  }
}

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
    .join("; ");
}

function failRootTrust(message: string): never {
  throw new Error(`Phase 32 approval root trust anchor invalid: ${message}.`);
}

function failRegistry(message: string): never {
  throw new Error(`Phase 32 approval key registry invalid: ${message}.`);
}

function failAttestation(message: string): never {
  throw new Error(`Phase 32 approval attestation invalid: ${message}.`);
}
