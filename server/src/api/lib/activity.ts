/**
 * The account page's activity graph, built from raw timestamps.
 *
 * Bucketing happens here rather than in SQL so the user's time zone is applied
 * by the same Intl data the browser uses (a build at 11pm in Kolkata lands on
 * the Kolkata day), and so the whole thing is a pure function under test. A
 * year of one person's activity is at most a few thousand timestamps.
 */

/** 53 columns, so the grid always shows a full year plus the current week. */
export const ACTIVITY_WEEKS = 53;

export interface ActivityDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  builds: number;
  ships: number;
  projects: number;
}

export interface Activity {
  timeZone: string;
  /** First cell of the grid: always a Sunday. */
  start: string;
  /** Today, in `timeZone`. The grid ends on this week's Saturday. */
  today: string;
  /** Sparse: only days with something on them, ascending. */
  days: ActivityDay[];
  totals: { builds: number; ships: number; projects: number; activeDays: number };
  streak: {
    current: number;
    longest: number;
    /** False while today is still empty. The streak is still alive until midnight. */
    activeToday: boolean;
  };
  /** Builds per local hour, 0–23. */
  hours: number[];
  /** Builds per local weekday, 0 = Sunday. */
  weekdays: number[];
  busiestDay: { date: string; count: number } | null;
}

export interface ActivityInput {
  builds: Date[];
  ships: Date[];
  projects: Date[];
  now: Date;
  timeZone: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The local date and hour of an instant in `timeZone`. */
export function localParts(
  at: Date,
  timeZone: string,
): { date: string; hour: number } {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) {
    parts[p.type] = p.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
  };
}

/** Day arithmetic on YYYY-MM-DD strings, done in UTC so DST can't skew it. */
export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The earliest instant that can possibly fall inside the grid, for the query. */
export function activityWindowStart(now: Date): Date {
  // A full grid back from now, plus a day of slack for any time zone offset.
  return new Date(now.getTime() - (ACTIVITY_WEEKS * 7 + 1) * 86_400_000);
}

export function buildActivity(input: ActivityInput): Activity {
  const { timeZone } = input;
  const today = localParts(input.now, timeZone).date;
  const start = addDays(today, -(ACTIVITY_WEEKS - 1) * 7 - weekdayOf(today));

  const byDate = new Map<string, ActivityDay>();
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);

  const bump = (
    at: Date,
    field: "builds" | "ships" | "projects",
  ): void => {
    const { date, hour } = localParts(at, timeZone);
    if (date < start || date > today) return;
    let day = byDate.get(date);
    if (!day) {
      day = { date, builds: 0, ships: 0, projects: 0 };
      byDate.set(date, day);
    }
    day[field] += 1;
    if (field === "builds") {
      hours[hour] = (hours[hour] ?? 0) + 1;
      const weekday = weekdayOf(date);
      weekdays[weekday] = (weekdays[weekday] ?? 0) + 1;
    }
  };

  for (const at of input.builds) bump(at, "builds");
  for (const at of input.ships) bump(at, "ships");
  for (const at of input.projects) bump(at, "projects");

  const days = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  const totals = { builds: 0, ships: 0, projects: 0, activeDays: days.length };
  let busiestDay: Activity["busiestDay"] = null;
  for (const d of days) {
    totals.builds += d.builds;
    totals.ships += d.ships;
    totals.projects += d.projects;
    const count = d.builds + d.ships + d.projects;
    if (!busiestDay || count > busiestDay.count) {
      busiestDay = { date: d.date, count };
    }
  }

  // Longest run of consecutive active days inside the window.
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev !== null && addDays(prev, 1) === d.date ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d.date;
  }

  // Current streak counts back from today, or from yesterday while today is
  // still empty: an unbroken chain shouldn't read as zero at breakfast.
  const activeToday = byDate.has(today);
  let current = 0;
  let cursor = activeToday ? today : addDays(today, -1);
  while (byDate.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    timeZone,
    start,
    today,
    days,
    totals,
    streak: { current, longest, activeToday },
    hours,
    weekdays,
    busiestDay,
  };
}
