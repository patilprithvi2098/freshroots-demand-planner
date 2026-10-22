// CSV export with spreadsheet formula-injection protection.

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escape one cell: neutralise leading formula characters, then quote per RFC 4180. */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
