import { describe, expect, it } from "vitest";

import {
  createJobSlug,
  JOB_SLUG_MAX_LENGTH,
} from "@/lib/jobs/slug";

const JOB_ID = "12345678-90ab-4cde-8f01-234567890abc";

describe("Job slug factory", () => {
  it("combines the transliterated title, company short reference and Job id", () => {
    expect(createJobSlug({
      title: "Senior Ärztin / Pflege",
      companyShortRef: "Müller & Söhne AG",
      jobId: JOB_ID,
    })).toBe("senior-aerztin-pflege-mueller-soehne-ag-1234567890ab");
  });

  it("is deterministic and gives different Jobs different stable suffixes", () => {
    const input = {
      title: "Platform Engineer",
      companyShortRef: "Beispiel AG",
      jobId: JOB_ID,
    } as const;
    const slug = createJobSlug(input);

    expect(createJobSlug(input)).toBe(slug);
    expect(createJobSlug({
      ...input,
      jobId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
    })).not.toBe(slug);
  });

  it("caps long values without cutting off the company and id suffix", () => {
    const slug = createJobSlug({
      title: `${"Sehr lange Stellenbezeichnung ".repeat(20)}Ende`,
      companyShortRef: "Ausserordentlich lange Unternehmensreferenz AG",
      jobId: JOB_ID,
    });

    expect(slug).toHaveLength(JOB_SLUG_MAX_LENGTH);
    expect(slug).toMatch(/-ausserordentlich-lange-u-1234567890ab$/u);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  });

  it("rejects inputs that cannot produce every required segment", () => {
    expect(() => createJobSlug({
      title: "---",
      companyShortRef: "Beispiel AG",
      jobId: JOB_ID,
    })).toThrow(TypeError);
    expect(() => createJobSlug({
      title: "Engineer",
      companyShortRef: "---",
      jobId: JOB_ID,
    })).toThrow(TypeError);
    expect(() => createJobSlug({
      title: "Engineer",
      companyShortRef: "Beispiel AG",
      jobId: "short",
    })).toThrow(TypeError);
  });
});
