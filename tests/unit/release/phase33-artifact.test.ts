import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assemblePhase33ApplicationArtifact,
  assertPhase33ArtifactUnchanged,
  digestPhase33ApplicationArtifact,
  phase33StandaloneBuildEnvironment,
} from "@/lib/release/phase33-artifact";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Phase-33 deployable application artifact", () => {
  it("forces a standalone-only production build without mutating its input", () => {
    const input = {
      NODE_ENV: "test",
      PHASE33_STANDALONE_BUILD: "false",
    } satisfies NodeJS.ProcessEnv;

    expect(phase33StandaloneBuildEnvironment(input)).toMatchObject({
      NODE_ENV: "production",
      PHASE33_STANDALONE_BUILD: "true",
    });
    expect(input).toEqual({
      NODE_ENV: "test",
      PHASE33_STANDALONE_BUILD: "false",
    });
  });

  it("assembles standalone, static, public and the runtime guard as one identity", async () => {
    const root = await temporaryRoot();
    const source = resolve(root, "source");
    const artifact = resolve(root, "artifact");
    await writeFixture(source, ".next/standalone/server.js", "server");
    await writeFixture(source, ".next/standalone/.next/BUILD_ID", "build");
    await writeFixture(source, ".next/static/chunk.js", "static");
    await writeFixture(source, "public/robots.txt", "public");
    await writeFixture(source, "scripts/e2e/runtime-guard.cjs", "guard");

    await assemblePhase33ApplicationArtifact(source, artifact);
    const before = await digestPhase33ApplicationArtifact(artifact);

    await expect(readFile(resolve(artifact, "server.js"), "utf8")).resolves.toBe(
      "server",
    );
    await expect(
      readFile(resolve(artifact, ".next/static/chunk.js"), "utf8"),
    ).resolves.toBe("static");
    await expect(
      readFile(resolve(artifact, "public/robots.txt"), "utf8"),
    ).resolves.toBe("public");
    await expect(
      readFile(resolve(artifact, ".phase32/runtime-guard.cjs"), "utf8"),
    ).resolves.toBe("guard");

    expect(() => assertPhase33ArtifactUnchanged(before, before)).not.toThrow();
    await writeFile(resolve(artifact, "server.js"), "mutated", "utf8");
    const after = await digestPhase33ApplicationArtifact(artifact);
    expect(() => assertPhase33ArtifactUnchanged(before, after)).toThrow(
      "PHASE33_APPLICATION_ARTIFACT_MUTATED_BY_RUNTIME_GATES",
    );
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(resolve(tmpdir(), "phase33-artifact-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeFixture(root: string, path: string, value: string) {
  const absolute = resolve(root, path);
  await mkdir(resolve(absolute, ".."), { recursive: true });
  await writeFile(absolute, value, "utf8");
}
