export class AuthenticationRequiredError extends Error {
  readonly code = "AUTHENTICATION_REQUIRED" as const;
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("This capability is not available.");
    this.name = "AuthorizationDeniedError";
  }
}

/** Same error for foreign and absent objects to avoid an IDOR oracle. */
export class SafeNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Resource not found.");
    this.name = "SafeNotFoundError";
  }
}
