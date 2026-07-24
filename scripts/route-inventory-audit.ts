import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

type RouteRecord = Readonly<{
  kind: "page" | "handler";
  path: string;
  roles: readonly string[];
}>;

const repository = process.cwd();
const appDirectory = resolve(repository, "app");
const inventoryPath = resolve(repository, "codex-plan", "route-inventory.json");
const print = process.argv.includes("--print");
const write = process.argv.includes("--write");

const observed = Object.freeze(
  collectRouteFiles(appDirectory)
    .map(toRouteRecord)
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.kind.localeCompare(right.kind),
    ),
);

if (print || write) {
  if (write) {
    writeFileSync(inventoryPath, `${JSON.stringify(observed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    console.info(
      `Updated codex-plan/route-inventory.json with ${observed.length} reviewed routes.`,
    );
    process.exit(0);
  }
  console.info(`${JSON.stringify(observed, null, 2)}\n`);
  process.exit(0);
}

const failures: string[] = [];
if (!existsSync(inventoryPath)) {
  failures.push("codex-plan/route-inventory.json is missing.");
} else {
  const expected = JSON.parse(readFileSync(inventoryPath, "utf8")) as unknown;
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    failures.push(
      "Committed route inventory differs from the implemented app tree; run `npm run route:audit -- --print` and review the change.",
    );
  }
}

for (const area of ["candidate", "employer", "admin"]) {
  if (!existsSync(resolve(appDirectory, area, "layout.tsx"))) {
    failures.push(`Protected /${area} is missing layout.tsx.`);
  }
  if (existsSync(resolve(appDirectory, area, "loading.tsx"))) {
    failures.push(
      `Protected /${area} has a broad loading.tsx that can stream before tenant/owner 404 guards.`,
    );
  }
}

const duplicateKeys = observed
  .map((route) => `${route.kind}:${route.path}`)
  .filter((key, index, all) => all.indexOf(key) !== index);
if (duplicateKeys.length > 0) {
  failures.push(`Duplicate routes: ${[...new Set(duplicateKeys)].join(", ")}.`);
}

if (failures.length > 0) {
  console.error(`Route inventory audit failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  const pages = observed.filter((route) => route.kind === "page").length;
  const handlers = observed.length - pages;
  console.info(
    `Route inventory audit passed: ${pages} pages, ${handlers} handlers; Candidate/Employer/Admin layouts present and broad private loading boundaries absent.`,
  );
}

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(path);
    return entry.isFile() &&
      (entry.name === "page.tsx" || entry.name === "route.ts")
      ? [path]
      : [];
  });
}

function toRouteRecord(file: string): RouteRecord {
  const segments = relative(appDirectory, file)
    .replaceAll("\\", "/")
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.+\)$/u.test(segment));
  const path = `/${segments.join("/")}`.replace(/\/$/u, "") || "/";
  return Object.freeze({
    kind: file.endsWith("page.tsx") ? "page" : "handler",
    path,
    roles: rolesFor(path),
  });
}

function rolesFor(path: string): readonly string[] {
  if (path === "/forbidden") return ["PUBLIC"];
  if (isAtOrBelow(path, "/candidate")) return ["CANDIDATE"];
  if (isAtOrBelow(path, "/employer")) return ["EMPLOYER", "RECRUITER"];
  if (isAtOrBelow(path, "/admin")) return ["ADMIN"];
  if (path === "/support" || path.startsWith("/support/")) {
    return ["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"];
  }
  if (isAtOrBelow(path, "/mock/checkout")) return ["EMPLOYER"];
  if (path === "/logout" || path.startsWith("/session/")) {
    return ["AUTHENTICATED"];
  }
  if (path === "/dev/mailbox") return ["LOCAL_OPS_TOKEN"];
  if (path.startsWith("/health/")) return ["PUBLIC_OPERATIONS"];
  return ["PUBLIC"];
}

function isAtOrBelow(path: string, boundary: string) {
  return path === boundary || path.startsWith(`${boundary}/`);
}
