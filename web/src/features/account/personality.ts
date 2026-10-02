/**
 * tau's voice on the account page. Everything here is a pure function of the
 * activity numbers, so it's testable and the page component stays about layout.
 *
 * Tone: warm, a little cosmic, never smug. A light week gets encouragement, not
 * a guilt trip.
 */
import type { Activity, ActivityDay } from "./profile";

export interface Persona {
  emoji: string;
  title: string;
  line: string;
}

/** Below this, hour/weekday shares are noise, not a personality. */
const MIN_BUILDS_FOR_HABITS = 10;

function share(counts: number[], indices: number[], total: number): number {
  if (total === 0) return 0;
  return indices.reduce((sum, i) => sum + (counts[i] ?? 0), 0) / total;
}

/** First match wins; the order is "most specific and most fun" first. */
export function personaFor(a: Activity): Persona {
  const { builds, ships, projects } = a.totals;

  if (builds === 0 && projects === 0) {
    return {
      emoji: "🛰️",
      title: "Fresh off the launchpad",
      line: "No builds yet. The whole sky's open.",
    };
  }
  if (builds < 5) {
    return {
      emoji: "🌱",
      title: "Just getting started",
      line: "A few sparks so far. Plenty of sky left.",
    };
  }

  if (builds >= MIN_BUILDS_FOR_HABITS) {
    const night = share(a.hours, [22, 23, 0, 1, 2, 3], builds);
    const dawn = share(a.hours, [5, 6, 7, 8], builds);
    const weekend = share(a.weekdays, [0, 6], builds);

    if (night > 0.5) {
      return {
        emoji: "🦉",
        title: "Night owl",
        line: `${pct(night)} of your builds happen after 10pm. The stars approve.`,
      };
    }
    if (dawn > 0.5) {
      return {
        emoji: "🌅",
        title: "Early bird",
        line: "You build before most people finish their coffee.",
      };
    }
    if (weekend > 0.4) {
      return {
        emoji: "🛋️",
        title: "Weekend warrior",
        line: "Saturdays are for shipping.",
      };
    }
  }

  if (ships >= 3 && ships / builds >= 0.1) {
    return {
      emoji: "🚀",
      title: "Shipper",
      line: `You don't just build, you launch. ${ships} times this year.`,
    };
  }
  if (projects >= 10 && builds / projects < 3) {
    return {
      emoji: "🌌",
      title: "Idea machine",
      line: `${projects} projects started. So many ideas, so little time.`,
    };
  }
  if (a.streak.longest >= 7) {
    return {
      emoji: "🔥",
      title: "Unstoppable",
      line: `A ${a.streak.longest}-day streak. That's not a habit, that's an orbit.`,
    };
  }
  return {
    emoji: "🛠️",
    title: "Builder",
    line: "Steady hands, steady builds.",
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function streakLine(s: Activity["streak"]): string {
  if (s.current === 0) {
    return s.longest === 0
      ? "No streak yet. Today's a fine day to start one."
      : `Streak's cold. One prompt warms it up. (Best: ${plural(s.longest, "day")})`;
  }
  if (!s.activeToday) {
    return `${plural(s.current, "day")} and counting. Build today to keep it alive.`;
  }
  if (s.current === 1) return "Day one. Every orbit starts somewhere.";
  if (s.current >= s.longest) return `${plural(s.current, "day")} in a row. Your best yet.`;
  return `${plural(s.current, "day")} in a row. Don't break the chain.`;
}

export function headline(a: Activity): string {
  const { builds } = a.totals;
  if (builds === 0) return "Your sky is still dark";
  return `${builds.toLocaleString()} ${builds === 1 ? "build" : "builds"} in the last year`;
}

const QUIET_DAYS = [
  "Rest day. Probably deserved.",
  "Quiet skies.",
  "Nothing built. Something dreamed up, surely.",
  "Recharging the thrusters.",
  "A day off from the cosmos.",
  "Touching grass, presumably.",
];

/** Stable per date, so hovering the same empty day always says the same thing. */
export function quietLine(date: string): string {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return QUIET_DAYS[h % QUIET_DAYS.length]!;
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "7 builds · 1 ship" for a day, or a quiet line when there was nothing. */
export function dayDetail(day: ActivityDay | undefined, date: string): string {
  if (!day) return quietLine(date);
  const parts: string[] = [];
  if (day.builds) parts.push(plural(day.builds, "build"));
  if (day.ships) parts.push(plural(day.ships, "ship"));
  if (day.projects) parts.push(plural(day.projects, "new project"));
  return parts.join(" · ");
}

/** Activity intensity, 0–4. Thresholds are this user's own quartiles, so a
 *  light builder still gets a sky with some bright stars in it. */
export function levelScale(days: ActivityDay[]): (count: number) => number {
  const counts = days
    .map((d) => d.builds + d.ships + d.projects)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return () => 0;
  const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))]!;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (count) => {
    if (count <= 0) return 0;
    if (count <= q1) return 1;
    if (count <= q2) return 2;
    if (count <= q3) return 3;
    return 4;
  };
}

export function favouriteHour(hours: number[]): number | null {
  let best = -1;
  let bestCount = 0;
  hours.forEach((c, h) => {
    if (c > bestCount) {
      best = h;
      bestCount = c;
    }
  });
  return best === -1 ? null : best;
}

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** "Orbiting tau since Mar 2026 · day 214". */
export function tenureLine(createdAt: string, now: Date = new Date()): string {
  const since = new Date(createdAt);
  const month = since.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const day = Math.max(1, Math.floor((now.getTime() - since.getTime()) / 86_400_000) + 1);
  return day === 1
    ? `Joined tau today. Welcome aboard.`
    : `Orbiting tau since ${month} · day ${day.toLocaleString()}`;
}

export function nameSavedLine(name: string | null): string {
  return name ? `Nice to meet you, ${name.split(/\s+/)[0]} ✨` : "Back to being mysterious.";
}
