import type { AiProvider } from "./ai-provider";
import { MockAiProvider } from "./mock-ai-provider";

export type { AiProvider } from "./ai-provider";
export { MockAiProvider } from "./mock-ai-provider";

/** Explicit Phase-04 composition root: no environment key can select OpenAI. */
export const aiProvider: AiProvider = new MockAiProvider();
