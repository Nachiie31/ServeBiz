export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV cell. Quotes are added only when needed.
 * Text that starts with = + - @ (or a tab/CR) would be run as a formula by Excel and Google Sheets,
 * so it gets a leading apostrophe. Real numbers are left alone so negatives stay negative.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text with a UTF-8 byte order mark, so Excel shows accents and currency symbols correctly. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
