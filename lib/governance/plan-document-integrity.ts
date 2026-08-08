export type PlanDocumentIntegrityFinding = Readonly<{
  code: "TRUNCATION_MARKER" | "MALFORMED_MARKDOWN_TABLE";
  line: number;
  message: string;
}>;

const truncationMarker = /…\s*\d+\s+tokens?\s+truncated\s*…/iu;
const fenceStart = /^\s{0,3}(`{3,}|~{3,})/u;
const tableSeparatorCell = /^:?-{3,}:?$/u;

/**
 * Rejects transport truncation artefacts and malformed GFM-style tables in
 * normative plan Markdown. Fenced examples are ignored; escaped pipes remain
 * cell content, while unescaped pipes (including inside code spans) are table
 * delimiters as required by the repository's Markdown authoring contract.
 */
export function inspectPlanDocumentIntegrity(
  source: string,
): readonly PlanDocumentIntegrityFinding[] {
  const lines = source.split(/\r?\n/u);
  const findings: PlanDocumentIntegrityFinding[] = [];
  const fenced = fencedLineNumbers(lines);

  for (const [index, line] of lines.entries()) {
    if (!fenced.has(index) && truncationMarker.test(line)) {
      findings.push({
        code: "TRUNCATION_MARKER",
        line: index + 1,
        message: "contains a transport truncation marker",
      });
    }
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (fenced.has(index)) continue;
    const separator = parseTableRow(lines[index] ?? "");
    if (
      separator === null ||
      separator.length < 2 ||
      !separator.every((cell) => tableSeparatorCell.test(cell.trim()))
    ) {
      continue;
    }
    const header = parseTableRow(lines[index - 1] ?? "");
    if (header === null || header.length !== separator.length) {
      findings.push({
        code: "MALFORMED_MARKDOWN_TABLE",
        line: index + 1,
        message: `table separator has ${separator.length} cells but its header has ${header?.length ?? 0}`,
      });
    }
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      if (fenced.has(rowIndex)) break;
      const row = parseTableRow(lines[rowIndex] ?? "");
      if (row === null) break;
      if (row.length !== separator.length) {
        findings.push({
          code: "MALFORMED_MARKDOWN_TABLE",
          line: rowIndex + 1,
          message: `table row has ${row.length} cells; expected ${separator.length}`,
        });
      }
    }
  }

  return Object.freeze(findings);
}

function fencedLineNumbers(lines: readonly string[]) {
  const fenced = new Set<number>();
  let closing: Readonly<{ marker: "`" | "~"; length: number }> | null = null;
  for (const [index, line] of lines.entries()) {
    const match = line.match(fenceStart);
    if (closing === null) {
      if (match?.[1] !== undefined) {
        closing = {
          marker: match[1][0] as "`" | "~",
          length: match[1].length,
        };
        fenced.add(index);
      }
      continue;
    }
    fenced.add(index);
    const candidate = line.trimStart();
    if (
      candidate.startsWith(closing.marker.repeat(closing.length)) &&
      !candidate.startsWith(closing.marker.repeat(closing.length + 1))
    ) {
      closing = null;
    }
  }
  return fenced;
}

function parseTableRow(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || trimmed === "|") return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (endsWithUnescapedPipe(body)) body = body.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let delimiterSeen = false;
  for (const character of body) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(cell);
      cell = "";
      delimiterSeen = true;
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return delimiterSeen || trimmed.startsWith("|")
    ? Object.freeze(cells)
    : null;
}

function endsWithUnescapedPipe(value: string) {
  if (!value.endsWith("|")) return false;
  let backslashes = 0;
  for (let index = value.length - 2; index >= 0; index -= 1) {
    if (value[index] !== "\\") break;
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}
