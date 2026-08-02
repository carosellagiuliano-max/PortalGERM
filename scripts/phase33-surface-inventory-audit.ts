import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";

type ActionRecord = Readonly<{
  action: string;
  launchClasses: readonly string[];
  owner: string;
  roles: readonly string[];
  routeScope: string;
  source: string;
  status: "IMPLEMENTED" | "LOCAL_CI_ONLY";
}>;

type RuntimeControlRecord = Readonly<{
  consumers: readonly string[];
  defaultValue: string;
  effectiveProperty: string | null;
  key: string;
  kind: "boolean" | "mode";
  launchClasses: readonly string[];
  owner: string;
  source: "lib/config/env-schema.ts";
  status:
    "CONFIGURATION_CONTRACT_ONLY" | "DECLARED_FAIL_CLOSED" | "RUNTIME_CONSUMED";
}>;

const repository = process.cwd();
const write = process.argv.includes("--write");
const print = process.argv.includes("--print");
const actionInventoryPath = resolve(
  repository,
  "codex-plan",
  "server-action-inventory.json",
);
const controlInventoryPath = resolve(
  repository,
  "codex-plan",
  "feature-flag-inventory.json",
);

const sourceFiles = collectFiles(repository, [
  "app",
  "components",
  "lib",
  "scripts",
]);
const sourceContents = new Map(
  sourceFiles.map((file) => [file, readFileSync(file, "utf8")] as const),
);
const actions = collectActions();
const controls = collectRuntimeControls(sourceFiles, sourceContents);
const failures: string[] = [];

if (actions.length === 0) failures.push("No server actions were discovered.");
if (controls.length === 0)
  failures.push("No runtime controls were discovered.");
const unsafeUnusedControls = controls.filter(
  ({ consumers, defaultValue, kind }) =>
    consumers.length === 0 && kind === "boolean" && defaultValue === "true",
);
if (unsafeUnusedControls.length > 0) {
  failures.push(
    `Enabled boolean controls without a code consumer: ${unsafeUnusedControls.map(({ key }) => key).join(", ")}.`,
  );
}

if (write || print) {
  if (failures.length > 0) fail(failures);
  if (write) {
    writeFileSync(
      actionInventoryPath,
      `${JSON.stringify(actions, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o644,
      },
    );
    writeFileSync(
      controlInventoryPath,
      `${JSON.stringify(controls, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o644,
      },
    );
    console.info(
      `Updated Phase-33 surface inventories with ${actions.length} server actions and ${controls.length} runtime controls.`,
    );
  } else {
    console.info(`${JSON.stringify({ actions, controls }, null, 2)}\n`);
  }
  process.exit(0);
}

compareCommitted(actionInventoryPath, actions, "server action", failures);
compareCommitted(
  controlInventoryPath,
  controls,
  "feature flag/runtime control",
  failures,
);
if (failures.length > 0) fail(failures);
console.info(
  `Phase-33 surface inventory passed: ${actions.length} server actions and ${controls.length} runtime controls have exact source parity.`,
);

function collectActions(): readonly ActionRecord[] {
  const records: ActionRecord[] = [];
  for (const file of sourceFiles) {
    const sourceText = sourceContents.get(file) ?? readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (!hasUseServerDirective(sourceFile)) continue;
    const source = portable(relative(repository, file));
    const routeScope = routeScopeForAction(source);
    const actionLaunchClasses = launchClasses(source);
    for (const action of exportedFunctionNames(sourceFile)) {
      records.push(
        Object.freeze({
          action,
          launchClasses: actionLaunchClasses,
          owner: ownerFor(`${source}/${action}`),
          roles: rolesForAction(source, action, routeScope),
          routeScope,
          source,
          status: actionLaunchClasses.includes("LOCAL_CI")
            ? "LOCAL_CI_ONLY"
            : "IMPLEMENTED",
        }),
      );
    }
  }
  return Object.freeze(
    records.sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.action.localeCompare(right.action),
    ),
  );
}

