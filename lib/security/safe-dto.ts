export type CandidateApplicationDto = Readonly<{
  id: string;
  jobId: string;
  status: string;
  submittedAt: Date;
  updatedAt: Date;
  rejectionReason: string | null;
}>;

export function toCandidateApplicationDto(input: Readonly<{
  id: string;
  jobId: string;
  status: string;
  submittedAt: Date;
  updatedAt: Date;
  rejectionReason?: string | null;
}>): CandidateApplicationDto {
  return Object.freeze({
    id: input.id,
    jobId: input.jobId,
    status: input.status,
    submittedAt: new Date(input.submittedAt),
    updatedAt: new Date(input.updatedAt),
    rejectionReason: input.rejectionReason ?? null,
  });
}

export type EmployerApplicationDto = Readonly<{
  id: string;
  jobId: string;
  candidateProfileId: string;
  status: string;
  submittedAt: Date;
  candidateDisplayName: string;
}>;

export function toEmployerApplicationDto(input: Readonly<{
  id: string;
  jobId: string;
  candidateProfileId: string;
  status: string;
  submittedAt: Date;
  candidateDisplayName: string;
}>): EmployerApplicationDto {
  return Object.freeze({
    id: input.id,
    jobId: input.jobId,
    candidateProfileId: input.candidateProfileId,
    status: input.status,
    submittedAt: new Date(input.submittedAt),
    candidateDisplayName: input.candidateDisplayName,
  });
}
