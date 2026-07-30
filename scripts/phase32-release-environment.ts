import { safeToolEnvironment } from "@/scripts/ops/process-tools";

const PHASE32_RELEASE_ENVIRONMENT_KEYS = Object.freeze([
  "LANG",
  "LC_ALL",
  "TERM",
  "GITHUB_SHA",
  "NODE_EXTRA_CA_CERTS",
  "npm_execpath",
  "npm_node_execpath",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "SESSION_SECRET",
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "AGE_BINARY",
  "AGE_KEYGEN_BINARY",
  "PHASE32_EXTERNAL_G4_BUNDLE_PATH",
  "PHASE32_EXTERNAL_G4_BUNDLE_SHA256",
  "PHASE32_APPROVAL_KEY_REGISTRY_PATH",
  "PHASE32_APPROVAL_KEY_REGISTRY_SHA256",
  "PHASE32_APPROVAL_ROOT_PUBLIC_KEY_SHA256",
  "PHASE32_EPHEMERAL_ROOT",
] as const);

const PHASE32_FORBIDDEN_INHERITED_TOOL_KEYS = new Set([
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "COMPOSE_PROJECT_NAME",
  "COMPOSE_FILE",
  "XDG_CONFIG_HOME",
  "NPM_CONFIG_USERCONFIG",
  "npm_config_userconfig",
]);

export function phase32InheritedReleaseEnvironment(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  const phase32Entries = PHASE32_RELEASE_ENVIRONMENT_KEYS.flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : ([[name, value]] as const);
  });

  const localToolEnvironment = safeToolEnvironment(environment);
  const localToolEntries = Object.entries(localToolEnvironment).filter(
    ([name]) => !PHASE32_FORBIDDEN_INHERITED_TOOL_KEYS.has(name),
  );

  return {
    NODE_ENV: localToolEnvironment.NODE_ENV,
    ...Object.fromEntries(localToolEntries),
    ...Object.fromEntries(phase32Entries),
  };
}