function collectRuntimeControls(
  files: readonly string[],
  contents: ReadonlyMap<string, string>,
): readonly RuntimeControlRecord[] {
  const schemaPath = resolve(repository, "lib", "config", "env-schema.ts");
  const sourceText = readFileSync(schemaPath, "utf8");
  const sourceFile = ts.createSourceFile(
    schemaPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const controls: RuntimeControlRecord[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) &&
        /^[A-Z][A-Z0-9_]+$/u.test(node.name.text)) ||
        ts.isStringLiteral(node.name))
    ) {
      const key = ts.isIdentifier(node.name) ? node.name.text : node.name.text;
      const initializer = node.initializer.getText(sourceFile);
      if (initializer.includes(".enum([")) {
        const booleanControl = initializer.includes('["true", "false"]');
        const defaultValue =
          /\.default\("([^"\\]+)"\)/u.exec(initializer)?.[1] ?? "REQUIRED";
        const effectiveProperty = effectivePropertyForControl(sourceText, key);
        const consumers = files
          .filter((file) => resolve(file) !== schemaPath)
          .filter((file) => {
            const consumerSource = contents.get(file) ?? "";
            return (
              referencesRuntimeControl(consumerSource, key) ||
              (effectiveProperty !== null &&
                referencesEffectiveProperty(consumerSource, effectiveProperty))
            );
          })
          .map((file) => portable(relative(repository, file)))
          .sort();
        const status = runtimeControlStatus({
          booleanControl,
          consumers,
          defaultValue,
        });
        controls.push(
          Object.freeze({
            consumers: Object.freeze(consumers),
            defaultValue,
            effectiveProperty,
            key,
            kind: booleanControl ? "boolean" : "mode",
            launchClasses: launchClasses(key),
            owner: ownerFor(key),
            source: "lib/config/env-schema.ts" as const,
            status,
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const unique = new Map(controls.map((control) => [control.key, control]));
  if (unique.size !== controls.length) {
    throw new Error("Duplicate runtime-control definitions were discovered.");
  }
  return Object.freeze(
    [...unique.values()].sort((a, b) => a.key.localeCompare(b.key)),
  );
}

function exportedFunctionNames(sourceFile: ts.SourceFile) {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      names.push(statement.name.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        names.push(declaration.name.text);
      }
    }
  }
  return [...new Set(names)].sort();
}

function hasUseServerDirective(sourceFile: ts.SourceFile) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server",
  );
}

function routeScopeForAction(source: string) {
  if (!source.startsWith("app/")) {
    return `/_shared/${source
      .replace(/\.(?:ts|tsx)$/u, "")
      .replace(/^(?:components|lib|scripts)\//u, "")}`;
  }
  const segments = source
    .replace(/^app\//u, "")
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/u.test(segment));
  return `/${segments.join("/")}`.replace(/\/$/u, "") || "/";
}

function rolesForAction(
  source: string,
  action: string,
  routeScope: string,
): readonly string[] {
  if (source === "lib/notifications/server-actions.ts") {
    return ["AUTHENTICATED"];
  }
  if (source === "lib/auth/identity-actions.ts") {
    return action === "consumeEmailVerificationAction" ||
      action === "resendEmailVerificationAction"
      ? ["PUBLIC", "AUTHENTICATED"]
      : ["AUTHENTICATED"];
  }
  if (source === "lib/auth/server-actions.ts") {
    return [
      "switchCompanyContextAction",
      "switchPersonaContextAction",
      "createCandidatePersonaAction",
    ].includes(action)
      ? ["AUTHENTICATED"]
      : ["PUBLIC"];
  }
  return rolesForRouteScope(routeScope);
}

function rolesForRouteScope(path: string): readonly string[] {
  if (path === "/admin" || path.startsWith("/admin/")) return ["ADMIN"];
  if (path === "/candidate" || path.startsWith("/candidate/"))
    return ["CANDIDATE"];
  if (path === "/employer" || path.startsWith("/employer/")) {
    return ["EMPLOYER", "RECRUITER"];
  }
  if (path === "/support" || path.startsWith("/support/")) {
    return ["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"];
  }
  if (path === "/security" || path.startsWith("/security/"))
    return ["AUTHENTICATED"];
  if (path === "/mock" || path.startsWith("/mock/")) return ["LOCAL_DEMO"];
  return ["PUBLIC"];
}

