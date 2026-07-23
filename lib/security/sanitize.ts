const BLOCKED_BLOCKS = /<(script|style|iframe|object|embed|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const TAG = /<[^>]*>/gu;
const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu;
const UNSAFE_TEXT_CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function decodeEntity(entity: string): string {
  const normalized = entity.toLowerCase();
  const named: Readonly<Record<string, string>> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  };
  if (named[normalized] !== undefined) return named[normalized];
  const hexadecimal = normalized.startsWith("&#x");
  const raw = normalized.slice(hexadecimal ? 3 : 2, -1);
  const codePoint = Number.parseInt(raw, hexadecimal ? 16 : 10);
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    isUnsafeDecodedCodePoint(codePoint)
  ) {
    return "";
  }
  return String.fromCodePoint(codePoint);
}

function isUnsafeDecodedCodePoint(codePoint: number) {
  return (
    (codePoint >= 0x00 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** Converts untrusted rich text to normalized plain text. */
export function stripUnsafeHtml(value: string): string {
  return value
    .replace(UNSAFE_TEXT_CONTROLS, "")
    .replace(BLOCKED_BLOCKS, " ")
    .replace(TAG, " ")
    .replace(ENTITY, decodeEntity)
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Normalizes untrusted plain text without interpreting angle brackets as HTML.
 *
 * React and the JSON serializers at the output boundary escape this value. The
 * distinction from `stripUnsafeHtml` is intentional: plain-text fields may
 * describe code such as `<script>…</script>` and must render those characters
 * literally instead of silently changing the user's text.
 */
export function sanitizePlainText(value: string): string {
  return value
    .replace(UNSAFE_TEXT_CONTROLS, "")
    .replace(/\s+/gu, " ")
    .trim();
}
