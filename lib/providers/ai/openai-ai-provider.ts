import type { AiProvider } from "./ai-provider";

export const OPENAI_AI_PROVIDER_UNAVAILABLE =
  "OpenAI ist im Mock-MVP nicht verfügbar. Verwenden Sie den expliziten MockAiProvider.";

/**
 * Architecture placeholder only. It is intentionally not wired, reads no
 * credentials, and performs no HTTP request.
 */
export class OpenAiAiProvider implements AiProvider {
  async improveJobText(_text: string): Promise<string> {
    return unavailable();
  }

  async rewriteInclusive(_text: string): Promise<string> {
    return unavailable();
  }

  async shortenRequirements(_text: string): Promise<string> {
    return unavailable();
  }

  async suggestFairScoreImprovements(_job: {
    title: string;
    tasks: string;
    requirements: string;
    offer: string;
    salaryMin?: number;
    salaryMax?: number;
  }): Promise<string[]> {
    return unavailable();
  }

  async explainMatch(_reasons: string[], _missing: string[]): Promise<string> {
    return unavailable();
  }

  async draftRejectionMessage(_context: { jobTitle: string }): Promise<string> {
    return unavailable();
  }

  async draftInterviewInvitation(_context: {
    jobTitle: string;
    suggestedSlots: string[];
  }): Promise<string> {
    return unavailable();
  }

  async draftEmployerProfileText(_context: {
    companyName: string;
    industry: string;
    values?: string;
  }): Promise<string> {
    return unavailable();
  }
}

function unavailable(): never {
  throw new Error(OPENAI_AI_PROVIDER_UNAVAILABLE);
}
