"use client";

import { useEffect } from "react";

export function SessionRefresh() {
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/session/refresh", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  return null;
}
