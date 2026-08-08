import type { AiProvider } from "./ai-provider";
import { MockAiProvider } from "./mock-ai-provider";
import type { ApplicationEnvironment } from "@/lib/config/application-environment";
import { isIsolatedSandboxEnvironment } from "@/lib/config/application-environment";

export type { AiProvider } from "./ai-provider";
export { MockAiProvider } from "./mock-ai-provider";

const localMockAiProvider: AiProvider = new MockAiProvider();

/**
 * The deterministic Phase-04 helper is a Local/CI test tool, not a production
 * provider. Preview and public runtimes receive no adapter and therefore
 * cannot invoke it through a forged Server Action request.
 */
export function resolveAiProvider(
  environment: ApplicationEnvironment,
): AiProvider | undefined {
  return isIsolatedSandboxEnvironment(environment)
    ? localMockAiProvider
    : undefined;
}
