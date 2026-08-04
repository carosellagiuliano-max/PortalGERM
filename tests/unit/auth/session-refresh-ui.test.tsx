import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionRefresh } from "@/components/auth/session-refresh";
import {
  SESSION_REFRESH_AFTER_HEADER,
  SESSION_REFRESH_STATE_HEADER,
  SESSION_REFRESH_STATES,
} from "@/lib/auth/session-refresh-contract";

const NOW = new Date("2026-08-04T00:00:00.000Z");

describe("session refresh client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits until rotation is due and detaches without aborting an in-flight request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { requests, open, send, abort } = installXmlHttpRequestStub();

    const view = render(<SessionRefresh initialDelayMilliseconds={1_000} />);

    expect(requests).toHaveLength(0);
    act(() => vi.advanceTimersByTime(999));
    expect(requests).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));

    expect(requests).toHaveLength(1);
    expect(open).toHaveBeenCalledWith("POST", "/session/refresh", true);
    expect(requests[0]?.withCredentials).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();

    view.unmount();
    expect(abort).not.toHaveBeenCalled();
  });

  it("does not start a refresh while the page is leaving", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { requests } = installXmlHttpRequestStub();
    const view = render(<SessionRefresh initialDelayMilliseconds={1_000} />);

    act(() => window.dispatchEvent(new Event("pagehide")));
    act(() => vi.advanceTimersByTime(1_000));
    expect(requests).toHaveLength(0);

    act(() => window.dispatchEvent(new Event("pageshow")));
    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(1);
    view.unmount();
  });

  it("uses server-authoritative retry delays and bounds stale-session retries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { requests } = installXmlHttpRequestStub();
    const view = render(<SessionRefresh initialDelayMilliseconds={0} />);

    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(1);
    act(() => requests[0]?.respond(204, 5_000, SESSION_REFRESH_STATES.current));
    act(() => vi.advanceTimersByTime(4_999));
    expect(requests).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(requests).toHaveLength(2);

    act(() => requests[1]?.respond(500, 2_000));
    act(() => vi.advanceTimersByTime(2_000));
    expect(requests).toHaveLength(3);
    act(() => requests[2]?.respond(401, 1_000));
    act(() => vi.advanceTimersByTime(1_000));
    expect(requests).toHaveLength(4);
    act(() => requests[3]?.respond(401, 1_000));
    act(() => vi.advanceTimersByTime(10_000));
    expect(requests).toHaveLength(4);
    view.unmount();
  });

  it("confirms a staged token immediately before scheduling the next cycle", () => {
    vi.useFakeTimers();
    const { requests } = installXmlHttpRequestStub();
    const view = render(<SessionRefresh initialDelayMilliseconds={0} />);

    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(1);
    act(() =>
      requests[0]?.respond(204, 86_400_000, SESSION_REFRESH_STATES.staged),
    );
    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(2);
    view.unmount();
  });

  it("backs off when a browser rejects the staged cookie", () => {
    vi.useFakeTimers();
    const { requests } = installXmlHttpRequestStub();
    const view = render(<SessionRefresh initialDelayMilliseconds={0} />);

    act(() => vi.runOnlyPendingTimers());
    act(() =>
      requests[0]?.respond(204, 86_400_000, SESSION_REFRESH_STATES.staged),
    );
    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(2);

    act(() =>
      requests[1]?.respond(204, 86_400_000, SESSION_REFRESH_STATES.staged),
    );
    act(() => vi.advanceTimersByTime(59_999));
    expect(requests).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(requests).toHaveLength(3);
    view.unmount();
  });

  it("times out a half-open request before retrying with bounded backoff", () => {
    vi.useFakeTimers();
    const { requests } = installXmlHttpRequestStub();
    const view = render(<SessionRefresh initialDelayMilliseconds={0} />);

    act(() => vi.runOnlyPendingTimers());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.timeout).toBe(15_000);
    act(() => requests[0]?.timeOut());
    act(() => vi.advanceTimersByTime(59_999));
    expect(requests).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(requests).toHaveLength(2);
    view.unmount();
  });
});

function installXmlHttpRequestStub() {
  const open = vi.fn();
  const send = vi.fn();
  const abort = vi.fn();
  const requests: StubXMLHttpRequest[] = [];

  class StubXMLHttpRequest {
    status = 0;
    timeout = 0;
    withCredentials = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private responseHeaders = new Map<string, string>();

    constructor() {
      requests.push(this);
    }

    open = open;
    send = send;
    abort = abort;
    getResponseHeader = (name: string) =>
      this.responseHeaders.get(name.toLowerCase()) ?? null;
    respond(
      status: number,
      refreshAfterMilliseconds?: number,
      state?: (typeof SESSION_REFRESH_STATES)[keyof typeof SESSION_REFRESH_STATES],
    ) {
      this.status = status;
      if (refreshAfterMilliseconds !== undefined) {
        this.responseHeaders.set(
          SESSION_REFRESH_AFTER_HEADER.toLowerCase(),
          String(refreshAfterMilliseconds),
        );
      }
      if (state !== undefined) {
        this.responseHeaders.set(
          SESSION_REFRESH_STATE_HEADER.toLowerCase(),
          state,
        );
      }
      this.onload?.();
    }
    timeOut() {
      this.ontimeout?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", StubXMLHttpRequest);
  return { requests, open, send, abort };
}
