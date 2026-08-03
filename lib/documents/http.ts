import { NextResponse } from "next/server";

export function documentJson(
  body: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export async function readBoundedJson(
  request: Request,
  maximumBytes = 4_096,
): Promise<unknown | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) return null;
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d{1,7}$/u.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    return null;
  }
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const text = Buffer.concat(chunks, totalBytes).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function webReadableToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) return;
          yield result.value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function asyncIterableToWebReadable(
  source: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export function safeContentDisposition(filename: string): string {
  return `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
