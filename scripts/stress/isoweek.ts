// Independent ISO 8601 week arithmetic for the stress test. Deliberately does NOT import
// lib/rules/isoWeek.ts, so the generator and the oracle cannot inherit a bug from it.
// Weeks are handled as the UTC epoch-ms of their Monday.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Monday (epoch ms, UTC) of an ISO week label like 2026-W53. Throws on a week that does not exist. */
export function mondayMs(label: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error(`bad ISO week ${label}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Week 1 is the week that contains 4 January.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4MonBased = (new Date(jan4).getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const ms = jan4 - jan4MonBased * DAY_MS + (week - 1) * WEEK_MS;
  if (labelOfMs(ms) !== label) throw new Error(`ISO week ${label} does not exist`);
  return ms;
}

/** ISO week label of the week that contains the given instant. */
export function labelOfMs(ms: number): string {
  const monBased = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = ms - monBased * DAY_MS + 3 * DAY_MS; // the Thursday decides the ISO year
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS);
  return `${year}-W${pad2(week)}`;
}

export const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const dateOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday of the week as YYYY-MM-DD. */
export const mondayDate = (label: string) => dateOfMs(mondayMs(label));

/** The label n weeks after (or before, n < 0) the given week. */
export const shiftWeek = (label: string, n: number) => labelOfMs(mondayMs(label) + n * WEEK_MS);

/** Month (YYYY-MM) that the ISO week mostly falls in: the month of its Thursday. */
export const monthOfWeek = (label: string) => dateOfMs(mondayMs(label) + 3 * DAY_MS).slice(0, 7);

/** All week labels from first to last inclusive. */
export function weekRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let ms = mondayMs(first), end = mondayMs(last); ms <= end; ms += WEEK_MS) out.push(labelOfMs(ms));
  return out;
}

/** Last ISO week whose Sunday is on or before the date. */
export function lastCompleteWeekOf(date: string): string {
  const ms = dateMs(date);
  const monBased = (new Date(ms).getUTCDay() + 6) % 7;
  const monday = ms - monBased * DAY_MS;
  return labelOfMs(monBased === 6 ? monday : monday - WEEK_MS);
}
