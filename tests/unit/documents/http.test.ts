// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { readBoundedJson } from "@/lib/documents/http";

describe("bounded document JSON", () => {
  it("parses a valid body assembled from multiple chunks", async () => {
    const encoder = new TextEncoder();
    const body = streamRequest([
      encoder.encode('{"status":"'),
      encoder.encode('ready"}'),
    ]);

    await expect(readBoundedJson(body, 64)).resolves.toEqual({
      status: "ready",
    });
  });

  it("cancels an undeclared streaming body as soon as it exceeds the limit", async () => {
    const cancel = vi.fn();
    const body = streamRequest([new Uint8Array(4_097)], cancel);

    await expect(readBoundedJson(body, 4_096)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a lying content length using the bytes actually read", async () => {
    const body = streamRequest([new Uint8Array(4_097)], undefined, {
      "Content-Length": "1",
    });

    await expect(readBoundedJson(body, 4_096)).resolves.toBeNull();
  });

  it("rejects an invalid declared length before consuming the stream", async () => {
    const body = streamRequest([new Uint8Array([123])], undefined, {
      "Content-Length": "NaN",
    });

    await expect(readBoundedJson(body, 4_096)).resolves.toBeNull();
    expect(body.bodyUsed).toBe(false);
  });
});

function streamRequest(
  chunks: readonly Uint8Array[],
  cancel?: () => void,
  headers?: Readonly<Record<string, string>>,
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel,
  });
  return new Request("https://example.test/documents", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
