const BLOCKED_BLOCKS = /<(script|style|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const TAG = /<[^>]*>/gu;
const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu;

function decodeEntity(entity: string): string {
  const normalized = entity.toLowerCase();
  const named: Readonly<Record<string, string>> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  };
  if (named[normalized] !== undefined) return named[normalized];
  const hexadecimal = normalized.startsWith("&#x");
  const raw = normalized.slice(hexadecimal ? 3 : 2, -1);
  const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10);
  return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

/** Converts untrusted rich text to normalized plain text. */
export function stripUnsafeHtml(value: string): string {
  return value
    .replace(BLOCKED_BLOCKS, " ")
    .replace(TAG, " ")
    .replace(ENTITY, decodeEntity)
    .replace(/\s+/gu, " ")
    .trim();
}
