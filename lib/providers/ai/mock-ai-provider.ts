import type { AiProvider } from "./ai-provider";

const TERMINAL_PUNCTUATION = /[.!?…]$/u;
const INCLUSIVE_REWRITES = Object.freeze([
  [/(?:Mitarbeiterinnen\s+und\s+Mitarbeiter|Mitarbeiter\/?innen|Mitarbeiter\/in|Mitarbeiter)\b/giu, "Mitarbeitende"],
  [/(?:Bewerberinnen\s+und\s+Bewerber|Bewerber\/?innen|Bewerber\/in|Bewerber)\b/giu, "Bewerbende"],
  [/(?:Kandidatinnen\s+und\s+Kandidaten|Kandidat\/?innen|Kandidat\/in|Kandidaten)\b/giu, "Kandidierende"],
  [/(?:Ansprechpartnerinnen\s+und\s+Ansprechpartner|Ansprechpartner\/?innen|Ansprechpartner\/in|Ansprechpartner)\b/giu, "Ansprechpersonen"],
] as const);

/**
 * A local, deterministic copy helper. It performs no I/O and deliberately
 * avoids inventing facts about a job, a candidate, or an employer.
 */
export class MockAiProvider implements AiProvider {
  async improveJobText(text: string): Promise<string> {
    const normalized = normalizeProse(text);
    if (!normalized) {
      return "";
    }

    const clearer = normalized
      .replace(/^wir suchen (?:eine|einen|ein)\s+/iu, "Offene Position: ")
      .replace(/^wir suchen\s+/iu, "Offene Position: ")
      .replace(/\bdu bist verantwortlich für\b/giu, "Deine Aufgaben umfassen")
      .replace(/\bsie sind verantwortlich für\b/giu, "Ihre Aufgaben umfassen");

    return ensureTerminalPunctuation(capitalizeFirst(clearer));
  }

  async rewriteInclusive(text: string): Promise<string> {
    let rewritten = normalizeProse(text);
    for (const [pattern, replacement] of INCLUSIVE_REWRITES) {
      rewritten = rewritten.replace(pattern, replacement);
    }
    return rewritten;
  }

  async shortenRequirements(text: string): Promise<string> {
    const normalized = normalizeMultiline(text);
    if (!normalized) {
      return "";
    }

    const requirements = normalized
      .split(/\n|(?<=[.!?;])\s+/u)
      .map((item) => item.replace(/^[\s*•\-–—]+/u, ""))
      .map((item) => item.replace(/[;.!?]+$/u, ""))
      .map(removeRequirementFiller)
      .map((item) => item.trim())
      .filter(Boolean);

    const unique = deduplicate(requirements).slice(0, 6);
    return unique.map((item) => `• ${capitalizeFirst(item)}`).join("\n");
  }

  async suggestFairScoreImprovements(job: {
    title: string;
    tasks: string;
    requirements: string;
    offer: string;
    salaryMin?: number;
    salaryMax?: number;
  }): Promise<string[]> {
    const suggestions: string[] = [];
    const title = normalizeProse(job.title);
    const tasks = normalizeProse(job.tasks);
    const requirements = normalizeProse(job.requirements);
    const offer = normalizeProse(job.offer);

    if (title.length < 8) {
      suggestions.push("Formulieren Sie einen eindeutigen, aussagekräftigen Stellentitel.");
    }
    if (tasks.length < 80 || countConcreteItems(job.tasks) < 3) {
      suggestions.push("Beschreiben Sie mindestens drei konkrete Aufgaben mit nachvollziehbaren Verantwortlichkeiten.");
    }
    if (requirements.length < 60 || countConcreteItems(job.requirements) < 3) {
      suggestions.push("Trennen Sie Muss- und Kann-Anforderungen und nennen Sie mindestens drei konkrete Kriterien.");
    }
    if (offer.length < 60 || !containsConcreteBenefit(offer)) {
      suggestions.push("Nennen Sie mindestens zwei konkrete Leistungen oder Arbeitsbedingungen im Angebot.");
    }
    if (!isValidSalaryRange(job.salaryMin, job.salaryMax)) {
      suggestions.push("Veröffentlichen Sie eine vollständige, plausible Lohnspanne mit Mindest- und Höchstwert.");
    }
    if (containsNonInclusiveWording(`${title} ${tasks} ${requirements} ${offer}`)) {
      suggestions.push("Verwenden Sie inklusive Personenbezeichnungen im gesamten Inserat.");
    }

    return suggestions;
  }

  async explainMatch(reasons: string[], missing: string[]): Promise<string> {
    const matched = cleanList(reasons);
    const gaps = cleanList(missing);

    if (matched.length === 0 && gaps.length === 0) {
      return "Für diese Einschätzung liegen noch keine Vergleichsgründe vor. Sie dient nur als Orientierung.";
    }

    const parts: string[] = [];
    if (matched.length > 0) {
      parts.push(`Gute Übereinstimmung: ${matched.join(", ")}.`);
    }
    if (gaps.length > 0) {
      parts.push(`Noch offen: ${gaps.join(", ")}.`);
    }
    parts.push("Die Einschätzung ist eine Orientierung und keine automatische Auswahlentscheidung.");
    return parts.join(" ");
  }

