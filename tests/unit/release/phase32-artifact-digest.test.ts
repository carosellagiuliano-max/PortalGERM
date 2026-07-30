import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyPhase32ContainedTree,
  digestPhase32Directory,
  digestPhase32File,
  PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS,
} from "@/lib/release/phase32-artifact-digest";

describe("Phase 32 artifact digest", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("is deterministic across creation order and metadata-only changes", async () => {
    const first = await temporaryRoot();
    const second = await temporaryRoot();
    await writeTree(first, [
      ["server/chunk.js", "export const value = 1;\n"],
      ["static/app.css", "body{color:#111}\n"],
    ]);
    await writeTree(second, [
      ["static/app.css", "body{color:#111}\n"],
      ["server/chunk.js", "export const value = 1;\n"],
    ]);
    await utimes(
      join(second, "server", "chunk.js"),
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2020-01-01T00:00:00.000Z"),
    );

    const [left, right] = await Promise.all([
      digestPhase32Directory(first),
      digestPhase32Directory(second),
    ]);
    expect(left).toMatchObject({ fileCount: 2, sizeBytes: right.sizeBytes });
    expect(left.sha256).toBe(right.sha256);
  });

  it("binds both normalized paths and file bytes", async () => {
    const root = await temporaryRoot();
    await writeTree(root, [["server/chunk.js", "one"]]);
    const original = await digestPhase32Directory(root);

    await writeFile(join(root, "server", "chunk.js"), "two", "utf8");
    const changedBytes = await digestPhase32Directory(root);
    expect(changedBytes.sha256).not.toBe(original.sha256);

    await mkdir(join(root, "renamed"), { recursive: true });
    await writeFile(join(root, "renamed", "chunk.js"), "one", "utf8");
    await rm(join(root, "server"), { recursive: true });
    const changedPath = await digestPhase32Directory(root);
    expect(changedPath.sha256).not.toBe(original.sha256);
  });

  it("excludes only explicitly named build-cache subtrees", async () => {
    const root = await temporaryRoot();
    await writeTree(root, [
      [".next/BUILD_ID", "candidate"],
      [".next/server/app.js", "release"],
      [".next/cache/webpack/cache.bin", "first-cache"],
    ]);
    const first = await digestPhase32Directory(root, {
      exclude: PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS,
    });
    await writeFile(
      join(root, ".next", "cache", "webpack", "cache.bin"),
      "different-cache",
      "utf8",
    );
    const second = await digestPhase32Directory(root, {
      exclude: PHASE32_NEXT_BUILD_CACHE_EXCLUSIONS,
    });

    expect(second.sha256).toBe(first.sha256);
    expect(first.excludedPaths).toEqual([".next/cache"]);
    expect(first.fileCount).toBe(2);
  });

  it("denies symlinks instead of following content outside the artifact", async () => {
    const root = await temporaryRoot();
    const external = await temporaryRoot();
    await writeTree(root, [["release.txt", "release"]]);
    await writeTree(external, [["secret.txt", "outside"]]);
    const link = join(root, "linked");
    await symlink(
      external,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(digestPhase32Directory(root)).rejects.toThrow(
      /PHASE32_ARTIFACT_SYMLINK_DENIED/u,
    );
  });

  it("allows controlled standalone links only when they resolve inside the clean clone", async () => {
    const clone = await temporaryRoot();
    const output = await temporaryRoot();
    const standalone = join(clone, "standalone");
    const dependency = join(clone, "node_modules", "safe-package");
    await writeTree(standalone, [["server.js", "server"]]);
    await writeTree(dependency, [["index.js", "dependency"]]);
    await symlink(
      dependency,
      join(standalone, "safe-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      copyPhase32ContainedTree(standalone, join(output, "artifact"), clone),
    ).resolves.toBeUndefined();
    await expect(
      readFile(join(output, "artifact", "safe-package", "index.js"), "utf8"),
    ).resolves.toBe("dependency");
  });

  it("rejects controlled-copy links that escape the clean clone", async () => {
    const clone = await temporaryRoot();
    const output = await temporaryRoot();
    const external = await temporaryRoot();
    const standalone = join(clone, "standalone");
    await writeTree(standalone, [["server.js", "server"]]);
    await writeTree(external, [["secret.txt", "outside"]]);
    await symlink(
      external,
      join(standalone, "unsafe-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      copyPhase32ContainedTree(standalone, join(output, "artifact"), clone),
    ).rejects.toThrow(/PHASE32_COPY_SOURCE_SYMLINK_ESCAPE/u);
  });

  it("rejects an in-root junction whose target contains a nested escape", async () => {
    const clone = await temporaryRoot();
    const output = await temporaryRoot();
    const external = await temporaryRoot();
    const standalone = join(clone, "standalone");
    const dependency = join(clone, "node_modules", "safe-package");
    await writeTree(standalone, [["server.js", "server"]]);
    await writeTree(dependency, [["index.js", "dependency"]]);
    await writeTree(external, [["secret.txt", "outside"]]);
    await symlink(
      external,
      join(dependency, "nested-escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      dependency,
      join(standalone, "safe-package"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      copyPhase32ContainedTree(standalone, join(output, "artifact"), clone),
    ).rejects.toThrow(/PHASE32_COPY_SOURCE_SYMLINK_ESCAPE/u);
  });

  it("rejects a copy root reached through an escaping parent junction", async () => {
    const clone = await temporaryRoot();
    const output = await temporaryRoot();
    const external = await temporaryRoot();
    await writeTree(external, [["nested/server.js", "outside"]]);
    await symlink(
      external,
      join(clone, "parent-junction"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      copyPhase32ContainedTree(
        join(clone, "parent-junction", "nested"),
        join(output, "artifact"),
        clone,
      ),
    ).rejects.toThrow(/PHASE32_COPY_SOURCE_ROOT_ESCAPE/u);
  });

  it("rejects source mutation while copying a regular file", async () => {
    const clone = await temporaryRoot();
    const output = await temporaryRoot();
    const source = join(clone, "standalone", "large.bin");
    await mkdir(join(clone, "standalone"), { recursive: true });
    await writeFile(source, "stable source", "utf8");
    let announceOpened!: () => void;
    let continueCopy!: () => void;
    const opened = new Promise<void>((resolveOpened) => {
      announceOpened = resolveOpened;
    });
    const copyMayContinue = new Promise<void>((resolveContinue) => {
      continueCopy = resolveContinue;
    });
    const copying = copyPhase32ContainedTree(
      join(clone, "standalone"),
      join(output, "artifact"),
      clone,
      {
        onSourceFileOpened: async (relativePath) => {
          expect(relativePath).toBe("large.bin");
          announceOpened();
          await copyMayContinue;
        },
      },
    );
    const rejection = expect(copying).rejects.toThrow(
      /PHASE32_COPY_SOURCE_FILE_CHANGED_DURING_READ/u,
    );
    await opened;
    await writeFile(source, "changed source with a different size", "utf8");
    continueCopy();

    await rejection;
  });

  it("does not inspect an explicitly excluded symlink subtree", async () => {
    const root = await temporaryRoot();
    const external = await temporaryRoot();
    await writeTree(root, [["release.txt", "release"]]);
    await writeTree(external, [["secret.txt", "outside"]]);
    await symlink(
      external,
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = await digestPhase32Directory(root, {
      exclude: ["node_modules"],
    });

    expect(result).toMatchObject({
      excludedPaths: ["node_modules"],
      fileCount: 1,
    });
  });

  it("hashes regular files and rejects empty directories or unsafe exclusions", async () => {
    const root = await temporaryRoot();
    const file = join(root, "artifact.bin");
    await writeFile(file, Buffer.from([0, 1, 2, 3]));
    await expect(digestPhase32File(file)).resolves.toMatchObject({
      sha256:
        "054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8",
      sizeBytes: 4,
    });

    const empty = await temporaryRoot();
    await expect(digestPhase32Directory(empty)).rejects.toThrow(
      /PHASE32_ARTIFACT_DIRECTORY_EMPTY/u,
    );
    await expect(
      digestPhase32Directory(root, { exclude: ["../outside"] }),
    ).rejects.toThrow(/PHASE32_ARTIFACT_EXCLUSION_INVALID/u);
  });

  async function temporaryRoot() {
    const root = await mkdtemp(join(tmpdir(), "sth-phase32-artifact-"));
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
