import { createHash } from "node:crypto";

export type InterviewCalendarInput = Readonly<{
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  issuedAt: Date;
  startsAt: Date;
  endsAt: Date;
  subject: string;
  location?: string | null;
}>;

export function renderInterviewCalendarV1(input: InterviewCalendarInput): string {
  if (
    !/^[A-Za-z0-9._@:-]{8,255}$/u.test(input.uid) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    !validDate(input.issuedAt) ||
    !validDate(input.startsAt) ||
    !validDate(input.endsAt) ||
    input.endsAt <= input.startsAt
  ) {
    throw new TypeError("Interview calendar input is invalid.");
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//SwissTalentHub//Interview Scheduler V1//DE",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${utc(input.issuedAt)}`,
    `DTSTART:${utc(input.startsAt)}`,
    `DTEND:${utc(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.subject, 200)}`,
    ...(input.location == null || input.location.trim() === ""
      ? []
      : [`LOCATION:${escapeIcsText(input.location, 300)}`]),
    ...(input.method === "CANCEL" ? ["STATUS:CANCELLED"] : ["STATUS:CONFIRMED"]),
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

export function hashInterviewCalendarV1(calendar: string): string {
  return createHash("sha256").update(calendar, "utf8").digest("hex");
}

function escapeIcsText(value: string, maximum: number): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .slice(0, maximum)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function utc(value: Date): string {
  return value
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function foldIcsLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 73 && current !== "") {
      result.push(current);
      current = ` ${character}`;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  result.push(current);
  return result;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
