import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type LockPackage = Readonly<{
  license?: unknown;
  name?: unknown;
  version?: unknown;
}>;

const lock = JSON.parse(
  readFileSync(resolve(process.cwd(), "package-lock.json"), "utf8"),
) as {
  packages?: Record<string, LockPackage>;
};
const packages = Object.entries(lock.packages ?? {}).filter(
  ([path]) => path !== "",
);
const forbidden: string[] = [];
const review: string[] = [];
const missing: string[] = [];
const licenseCounts = new Map<string, number>();

for (const [path, entry] of packages) {
  const name = typeof entry.name === "string" ? entry.name : packageName(path);
  const version =
    typeof entry.version === "string" ? entry.version : "unknown";
  const identity = `${name}@${version}`;
  const license =
    typeof entry.license === "string" ? entry.license.trim() : undefined;
  if (license === undefined || license === "") {
    missing.push(identity);
    continue;
  }
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
  if (/\b(?:AGPL|SSPL|BUSL|Commons-Clause)\b/iu.test(license)) {
    forbidden.push(`${identity} (${license})`);
  } else if (/\b(?:LGPL|GPL|MPL|CC-BY)\b/iu.test(license)) {
    review.push(`${identity} (${license})`);
  }
}

const acceptedMissingMetadata = new Set(["seq-queue@0.0.5"]);
const unresolvedMissing = missing.filter(
  (identity) => !acceptedMissingMetadata.has(identity),
);
if (forbidden.length > 0 || unresolvedMissing.length > 0) {
  console.error(
    [
      "License audit failed.",
      ...(forbidden.length === 0
        ? []
        : [`Forbidden licenses: ${forbidden.join(", ")}.`]),
      ...(unresolvedMissing.length === 0
        ? []
        : [`Missing license metadata: ${unresolvedMissing.join(", ")}.`]),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.info(
    `License audit passed for ${packages.length} lockfile packages: 0 forbidden licenses, ${review.length} reciprocal/attribution review item(s), ${missing.length} accepted missing-metadata item(s), ${licenseCounts.size} declared license expressions.`,
  );
  if (review.length > 0) {
    console.info(
      "Reciprocal/attribution items require distribution-time legal review; this technical scan is not legal approval.",
    );
  }
}

function packageName(path: string) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index === -1 ? path : path.slice(index + marker.length);
}
