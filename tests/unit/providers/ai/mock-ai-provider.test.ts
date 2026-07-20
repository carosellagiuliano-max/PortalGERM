import { aiProvider, MockAiProvider } from "@/lib/providers/ai";
import {
  OPENAI_AI_PROVIDER_UNAVAILABLE,
  OpenAiAiProvider,
} from "@/lib/providers/ai/openai-ai-provider";
import { describe, expect, it, vi } from "vitest";

describe("MockAiProvider", () => {
  it("is selected explicitly by the composition root", () => {
    expect(aiProvider).toBeInstanceOf(MockAiProvider);
  });

  it("improves text deterministically without inventing job facts", async () => {
    const provider = new MockAiProvider();
    const input = "  wir   suchen einen Junior Entwickler …  ";

    await expect(provider.improveJobText(input)).resolves.toBe(
      "Offene Position: Junior Entwickler …",
    );
    await expect(provider.improveJobText(input)).resolves.toBe(
      "Offene Position: Junior Entwickler …",
    );
    await expect(provider.improveJobText("  \n ")).resolves.toBe("");
  });

  it("rewrites known person labels inclusively and leaves other content intact", async () => {
    const provider = new MockAiProvider();

    await expect(
      provider.rewriteInclusive(
        "Wir suchen Mitarbeiter und Bewerberinnen und Bewerber für Zürich.",
      ),
    ).resolves.toBe("Wir suchen Mitarbeitende und Bewerbende für Zürich.");
  });

  it("shortens, de-duplicates, and caps requirements with stable bullets", async () => {
    const provider = new MockAiProvider();
    const requirements = [
      "- Sie verfügen über TypeScript Erfahrung.",
      "- Sie verfügen über TypeScript Erfahrung.",
      "- Idealerweise bringen Sie Deutsch B2 mit;",
      "- Teamfähigkeit.",
      "- Git-Kenntnisse.",
      "- Erfahrung mit PostgreSQL.",
      "- Kenntnisse in Testing.",
      "- Diese siebte Anforderung wird abgeschnitten.",
    ].join("\n");

    await expect(provider.shortenRequirements(requirements)).resolves.toBe(
      [
        "• TypeScript Erfahrung",
        "• Deutsch B2 mit",
        "• Teamfähigkeit",
        "• Git-Kenntnisse",
        "• Erfahrung mit PostgreSQL",
        "• Kenntnisse in Testing",
      ].join("\n"),
    );
  });

  it("suggests only evidence-based improvements in a fixed order", async () => {
    const provider = new MockAiProvider();

    await expect(
      provider.suggestFairScoreImprovements({
        title: "Dev",
        tasks: "Code schreiben",
        requirements: "Mitarbeiter mit Erfahrung",
        offer: "Gutes Team",
      }),
    ).resolves.toEqual([
      "Formulieren Sie einen eindeutigen, aussagekräftigen Stellentitel.",
      "Beschreiben Sie mindestens drei konkrete Aufgaben mit nachvollziehbaren Verantwortlichkeiten.",
      "Trennen Sie Muss- und Kann-Anforderungen und nennen Sie mindestens drei konkrete Kriterien.",
      "Nennen Sie mindestens zwei konkrete Leistungen oder Arbeitsbedingungen im Angebot.",
      "Veröffentlichen Sie eine vollständige, plausible Lohnspanne mit Mindest- und Höchstwert.",
      "Verwenden Sie inklusive Personenbezeichnungen im gesamten Inserat.",
    ]);

    await expect(
      provider.suggestFairScoreImprovements({
        title: "Senior Software Engineer",
        tasks: [
          "Sie planen wartbare Services für unsere Plattform.",
          "Sie prüfen Änderungen gemeinsam mit dem Entwicklungsteam.",
          "Sie dokumentieren technische Entscheidungen nachvollziehbar.",
        ].join("\n"),
        requirements: [
          "Mehrjährige Erfahrung mit TypeScript und Node.js.",
          "Sicherer Umgang mit PostgreSQL und automatisierten Tests.",
          "Deutschkenntnisse mindestens auf Niveau B2.",
        ].join("\n"),
        offer: "Wir bieten zwei Homeoffice-Tage, fünf Wochen Ferien und ein jährliches Weiterbildungsbudget.",
        salaryMin: 110_000,
        salaryMax: 130_000,
      }),
    ).resolves.toEqual([]);
  });

  it("drafts stable match, application, interview, and employer copy", async () => {
    const provider = new MockAiProvider();

    await expect(
      provider.explainMatch(
        ["TypeScript passt.", "Region Zürich"],
        ["Lohnvorstellung offen"],
      ),
    ).resolves.toBe(
      "Gute Übereinstimmung: TypeScript passt, Region Zürich. Noch offen: Lohnvorstellung offen. Die Einschätzung ist eine Orientierung und keine automatische Auswahlentscheidung.",
    );
    await expect(
      provider.draftRejectionMessage({ jobTitle: "Backend Engineer" }),
    ).resolves.toContain("„Backend Engineer“");
    await expect(
      provider.draftInterviewInvitation({
        jobTitle: "Backend Engineer",
        suggestedSlots: ["Dienstag, 10:00", "Dienstag, 10:00", "Freitag, 14:00"],
      }),
    ).resolves.toContain("• Dienstag, 10:00\n• Freitag, 14:00");
    await expect(
      provider.draftEmployerProfileText({
        companyName: "Beispiel AG",
        industry: "Gesundheit",
        values: "Verantwortung, Transparenz und Zusammenarbeit",
      }),
    ).resolves.toBe(
      "Beispiel AG ist in der Branche Gesundheit tätig. Unsere Zusammenarbeit orientiert sich an folgenden Werten: Verantwortung, Transparenz und Zusammenarbeit.",
    );
  });

  it("performs no HTTP request and writes no content to console", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log");
    const infoSpy = vi.spyOn(console, "info");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    const provider = new MockAiProvider();

    await provider.improveJobText("Vertraulicher Inseratetext");
    await provider.explainMatch(["vertraulicher Grund"], ["vertrauliche Lücke"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("OpenAiAiProvider", () => {
  it("is an unwired fail-closed placeholder with no HTTP fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new OpenAiAiProvider();

    await expect(provider.improveJobText("Nicht senden")).rejects.toThrow(
      OPENAI_AI_PROVIDER_UNAVAILABLE,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
