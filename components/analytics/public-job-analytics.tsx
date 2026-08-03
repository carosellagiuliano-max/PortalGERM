"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const SESSION_STORAGE_KEY = "swisstalenthub.product-analytics-session.v1";
const PUBLIC_JOB_ANALYTICS_ENDPOINT = "/api/analytics/public-jobs";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const subscribeToStableSession = () => () => undefined;
let cachedClientSessionId: string | undefined;

export function useProductAnalyticsSessionId(): string {
  return useSyncExternalStore(
    subscribeToStableSession,
    readClientSessionId,
    emptyServerSessionId,
  );
}

function readClientSessionId(): string {
  if (cachedClientSessionId !== undefined) return cachedClientSessionId;
  const stored = globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY);
  cachedClientSessionId =
    stored !== null && UUID_PATTERN.test(stored)
      ? stored
      : globalThis.crypto.randomUUID();
  if (stored !== cachedClientSessionId) {
    globalThis.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      cachedClientSessionId,
    );
  }
  return cachedClientSessionId;
}

function emptyServerSessionId() {
  return "";
}

export function PublicSearchResultsAnalytics({
  resultCountBucket,
  sort,
  cantonCode,
  categorySlug,
  searchQuery,
  searchFilters,
}: Readonly<{
  resultCountBucket: "0" | "1-9" | "10-24" | "25-49" | "50+";
  sort: "relevance" | "newest" | "fair-score" | "salary" | "response";
  cantonCode?: string;
  categorySlug?: string;
  searchQuery?: string;
  searchFilters?: Readonly<Record<string, string | number | boolean>>;
}>) {
  const analyticsSessionId = useProductAnalyticsSessionId();
  const event = useRef<Readonly<{ key: string; id: string }> | null>(null);
  useEffect(() => {
    if (analyticsSessionId === "") return;
    const eventKey = JSON.stringify([
      resultCountBucket,
      sort,
      cantonCode ?? null,
      categorySlug ?? null,
      searchQuery ?? null,
      searchFilters ?? null,
    ]);
    if (event.current?.key !== eventKey) {
      event.current = Object.freeze({
        key: eventKey,
        id: globalThis.crypto.randomUUID(),
      });
    }
    recordPublicJobAnalytics({
      kind: "SEARCH_RESULTS_VIEWED",
      eventId: event.current.id,
      analyticsSessionId,
      resultCountBucket,
      sort,
      cantonCode,
      categorySlug,
      searchQuery,
      searchFilters,
    });
  }, [
    analyticsSessionId,
    cantonCode,
    categorySlug,
    resultCountBucket,
    searchFilters,
    searchQuery,
    sort,
  ]);
  return null;
}

export function PublicJobDetailAnalytics({
  jobSlug,
}: Readonly<{ jobSlug: string }>) {
  const analyticsSessionId = useProductAnalyticsSessionId();
  const event = useRef<Readonly<{ key: string; id: string }> | null>(null);
  useEffect(() => {
    if (analyticsSessionId === "") return;
    if (event.current?.key !== jobSlug) {
      event.current = Object.freeze({
        key: jobSlug,
        id: globalThis.crypto.randomUUID(),
      });
    }
    recordPublicJobAnalytics({
      kind: "JOB_DETAIL_VIEWED",
      eventId: event.current.id,
      analyticsSessionId,
      jobSlug,
    });
  }, [analyticsSessionId, jobSlug]);
  return null;
}

function recordPublicJobAnalytics(
  event: Readonly<Record<string, unknown>>,
): void {
  const body = JSON.stringify(event);
  void fetch(PUBLIC_JOB_ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
    mode: "same-origin",
  }).catch(() => undefined);
}
