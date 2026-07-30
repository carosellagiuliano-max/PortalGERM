import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  captureDiagnostics,
  redact,
  runRecoveryOperations,
  safeToolEnvironment,
  waitForChild,
  type RecoveryChild,
} from "@/scripts/ops/process-tools";

describe("Phase-18 recovery process tools", () => {
  it("redacts configured values, keyring material and common bearer formats", () => {
    const databaseUrl =
      "postgresql://ops-user:db-password@127.0.0.1:5432/release_test";
    const sessionSecret = "session-secret-canary-value";
    const keyMaterial = "keyring-secret-canary-value";
    const identityPath = "C:\\external-secret\\age-identity.txt";
    const ageIdentityCanary = `${["AGE", "SECRET", "KEY"].join("-")}-1TESTCANARY`;
    const output = redact(
      [
        databaseUrl,
        sessionSecret,
        keyMaterial,
        identityPath,
        "Authorization: Bearer abc.def-123_456",
        ageIdentityCanary,
      ].join("\n"),
      {
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: sessionSecret,
        AUDIT_IP_HASH_KEYS: `v1:${keyMaterial}`,
        BACKUP_AGE_IDENTITY_FILE: identityPath,
      },
    );

    for (const canary of [
      databaseUrl,
      sessionSecret,
      keyMaterial,
      identityPath,
      "abc.def-123_456",
      ageIdentityCanary,
    ]) {
      expect(output).not.toContain(canary);
    }
    expect(output).toContain("[REDACTED");
  });

  it("passes only allowlisted operating-system variables to external tools", () => {
    const environment = safeToolEnvironment({
      NODE_ENV: "test",
      PATH: "C:\\safe-bin",
      SystemRoot: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
      SESSION_SECRET: "must-not-cross-process-boundary",
      GITHUB_TOKEN: "must-not-cross-process-boundary",
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      PATH: "C:\\safe-bin",
      SystemRoot: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
    });
    expect(environment.SESSION_SECRET).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBeUndefined();
  });

  it("canonicalizes a Windows Path alias and rejects conflicting aliases", () => {
    const environment = safeToolEnvironment({
      NODE_ENV: "test",
      Path: "C:\\safe-bin",
    }, "win32");

    expect(environment.PATH).toBe("C:\\safe-bin");
    expect(environment.Path).toBeUndefined();
    expect(() =>
      safeToolEnvironment({
        NODE_ENV: "test",
        PATH: "C:\\first-bin",
        Path: "C:\\second-bin",
      }, "win32"),
    ).toThrow("Conflicting PATH and Path values");

    const posixEnvironment = safeToolEnvironment({
      NODE_ENV: "test",
      PATH: "/usr/bin",
      Path: "/must-not-be-used",
    }, "linux");
    expect(posixEnvironment.PATH).toBe("/usr/bin");
    expect(posixEnvironment.Path).toBeUndefined();
  });

  it(
    "times out a hung child and waits for bounded termination",
    async () => {
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => undefined, 1_000)"],
        {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      ) as RecoveryChild;
      const diagnostics = captureDiagnostics(child);
      const completion = waitForChild(child, "hung test child", diagnostics);

      await expect(
        runRecoveryOperations(
          "hung recovery test",
          [child],
          [completion],
          150,
        ),
      ).rejects.toThrow(/timed out after 150 ms/u);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    },
    10_000,
  );
});
