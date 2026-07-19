const GERMAN_TRANSLITERATION: Readonly<Record<string, string>> = Object.freeze({
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
});

export function slugify(value: string): string {
  const transliterated = Array.from(value, (character) =>
    GERMAN_TRANSLITERATION[character] ?? character
  ).join("");

  return transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Returns the first deterministic, unoccupied `slug`, `slug-2`, ... value. */
export function deduplicateSlug(
  slug: string,
  occupiedSlugs: Iterable<string>,
): string {
  const base = slugify(slug);
  if (base.length === 0) {
    throw new TypeError("A slug must contain at least one letter or digit.");
  }

  const occupied = new Set(
    Array.from(occupiedSlugs, (candidate) => candidate.trim().toLowerCase()),
  );
  if (!occupied.has(base)) {
    return base;
  }

  let suffix = 2;
  while (occupied.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}