  async draftRejectionMessage(context: { jobTitle: string }): Promise<string> {
    const jobTitle = normalizeInline(context.jobTitle) || "die ausgeschriebene Stelle";
    return [
      `Vielen Dank für Ihr Interesse an „${jobTitle}“ und die Zeit, die Sie in Ihre Bewerbung investiert haben.`,
      "Nach sorgfältiger Prüfung führen wir den Bewerbungsprozess mit anderen Profilen weiter.",
      "Wir wünschen Ihnen für Ihren weiteren Weg alles Gute.",
    ].join("\n\n");
  }

  async draftInterviewInvitation(context: {
    jobTitle: string;
    suggestedSlots: string[];
  }): Promise<string> {
    const jobTitle = normalizeInline(context.jobTitle) || "die ausgeschriebene Stelle";
    const slots = cleanList(context.suggestedSlots);
    const scheduling = slots.length > 0
      ? `Folgende Termine schlagen wir vor:\n${slots.map((slot) => `• ${slot}`).join("\n")}`
      : "Bitte teilen Sie uns mit, welche Termine für Sie gut passen.";

    return [
      `Vielen Dank für Ihre Bewerbung auf „${jobTitle}“. Wir möchten Sie gerne zu einem Gespräch einladen.`,
      scheduling,
      "Bitte bestätigen Sie einen Termin oder senden Sie uns passende Alternativen.",
    ].join("\n\n");
  }

  async draftEmployerProfileText(context: {
    companyName: string;
    industry: string;
    values?: string;
  }): Promise<string> {
    const companyName = normalizeInline(context.companyName) || "Unser Unternehmen";
    const industry = normalizeInline(context.industry);
    const values = normalizeProse(context.values ?? "");
    const introduction = industry
      ? `${companyName} ist in der Branche ${industry} tätig.`
      : `${companyName} stellt sich als Arbeitgeber vor.`;

    if (!values) {
      return `${introduction} Erfahren Sie mehr über unsere Aufgaben, Arbeitsweise und offenen Stellen.`;
    }
    return `${introduction} Unsere Zusammenarbeit orientiert sich an folgenden Werten: ${ensureTerminalPunctuation(values)}`;
  }
}

function normalizeInline(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function normalizeProse(value: string) {
  return normalizeMultiline(value).replace(/\s*\n\s*/gu, " ");
}

function normalizeMultiline(value: string) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function capitalizeFirst(value: string) {
  const characters = Array.from(value);
  const first = characters.shift();
  return first ? `${first.toLocaleUpperCase("de-CH")}${characters.join("")}` : "";
}

function ensureTerminalPunctuation(value: string) {
  return TERMINAL_PUNCTUATION.test(value) ? value : `${value}.`;
}

function removeRequirementFiller(value: string) {
  return value
    .replace(/^wir (?:erwarten|wünschen) (?:von ihnen|uns),?\s*(?:dass sie\s*)?/iu, "")
    .replace(/^(?:sie|du) (?:verfügen|verfügst) über\s+/iu, "")
    .replace(/^idealerweise (?:bringen sie|bringst du)\s+/iu, "")
    .replace(/^von vorteil (?:ist|sind)\s+/iu, "");
}

function deduplicate(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("de-CH");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cleanList(values: string[]) {
  return deduplicate(
    values
      .map(normalizeInline)
      .map((value) => value.replace(/[.!?;:,]+$/u, ""))
      .filter(Boolean),
  );
}

function countConcreteItems(value: string) {
  const multilineItems = normalizeMultiline(value).split("\n").filter(Boolean);
  if (multilineItems.length > 1) {
    return multilineItems.length;
  }
  return normalizeProse(value).split(/[.!?;]+/u).map((item) => item.trim()).filter(Boolean).length;
}

function containsConcreteBenefit(value: string) {
  const normalized = value.toLocaleLowerCase("de-CH");
  const terms = [
    "homeoffice",
    "home-office",
    "ferien",
    "weiterbildung",
    "vorsorge",
    "arbeitszeit",
    "öV",
    "mobilität",
    "bonus",
    "elternzeit",
  ];
  return terms.filter((term) => normalized.includes(term.toLocaleLowerCase("de-CH"))).length >= 2;
}

function isValidSalaryRange(minimum: number | undefined, maximum: number | undefined) {
  return Number.isSafeInteger(minimum) &&
    Number.isSafeInteger(maximum) &&
    (minimum ?? 0) > 0 &&
    (maximum ?? 0) >= (minimum ?? Number.POSITIVE_INFINITY);
}

function containsNonInclusiveWording(value: string) {
  return INCLUSIVE_REWRITES.some(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}