function launchClasses(value: string): readonly string[] {
  return /(?:^|[\\/_-])(?:mock|local|sandbox)(?:[\\/_-]|$)/iu.test(value)
    ? ["LOCAL_CI"]
    : ["LC4", "LC5"];
}

function ownerFor(value: string) {
  const normalized = value.toUpperCase();
  if (/^LIB\/AUTH\//u.test(normalized)) return "Identity / Security";
  if (/(PRIVACY|LEGAL)/u.test(normalized)) return "Privacy / Legal";
  if (/(PAYMENT|PAID|BILLING|FINANCE|COMMERCIAL|STRIPE)/u.test(normalized)) {
    return "Billing / Finance";
  }
  if (
    /(IDENTITY|LOGIN|PERSONA|MFA|STEP_UP|BREAK_GLASS|SECURITY)/u.test(
      normalized,
    )
  ) {
    return "Identity / Security";
  }
  if (/COMPANY/u.test(normalized)) return "Company Trust";
  if (/(EMAIL|NOTIFICATION|DELIVERY)/u.test(normalized))
    return "Communications / Platform";
  if (/DOCUMENT/u.test(normalized)) return "Security / Documents";
  if (/(RATE_LIMIT|TRUST_RISK|ABUSE|REPORT)/u.test(normalized)) {
    return "Security / Trust & Safety";
  }
  if (/(APPLICATION|INTERVIEW|RECRUIT)/u.test(normalized)) {
    return "Recruiting Product";
  }
  if (/SEARCH/u.test(normalized)) return "Search / Privacy";
  if (/ANALYTICS/u.test(normalized)) return "Analytics / Privacy";
  if (/WORKER/u.test(normalized)) return "Platform / Operations";
  if (/ADMIN/u.test(normalized)) return "Administration / Security";
  if (/CANDIDATE/u.test(normalized)) return "Candidate Product";
  if (/(EMPLOYER|RECRUIT)/u.test(normalized)) return "Employer Product";
  return "Platform Engineering";
}

function referencesRuntimeControl(source: string, key: string) {
  return (
    source.includes(`.${key}`) ||
    source.includes(`["${key}"]`) ||
    source.includes(`['${key}']`) ||
    source.includes(`process.env.${key}`)
  );
}

function effectivePropertyForControl(source: string, key: string) {
  const match = new RegExp(
    `(?:^|\\n)\\s*([A-Za-z_$][A-Za-z0-9_$]*):\\s*environment\\.${key}\\b`,
    "u",
  ).exec(source);
  return match?.[1] ?? null;
}

function referencesEffectiveProperty(source: string, property: string) {
  return (
    source.includes(`.${property}`) ||
    source.includes(`["${property}"]`) ||
    source.includes(`['${property}']`)
  );
}

function runtimeControlStatus(input: {
  booleanControl: boolean;
  consumers: readonly string[];
  defaultValue: string;
}): RuntimeControlRecord["status"] {
  if (input.consumers.length > 0) return "RUNTIME_CONSUMED";
  if (input.booleanControl && input.defaultValue === "false") {
    return "DECLARED_FAIL_CLOSED";
  }
  return "CONFIGURATION_CONTRACT_ONLY";
}

function collectFiles(root: string, directories: readonly string[]) {
  return directories
    .flatMap((directory) => walk(resolve(root, directory)))
    .filter((file) => /\.(?:ts|tsx)$/u.test(file))
    .sort();
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && entry.name === "generated") return [];
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

function compareCommitted(
  path: string,
  observed: unknown,
  label: string,
  failures: string[],
) {
  if (!existsSync(path)) {
    failures.push(`Committed ${label} inventory is missing.`);
    return;
  }
  try {
    const expected = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(observed)) {
      failures.push(
        `Committed ${label} inventory differs from the source tree.`,
      );
    }
  } catch {
    failures.push(`Committed ${label} inventory is invalid JSON.`);
  }
}

function portable(value: string) {
  return value.replaceAll("\\", "/");
}

function fail(failures: readonly string[]): never {
  console.error(
    `Phase-33 surface inventory audit failed:\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
  process.exit();
}
