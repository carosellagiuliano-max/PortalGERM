"use client";

import { useEffect } from "react";

import {
  parseSessionRefreshDelay,
  SESSION_REFRESH_AFTER_HEADER,
  SESSION_REFRESH_STATE_HEADER,
  SESSION_REFRESH_STATES,
  SESSION_REFRESH_STALE_RETRY_MILLISECONDS,
  SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS,
} from "@/lib/auth/session-refresh-contract";

const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_483_647;
const MAXIMUM_STALE_SESSION_RETRIES = 1;
const SESSION_REFRESH_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

export function SessionRefresh({
  initialDelayMilliseconds,
}: Readonly<{ initialDelayMilliseconds: number }>) {
  useEffect(() => {
    let active = true;
    let pageVisible = document.visibilityState === "visible";
    let nextRotationAt =
      performance.now() + Math.max(0, initialDelayMilliseconds);
    let staleSessionRetries = 0;
    let stagedConfirmationPending = false;
    let timer: number | undefined;
    let request: XMLHttpRequest | null = null;

    const cancelTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      cancelTimer();
      if (!active || !pageVisible || request !== null) return;
      const delay = Math.min(
        Math.max(0, nextRotationAt - performance.now()),
        MAXIMUM_TIMER_DELAY_MILLISECONDS,
      );
      timer = window.setTimeout(send, delay);
    };
    const scheduleAfter = (delayMilliseconds: number) => {
      nextRotationAt = performance.now() + Math.max(0, delayMilliseconds);
      schedule();
    };
    const scheduleTransientRetry = (serverDelay: number | null = null) => {
      scheduleAfter(
        serverDelay ?? SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS,
      );
    };
    const send = () => {
      timer = undefined;
      if (!active || !pageVisible || document.visibilityState !== "visible") {
        return;
      }

      const current = new XMLHttpRequest();
      request = current;
      current.open("POST", "/session/refresh", true);
      current.withCredentials = true;
      current.timeout = SESSION_REFRESH_REQUEST_TIMEOUT_MILLISECONDS;
      current.onload = () => {
        if (request !== current) return;
        request = null;
        const serverDelay = parseSessionRefreshDelay(
          current.getResponseHeader(SESSION_REFRESH_AFTER_HEADER),
        );
        if (current.status === 204) {
          staleSessionRetries = 0;
          const state = current.getResponseHeader(SESSION_REFRESH_STATE_HEADER);
          if (state === SESSION_REFRESH_STATES.staged) {
            if (stagedConfirmationPending) {
              scheduleTransientRetry();
            } else {
              stagedConfirmationPending = true;
              scheduleAfter(0);
            }
          } else if (state === SESSION_REFRESH_STATES.current) {
            stagedConfirmationPending = false;
            scheduleTransientRetry(serverDelay);
          } else {
            scheduleTransientRetry();
          }
          return;
        }
        if (
          current.status === 401 &&
          staleSessionRetries < MAXIMUM_STALE_SESSION_RETRIES
        ) {
          staleSessionRetries += 1;
          scheduleAfter(
            serverDelay ?? SESSION_REFRESH_STALE_RETRY_MILLISECONDS,
          );
          return;
        }
        if (
          current.status === 0 ||
          current.status === 409 ||
          current.status === 429 ||
          current.status >= 500
        ) {
          scheduleTransientRetry(serverDelay);
        }
      };
      current.onerror = () => {
        if (request !== current) return;
        request = null;
        scheduleTransientRetry();
      };
      current.ontimeout = () => {
        if (request !== current) return;
        request = null;
        scheduleTransientRetry();
      };
      current.onabort = () => {
        if (request !== current) return;
        request = null;
        if (active) scheduleTransientRetry();
      };
      try {
        current.send();
      } catch {
        if (request !== current) return;
        request = null;
        scheduleTransientRetry();
      }
    };
    const handlePageHide = () => {
      pageVisible = false;
      cancelTimer();
    };
    const handlePageShow = () => {
      pageVisible = document.visibilityState === "visible";
      schedule();
    };
    const handleVisibilityChange = () => {
      pageVisible = document.visibilityState === "visible";
      if (pageVisible) schedule();
      else cancelTimer();
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule();

    return () => {
      active = false;
      cancelTimer();
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const current = request;
      request = null;
      if (current !== null) {
        current.onload = null;
        current.onerror = null;
        current.ontimeout = null;
        current.onabort = null;
      }
    };
  }, [initialDelayMilliseconds]);

  return null;
}
