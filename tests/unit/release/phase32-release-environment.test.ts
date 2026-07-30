import { describe, expect, it } from "vitest";

import { phase32InheritedReleaseEnvironment } from "@/scripts/phase32-release-environment";

describe("Phase 32 release subprocess environment", () => {
  it("preserves local Windows tool discovery and explicit release inputs", () => {
    const environment = phase32InheritedReleaseEnvironment({
      NODE_ENV: "test",
      PATH: "C:\\safe-bin",
      SystemRoot: "C:\\Windows",
      SYSTEMROOT: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      ProgramW6432: "C:\\Program Files",
      DATABASE_URL: "postgresql://local/app",
      TEST_DATABASE_URL: "postgresql://local/app_test",
      SESSION_SECRET: "candidate-session-secret",
      PHASE32_EPHEMERAL_ROOT: "C:\\isolated\\phase32",
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      PATH: "C:\\safe-bin",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      ProgramW6432: "C:\\Program Files",
      DATABASE_URL: "postgresql://local/app",
      TEST_DATABASE_URL: "postgresql://local/app_test",
      SESSION_SECRET: "candidate-session-secret",
      PHASE32_EPHEMERAL_ROOT: "C:\\isolated\\phase32",
    });
    expect(
      Object.keys(environment).filter(
        (name) => name.toLowerCase() === "systemroot",
      ),
    ).toHaveLength(1);
    expect(
      Object.keys(environment).filter(
        (name) => name.toLowerCase() === "comspec",
      ),
    ).toHaveLength(1);
  });

  it("does not forward routing overrides or unrelated credentials", () => {
    const environment = phase32InheritedReleaseEnvironment({
      NODE_ENV: "test",
      PATH: "C:\\safe-bin",
      DOCKER_CONFIG: "C:\\redirected-docker-config",
      DOCKER_CONTEXT: "remote-context",
      DOCKER_HOST: "tcp://external.example:2376",
      COMPOSE_FILE: "C:\\different-project\\compose.yml",
      NPM_CONFIG_USERCONFIG: "C:\\credential-bearing-npmrc",
      GITHUB_TOKEN: "must-not-cross-process-boundary",
      NPM_TOKEN: "must-not-cross-process-boundary",
      AWS_SECRET_ACCESS_KEY: "must-not-cross-process-boundary",
    });

    expect(environment.DOCKER_CONFIG).toBeUndefined();
    expect(environment.DOCKER_CONTEXT).toBeUndefined();
    expect(environment.DOCKER_HOST).toBeUndefined();
    expect(environment.COMPOSE_FILE).toBeUndefined();
    expect(environment.NPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBeUndefined();
    expect(environment.NPM_TOKEN).toBeUndefined();
    expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
