export type Phase33OciImageIdentity = Readonly<{
  imageId: string;
  sizeBytes: number;
  service: "app-contract";
  revision: string;
  projectName: string;
  reference: string;
}>;

export function parsePhase33OciImageIdentity(
  rawInspection: unknown,
  input: Readonly<{
    candidateCommitSha: string;
    projectName: string;
    reference: string;
  }>,
): Phase33OciImageIdentity {
  const record =
    Array.isArray(rawInspection) && rawInspection.length === 1
      ? rawInspection[0]
      : undefined;
  const imageId = isRecord(record) ? record.Id : undefined;
  const sizeBytes = isRecord(record) ? record.Size : undefined;
  const repoTags = isRecord(record) ? record.RepoTags : undefined;
  const config = isRecord(record) ? record.Config : undefined;
  const labels = isRecord(config) ? config.Labels : undefined;
  const revision = isRecord(labels)
    ? labels["org.opencontainers.image.revision"]
    : undefined;
  if (
    typeof imageId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageId) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    !Array.isArray(repoTags) ||
    !repoTags.every((tag) => typeof tag === "string") ||
    !repoTags.includes(input.reference) ||
    revision !== input.candidateCommitSha
  ) {
    throw new Error("PHASE33_OCI_IMAGE_IDENTITY_INVALID");
  }
  return Object.freeze({
    imageId,
    sizeBytes,
    service: "app-contract" as const,
    revision,
    projectName: input.projectName,
    reference: input.reference,
  });
}

export function parsePhase33ComposeImageBinding(
  rawInspection: unknown,
  input: Readonly<{ projectName: string; service: "app-contract" }>,
) {
  const record =
    Array.isArray(rawInspection) && rawInspection.length === 1
      ? rawInspection[0]
      : undefined;
  const containerId = isRecord(record) ? record.Id : undefined;
  const imageId = isRecord(record) ? record.Image : undefined;
  const config = isRecord(record) ? record.Config : undefined;
  const reference = isRecord(config) ? config.Image : undefined;
  const labels = isRecord(config) ? config.Labels : undefined;
  const project = isRecord(labels)
    ? labels["com.docker.compose.project"]
    : undefined;
  const service = isRecord(labels)
    ? labels["com.docker.compose.service"]
    : undefined;
  const expectedReference = `${input.projectName}-${input.service}`;
  const canonicalReference =
    reference === expectedReference
      ? `${expectedReference}:latest`
      : reference === `${expectedReference}:latest`
        ? reference
        : undefined;
  if (
    typeof containerId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(containerId) ||
    typeof imageId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageId) ||
    canonicalReference === undefined ||
    project !== input.projectName ||
    service !== input.service
  ) {
    throw new Error("PHASE33_COMPOSE_IMAGE_BINDING_INVALID");
  }
  return Object.freeze({
    containerId,
    imageId,
    reference: canonicalReference,
  });
}

export function assertPhase33OciImageMatchesReceipt(
  rawInspection: unknown,
  receipt: Phase33OciImageIdentity,
  input: Readonly<{
    candidateCommitSha: string;
    requestedReference: string;
  }>,
) {
  if (input.requestedReference !== receipt.reference) {
    throw new Error("OCI_IMAGE_REFERENCE_REPORT_MISMATCH");
  }
  const observed = parsePhase33OciImageIdentity(rawInspection, {
    candidateCommitSha: input.candidateCommitSha,
    projectName: receipt.projectName,
    reference: receipt.reference,
  });
  if (
    observed.imageId !== receipt.imageId ||
    observed.sizeBytes !== receipt.sizeBytes ||
    observed.revision !== receipt.revision ||
    receipt.service !== "app-contract"
  ) {
    throw new Error("OCI_IMAGE_REPORT_IDENTITY_MISMATCH");
  }
  return observed.imageId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
