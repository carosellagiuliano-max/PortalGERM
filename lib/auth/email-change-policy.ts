export const LOGIN_EMAIL_CHANGE_POLICY_V1 = Object.freeze({
  schemaVersion: "login-email-change-v1",
  freshCredentialWindowMilliseconds: 5 * 60 * 1_000,
});

export function canCommitLoginEmailChange(input: Readonly<{
  pendingStatus: "PENDING" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  challengeEpoch: number;
  currentEpoch: number;
  initiatedBySessionId: string;
  currentSessionId: string;
  expiresAt: Date;
  now: Date;
}>) {
  return (
    input.pendingStatus === "PENDING" &&
    input.challengeEpoch === input.currentEpoch + 1 &&
    input.initiatedBySessionId === input.currentSessionId &&
    input.expiresAt.getTime() > input.now.getTime()
  );
}
