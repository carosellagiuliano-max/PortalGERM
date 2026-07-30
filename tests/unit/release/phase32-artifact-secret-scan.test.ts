import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanPhase32ArtifactSecrets } from "@/lib/release/phase32-artifact-secret-scan";

describe("Phase 32 artifact secret scan", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("accepts ordinary standalone content and byte-scans binary files", async () => {
    const root = await temporaryRoot();
    await writeTree(root, [
      ["server.js", "export const ready = true;\n"],
      ["public/logo.png", "\u0000PNG"],
    ]);

    await expect(scanPhase32ArtifactSecrets(root, [])).resolves.toMatchObject({
      scannedFileCount: 2,
      binaryFileCount: 1,
      failures: [],
    });
  });

  it("detects exact configured secrets inside NUL-prefixed binaries", async () => {
    const root = await temporaryRoot();
    const secret = "phase32-binary-secret-value";
    await mkdir(join(root, "public"), { recursive: true });
    await writeFile(
      join(root, "public", "payload.png"),
      Buffer.concat([
        Buffer.from([0, 1, 2, 3]),
        Buffer.from(secret, "utf8"),
        Buffer.from([4, 5]),
      ]),
    );

    const result = await scanPhase32ArtifactSecrets(root, [
      { name: "SESSION_SECRET", value: secret },
    ]);

    expect(result).toMatchObject({
      scannedFileCount: 1,
      binaryFileCount: 1,
      failures: ["SESSION_SECRET exact value appears in public/payload.png."],
    });
  });

  it("detects exact configured secrets even across stream chunks", async () => {
    const root = await temporaryRoot();
    const secret = `secret-${"x".repeat(140_000)}`;
    await writeTree(root, [
      ["server.js", `${"a".repeat(65_500)}${secret}${"b".repeat(100)}`],
    ]);

    const result = await scanPhase32ArtifactSecrets(root, [
      { name: "SESSION_SECRET", value: secret },
    ]);

    expect(result.failures).toEqual([
      "SESSION_SECRET exact value appears in server.js.",
    ]);
  });

  it("detects high-confidence private material without returning its bytes", async () => {
    const root = await temporaryRoot();
    await writeTree(root, [
      [
        "server/chunk.js",
        [
          "-----BEGIN",
          "PRIVATE KEY-----\nnot-real\n-----END PRIVATE KEY-----",
        ].join(" "),
      ],
    ]);

    const result = await scanPhase32ArtifactSecrets(root, []);

    expect(result.failures).toEqual([
      "server/chunk.js matches a high-confidence secret pattern.",
    ]);
    expect(JSON.stringify(result)).not.toContain("not-real");
  });

  it("rejects env files and denies links instead of escaping the artifact", async () => {
    const root = await temporaryRoot();
    const external = await temporaryRoot();
    await writeTree(root, [
      ["server.js", "server"],
      [".env.production", "TOKEN=not-a-real-token"],
    ]);
    await writeTree(external, [["secret.txt", "outside"]]);

    const result = await scanPhase32ArtifactSecrets(root, []);
    expect(result.failures).toEqual([
      ".env.production is a forbidden operational artifact.",
    ]);

    await symlink(
      external,
      join(root, "escaped"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(scanPhase32ArtifactSecrets(root, [])).rejects.toThrow(
      /PHASE32_ARTIFACT_SECRET_SCAN_SYMLINK_DENIED/u,
    );
  });

  async function temporaryRoot() {
    const root = await mkdtemp(join(tmpdir(), "sth-phase32-secret-scan-"));
    roots.push(root);
    return root;
  }
});

async function writeTree(
  root: string,
  entries: readonly (readonly [path: string, content: string])[],
) {
  for (const [path, content] of entries) {
    const segments = path.split("/");
    const file = segments.pop()!;
    const directory = join(root, ...segments);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, file), content, "utf8");
  }
}
