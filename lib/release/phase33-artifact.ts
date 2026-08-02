import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS,
  copyPhase32ContainedFile,
  copyPhase32ContainedTree,
  digestPhase32Directory,
  type Phase32DirectoryDigest,
} from "@/lib/release/phase32-artifact-digest";

export const PHASE33_APPLICATION_ARTIFACT_KIND =
  "phase33-standalone-application-v1" as const;

/**
 * The Phase-33 build is deliberately standalone-only. Keeping this as a pure
 * helper makes it impossible for a caller to forget the release build flag
 * while still allowing unit coverage without running Next.js.
 */
export function phase33StandaloneBuildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_ENV: "production",
    PHASE33_STANDALONE_BUILD: "true",
  };
}

/** Assemble the exact deployable tree consumed by all Phase-33 runtime gates. */
export async function assemblePhase33ApplicationArtifact(
  sourceRoot: string,
  artifactRoot: string,
) {
  const absoluteSourceRoot = resolve(sourceRoot);
  const absoluteArtifactRoot = resolve(artifactRoot);
  await rm(absoluteArtifactRoot, { recursive: true, force: true });
  await copyPhase32ContainedTree(
    resolve(absoluteSourceRoot, ".next", "standalone"),
    absoluteArtifactRoot,
    absoluteSourceRoot,
  );
  await mkdir(resolve(absoluteArtifactRoot, ".next"), { recursive: true });
  await copyPhase32ContainedTree(
    resolve(absoluteSourceRoot, ".next", "static"),
    resolve(absoluteArtifactRoot, ".next", "static"),
    absoluteSourceRoot,
  );
  await copyPhase32ContainedTree(
    resolve(absoluteSourceRoot, "public"),
    resolve(absoluteArtifactRoot, "public"),
    absoluteSourceRoot,
  );
  await mkdir(resolve(absoluteArtifactRoot, ".phase32"), {
    recursive: true,
  });
  await copyPhase32ContainedFile(
    resolve(absoluteSourceRoot, "scripts", "e2e", "runtime-guard.cjs"),
    resolve(absoluteArtifactRoot, ".phase32", "runtime-guard.cjs"),
    absoluteSourceRoot,
  );
}

export async function digestPhase33ApplicationArtifact(
  artifactRoot: string,
): Promise<Phase32DirectoryDigest> {
  return digestPhase32Directory(resolve(artifactRoot), {
    exclude: PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS,
  });
}

export function assertPhase33ArtifactUnchanged(
  before: Phase32DirectoryDigest,
  after: Phase32DirectoryDigest,
) {
  if (
    before.sha256 !== after.sha256 ||
    before.fileCount !== after.fileCount ||
    before.sizeBytes !== after.sizeBytes
  ) {
    throw new Error("PHASE33_APPLICATION_ARTIFACT_MUTATED_BY_RUNTIME_GATES");
  }
}
