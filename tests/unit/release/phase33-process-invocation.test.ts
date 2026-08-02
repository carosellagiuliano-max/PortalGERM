import { describe, expect, it } from "vitest";

import {
  PHASE33_CLEAN_TREE_GIT_ARGUMENTS,
  phase33NpmArguments,
  resolvePhase33NpmRuntime,
} from "@/lib/release/phase33-process-invocation";

describe("Phase 33 npm process invocation", () => {
  it("excludes the owner-controlled .vercel tree without weakening other untracked checks", () => {
    expect(PHASE33_CLEAN_TREE_GIT_ARGUMENTS).toEqual([
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
      "--",
      ".",
      ":(exclude).vercel",
    ]);
  });

  it("uses Node plus npm-cli directly on Windows without cmd shell execution", () => {
    const runtime = resolvePhase33NpmRuntime({
      executable: "C:\\node\\node.exe",
      npmExecPath: "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
      fileExists: () => true,
    });

    expect(runtime.executable).toBe("C:\\node\\node.exe");
    expect(phase33NpmArguments(runtime, ["ci"])).toEqual([
      "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
      "ci",
    ]);
    expect(runtime.executable).not.toMatch(/\.cmd$/iu);
  });

  it.each([
    { npmExecPath: undefined, fileExists: () => true },
    { npmExecPath: "C:\\missing\\npm-cli.js", fileExists: () => false },
  ])("fails closed without a verified npm CLI", (input) => {
    expect(() =>
      resolvePhase33NpmRuntime({
        executable: "C:\\node\\node.exe",
        ...input,
      }),
    ).toThrow("PHASE33_GATE_MUST_BE_STARTED_THROUGH_NPM");
  });
});
