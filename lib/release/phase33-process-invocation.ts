import { existsSync } from "node:fs";

export type Phase33NpmRuntime = Readonly<{
  executable: string;
  npmCli: string;
}>;

export const PHASE33_CLEAN_TREE_GIT_ARGUMENTS = Object.freeze([
  "status",
  "--porcelain=v1",
  "--untracked-files=normal",
  "--",
  ".",
  ":(exclude).vercel",
] as const);

export function resolvePhase33NpmRuntime(
  input: Readonly<{
    executable?: string;
    fileExists?: (path: string) => boolean;
    npmExecPath?: string;
  }> = {},
): Phase33NpmRuntime {
  const executable = input.executable ?? process.execPath;
  const npmCli = Object.hasOwn(input, "npmExecPath")
    ? input.npmExecPath
    : process.env.npm_execpath;
  const fileExists = input.fileExists ?? existsSync;
  if (
    executable.trim() === "" ||
    npmCli === undefined ||
    npmCli.trim() === "" ||
    !fileExists(npmCli)
  ) {
    throw new Error("PHASE33_GATE_MUST_BE_STARTED_THROUGH_NPM");
  }
  return Object.freeze({ executable, npmCli });
}

export function phase33NpmArguments(
  runtime: Phase33NpmRuntime,
  args: readonly string[],
) {
  return Object.freeze([runtime.npmCli, ...args]);
}
