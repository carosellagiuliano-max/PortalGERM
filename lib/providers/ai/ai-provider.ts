export interface AiProvider {
  improveJobText(text: string): Promise<string>;
  rewriteInclusive(text: string): Promise<string>;
  shortenRequirements(text: string): Promise<string>;
  suggestFairScoreImprovements(job: {
    title: string;
    tasks: string;
    requirements: string;
    offer: string;
    salaryMin?: number;
    salaryMax?: number;
  }): Promise<string[]>;
  explainMatch(reasons: string[], missing: string[]): Promise<string>;
  draftRejectionMessage(context: { jobTitle: string }): Promise<string>;
  draftInterviewInvitation(context: {
    jobTitle: string;
    suggestedSlots: string[];
  }): Promise<string>;
  draftEmployerProfileText(context: {
    companyName: string;
    industry: string;
    values?: string;
  }): Promise<string>;
}
