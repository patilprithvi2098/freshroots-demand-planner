// ISO 8601 week helpers. Pure, UTC-only, no I/O. Supports 53-week years.

const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

export interface IsoWeek {
  year: number;
  week: number;
}

function parseDate(date: string): Date {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Number of ISO weeks in a year (52 or 53). */
export function weeksInIsoYear(year: number): number {
  // A year has 53 weeks when Dec 28 falls in week 53.
  return isoWeekOfDate(`${year}-12-28`).week;
}

export function isValidIsoWeek(text: string): boolean {
  const m = ISO_WEEK_RE.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const week = Number(m[2]);
  return week >= 1 && week <= weeksInIsoYear(year);
}

export function parseIsoWeek(text: string): IsoWeek {
  const m = ISO_WEEK_RE.exec(text);
  if (!m || !isValidIsoWeek(text)) throw new Error(`Malformed ISO week: ${text}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

export function formatIsoWeek({ year, week }: IsoWeek): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function isoWeekOfDate(date: string): IsoWeek {
  const d = parseDate(date);
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  const thursday = new Date(d.getTime() + (4 - day) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return { year, week };
}

/** Monday of the given ISO week, as YYYY-MM-DD. */
export function mondayOfIsoWeek(w: IsoWeek | string): string {
  const { year, week } = typeof w === "string" ? parseIsoWeek(w) : w;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = jan4.getTime() - (jan4Day - 1) * DAY_MS;
  return formatDate(new Date(week1Monday + (week - 1) * 7 * DAY_MS));
}

export function sundayOfIsoWeek(w: IsoWeek | string): string {
  return formatDate(new Date(parseDate(mondayOfIsoWeek(w)).getTime() + 6 * DAY_MS));
}

export function addIsoWeeks(w: string, n: number): string {
  const monday = parseDate(mondayOfIsoWeek(w));
  const shifted = formatDate(new Date(monday.getTime() + n * 7 * DAY_MS));
  return formatIsoWeek(isoWeekOfDate(shifted));
}

/** Compare two ISO week strings. Works because the format is zero-padded. */
export function compareIsoWeeks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The most recent ISO week that is complete on the as-of date
 * (its Sunday is on or before the as-of date).
 */
export function lastCompleteWeek(asOfDate: string): string {
  const current = formatIsoWeek(isoWeekOfDate(asOfDate));
  return sundayOfIsoWeek(current) <= asOfDate ? current : addIsoWeeks(current, -1);
}

/** The n ISO weeks ending at (and including) endWeek, oldest first. */
export function weekWindow(endWeek: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addIsoWeeks(endWeek, -i));
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}
