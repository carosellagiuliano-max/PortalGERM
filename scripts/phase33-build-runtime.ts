import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(repositoryRoot, "dist", "phase33");

await mkdir(outputRoot, { recursive: true });

await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  conditions: ["react-server", "node", "import"],
  entryPoints: [resolve(repositoryRoot, "scripts", "phase33-runtime.ts")],
  external: [],
  format: "esm",
  logLevel: "info",
  outfile: resolve(outputRoot, "runtime.mjs"),
  packages: "external",
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  conditions: ["react-server", "node", "import"],
  entryPoints: [
    resolve(repositoryRoot, "scripts", "phase33-runtime-preflight.ts"),
  ],
  format: "esm",
  logLevel: "info",
  outfile: resolve(outputRoot, "runtime-preflight.mjs"),
  packages: "external",
  platform: "node",
  sourcemap: false,
  target: "node24",
});

await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: [
    resolve(repositoryRoot, "scripts", "phase33-provider-contract-stub.ts"),
  ],
  format: "esm",
  logLevel: "info",
  outfile: resolve(outputRoot, "provider-contract-stub.mjs"),
  platform: "node",
  sourcemap: false,
  target: "node24",
});

process.stdout.write(
  `${JSON.stringify({ command: "phase33-build-runtime", outputRoot, status: "PASS" })}\n`,
);
