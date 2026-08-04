export const SESSION_REFRESH_AFTER_HEADER =
  "X-Session-Refresh-After-Milliseconds" as const;
export const SESSION_REFRESH_STATE_HEADER = "X-Session-Refresh-State" as const;
export const SESSION_REFRESH_STATES = Object.freeze({
  current: "CURRENT",
  staged: "STAGED",
});

export const SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS = 60_000;
export const SESSION_REFRESH_STALE_RETRY_MILLISECONDS = 1_000;

export function parseSessionRefreshDelay(value: string | null): number | null {
  if (value === null || !/^\d{1,12}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
