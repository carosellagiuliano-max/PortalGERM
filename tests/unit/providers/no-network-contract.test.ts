// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MockAiProvider } from "@/lib/providers/ai/mock-ai-provider";
import { OpenAiAiProvider } from "@/lib/providers/ai/openai-ai-provider";
import { MockCommuteProvider } from "@/lib/providers/commute/mock-commute-provider";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import { JOBROOM_FIXTURE_IDS } from "@/lib/providers/jobroom/fixtures/occupation-codes-2026";
import { MockJobroomProvider } from "@/lib/providers/jobroom/mock-jobroom-provider";
import { MockPaymentProvider } from "@/lib/providers/payments/mock-payment-provider";
import { StripePaymentProvider } from "@/lib/providers/payments/stripe-payment-provider";
import { MockStorageProvider } from "@/lib/providers/storage/mock-storage-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase-04 external-network boundary", () => {
  it("runs every mock and real-provider placeholder with fetch denied", async () => {
    const denyNetwork = () => {
      throw new Error("External network access is denied in provider tests.");
    };
    const deniedFetch = vi.fn(denyNetwork);
    vi.stubGlobal("fetch", deniedFetch);
    const require = createRequire(import.meta.url);
    const http = require("node:http") as typeof import("node:http");
    const https = require("node:https") as typeof import("node:https");
    const net = require("node:net") as typeof import("node:net");
    const tls = require("node:tls") as typeof import("node:tls");
    const transportSpies = [
      vi.spyOn(http, "request").mockImplementation(
        denyNetwork as unknown as typeof http.request,
      ),
      vi.spyOn(http, "get").mockImplementation(
        denyNetwork as unknown as typeof http.get,
      ),
      vi.spyOn(https, "request").mockImplementation(
        denyNetwork as unknown as typeof https.request,
      ),
      vi.spyOn(https, "get").mockImplementation(
        denyNetwork as unknown as typeof https.get,
      ),
      vi.spyOn(net, "connect").mockImplementation(
        denyNetwork as unknown as typeof net.connect,
      ),
      vi.spyOn(net, "createConnection").mockImplementation(
        denyNetwork as unknown as typeof net.createConnection,
      ),
      vi.spyOn(tls, "connect").mockImplementation(
        denyNetwork as unknown as typeof tls.connect,
      ),
    ];

    const payment = new MockPaymentProvider();
    await payment.createCheckout({
      orderId: "provider-network-contract-order",
      idempotencyKey: "provider-network-contract-checkout",
      successUrl: "/billing/success",
      cancelUrl: "/billing/cancel",
    });
    await payment.confirmPayment({
      orderId: "provider-network-contract-order",
      idempotencyKey: "provider-network-contract-confirm",
    });
    await payment.cancel({
      orderId: "provider-network-contract-order",
      idempotencyKey: "provider-network-contract-cancel",
    });

    const storage = new MockStorageProvider({
      keyFactory: () => "provider-network-contract-file",
    });
    const stored = await storage.upload({
      fileName: "lebenslauf.pdf",
      mimeType: "application/pdf",
      size: 1,
    });
    await storage.getReadUrl(stored.storageKey);
    await storage.delete(stored.storageKey);

    await new MockCommuteProvider({
      zurich: { latitude: 47.3769, longitude: 8.5417 },
      bern: { latitude: 46.948, longitude: 7.4474 },
    }).getDistanceKm({ from: "zurich", to: "bern" });

    const ai = new MockAiProvider();
    await ai.improveJobText("Wir suchen eine Fachperson.");
    await ai.rewriteInclusive("Wir suchen Mitarbeiter.");
    await ai.shortenRequirements("TypeScript. PostgreSQL. Deutsch B2.");
    await ai.suggestFairScoreImprovements({
      title: "Software Engineer",
      tasks: "Planen. Entwickeln. Testen.",
      requirements: "TypeScript. PostgreSQL. Deutsch B2.",
      offer: "Homeoffice. Ferien. Weiterbildung.",
      salaryMin: 100_000,
      salaryMax: 120_000,
    });
    await ai.explainMatch(["TypeScript"], ["Arbeitsort"]);
    await ai.draftRejectionMessage({ jobTitle: "Software Engineer" });
    await ai.draftInterviewInvitation({
      jobTitle: "Software Engineer",
      suggestedSlots: ["Montag, 10:00"],
    });
    await ai.draftEmployerProfileText({
      companyName: "Beispiel AG",
      industry: "Technologie",
    });

    const jobroom = new MockJobroomProvider({
      now: () => new Date("2026-07-20T12:00:00.000Z"),
    });
    await jobroom.checkReportingObligation({
      occupationCodeId: JOBROOM_FIXTURE_IDS.requiresReporting,
      cantonCode: "ZH",
    });
    await jobroom.submitJob({ title: "Nicht extern senden" });

    const recordedEmailRows: string[] = [];
    const email = new MockEmailProvider({
      record: async (input) => {
        recordedEmailRows.push(input.templateKey);
        return {
          id: "11111111-1111-4111-8111-111111111111",
          created: true,
        };
      },
    });
    await email.send({
      to: "candidate@example.test",
      templateKey: "registration_welcome",
      data: { firstName: "Mara" },
      subject: "Willkommen bei SwissTalentHub",
    });
    expect(recordedEmailRows).toEqual(["registration_welcome"]);

    await expect(
      new StripePaymentProvider().createCheckout({
        orderId: "provider-network-contract-order",
        idempotencyKey: "provider-network-contract-stripe",
        successUrl: "/billing/success",
        cancelUrl: "/billing/cancel",
      }),
    ).rejects.toMatchObject({ code: "STRIPE_PROVIDER_NOT_IMPLEMENTED" });
    await expect(
      new OpenAiAiProvider().improveJobText("Nicht extern senden"),
    ).rejects.toThrow(/Mock-MVP nicht verfügbar/);

    expect(deniedFetch).not.toHaveBeenCalled();
    for (const transportSpy of transportSpies) {
      expect(transportSpy).not.toHaveBeenCalled();
    }
  });

  it("contains no direct external transport import or real-provider endpoint", () => {
    const sourceRoot = join(process.cwd(), "lib", "providers");
    const sources = listTypeScriptFiles(sourceRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(
      /(?:from|import\s*)\s*\(?["']node:(?:http|https|net|tls)["']/u,
    );
    expect(sources).not.toMatch(/\bfetch\s*\(/u);
    expect(sources).not.toMatch(
      /(?:api\.openai\.com|api\.stripe\.com|hooks\.stripe\.com)/iu,
    );
  });
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}
