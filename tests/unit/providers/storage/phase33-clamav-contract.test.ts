import { createServer, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ClamAvMalwareScanner } from "@/lib/providers/storage/clamav-malware-scanner";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
  "ascii",
);
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    ),
  );
});

describe("Phase-33 ClamAV INSTREAM contract", () => {
  it("sends bounded bytes and accepts only the exact CLEAN response", async () => {
    const fixture = await listen("stream: OK");
    const scanner = new ClamAvMalwareScanner({
      host: "127.0.0.1",
      port: fixture.port,
      providerClass: "clamav-contract-v1",
      tls: false,
    });

    await expect(
      scanner.scan(chunks(PDF, 7), {
        declaredMimeType: "application/pdf",
        timeoutMilliseconds: 2_000,
      }),
    ).resolves.toEqual({
      engineVersion: "clamav-1.4.3",
      signatureVersion: "daily-27700",
      outcome: "CLEAN",
      outcomeCode: "CLAMAV_CLEAN",
      detectedMimeType: "application/pdf",
    });
    expect(fixture.scannedBodies).toEqual([PDF]);
  });

  it("normalizes FOUND receipts without exposing arbitrary provider text", async () => {
    const fixture = await listen("stream: Win.Test.Agent FOUND");
    const scanner = new ClamAvMalwareScanner({
      host: "127.0.0.1",
      port: fixture.port,
      providerClass: "clamav-contract-v1",
      tls: false,
    });

    await expect(
      scanner.scan(chunks(PDF, 11), {
        declaredMimeType: "application/pdf",
        timeoutMilliseconds: 2_000,
      }),
    ).resolves.toMatchObject({
      outcome: "INFECTED",
      outcomeCode: "CLAMAV_FOUND_WIN_TEST_AGENT",
      detectedMimeType: "application/pdf",
    });
  });

  it("fails closed on timeout and malformed provider responses", async () => {
    const stalled = await listen(null);
    const timeoutScanner = new ClamAvMalwareScanner({
      host: "127.0.0.1",
      port: stalled.port,
      providerClass: "clamav-contract-v1",
      tls: false,
    });
    await expect(
      timeoutScanner.scan(chunks(PDF, PDF.length), {
        declaredMimeType: "application/pdf",
        timeoutMilliseconds: 50,
      }),
    ).resolves.toMatchObject({
      outcome: "TIMEOUT",
      outcomeCode: "CLAMAV_TIMEOUT",
    });

    const malformed = await listen("unexpected provider output");
    const malformedScanner = new ClamAvMalwareScanner({
      host: "127.0.0.1",
      port: malformed.port,
      providerClass: "clamav-contract-v1",
      tls: false,
    });
    await expect(
      malformedScanner.scan(chunks(PDF, PDF.length), {
        declaredMimeType: "application/pdf",
        timeoutMilliseconds: 2_000,
      }),
    ).resolves.toMatchObject({
      outcome: "FAILED",
      outcomeCode: "CLAMAV_PROTOCOL_ERROR",
    });
  });
});

async function listen(scanReply: string | null): Promise<{
  port: number;
  scannedBodies: Buffer[];
}> {
  const scannedBodies: Buffer[] = [];
  const server = createServer((socket) => handle(socket, scanReply, scannedBodies));
  servers.push(server);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("TEST_SERVER_ADDRESS_MISSING");
  }
  return { port: address.port, scannedBodies };
}

function handle(
  socket: Socket,
  scanReply: string | null,
  scannedBodies: Buffer[],
): void {
  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.subarray(0, 9).equals(Buffer.from("zVERSION\0", "ascii"))) {
      if (scanReply !== null) {
        socket.end("ClamAV 1.4.3/27700/Sat Aug 1 00:00:00 2026\0");
      }
      return;
    }
    const prefix = Buffer.from("zINSTREAM\0", "ascii");
    if (!buffered.subarray(0, prefix.length).equals(prefix)) return;
    let offset = prefix.length;
    const body: Buffer[] = [];
    while (buffered.length >= offset + 4) {
      const size = buffered.readUInt32BE(offset);
      offset += 4;
      if (size === 0) {
        scannedBodies.push(Buffer.concat(body));
        if (scanReply !== null) socket.end(`${scanReply}\0`);
        return;
      }
      if (buffered.length < offset + size) return;
      body.push(Buffer.from(buffered.subarray(offset, offset + size)));
      offset += size;
    }
  });
}

async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
  }
}
