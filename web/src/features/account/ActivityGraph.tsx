import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, FlameIcon, SparklesIcon } from "lucide-react";

import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { APP_HOME } from "@/src/lib/routes";
import { cn } from "@/src/lib/utils";
import { useActivity, type Activity, type ActivityDay } from "./profile";
import {
  dayDetail,
  dayLabel,
  favouriteHour,
  headline,
  hourLabel,
  levelScale,
  streakLine,
} from "./personality";

const WEEKS = 53;
const CELL = 11;
const GAP = 3;

/** Pulsar blue, from a faint glimmer up to a full star. */
const LEVEL_COLORS = [
  "var(--silver-200)",
  "rgb(96 165 250 / 0.22)",
  "rgb(96 165 250 / 0.45)",
  "rgb(96 165 250 / 0.72)",
  "var(--blue-300)",
];

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function monthOf(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

interface Hover {
  date: string;
  x: number;
  y: number;
}

export function ActivityCard() {
  const { data, isLoading, isError } = useActivity();

  if (isLoading) {
    return (
      <div className="flex h-56 items-center justify-center rounded-xl border bg-card">
        <DataSpinner label="Charting your sky" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        Couldn't load your activity. The telescope's foggy, so try again in a bit.
      </div>
    );
  }
  return <ActivityBody activity={data} />;
}

function ActivityBody({ activity }: { activity: Activity }) {
  const navigate = useNavigate();
  const reduceMotion = useReduceMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const byDate = useMemo(
    () => new Map(activity.days.map((d) => [d.date, d])),
    [activity.days],
  );
  const level = useMemo(() => levelScale(activity.days), [activity.days]);

  const weeks = useMemo(() => {
    const cols: string[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const col: string[] = [];
      for (let d = 0; d < 7; d++) col.push(addDays(activity.start, w * 7 + d));
      cols.push(col);
    }
    return cols;
  }, [activity.start]);

  const monthLabels = useMemo(
    () =>
      weeks.map((col, w) => {
        const month = monthOf(col[0]!);
        if (w === 0) {
          // Skip a sliver of a month at the very start so labels don't collide.
          const nextChange = weeks.findIndex(
            (c, i) => i > 0 && monthOf(c[0]!) !== month,
          );
          return nextChange === -1 || nextChange >= 3 ? month : "";
        }
        return monthOf(weeks[w - 1]![0]!) !== month ? month : "";
      }),
    [weeks],
  );

  // Most recent week first in view on narrow screens.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  useEffect(() => {
    if (!hover) return;
    const clear = () => setHover(null);
    window.addEventListener("scroll", clear, true);
    return () => window.removeEventListener("scroll", clear, true);
  }, [hover]);

  const { totals, streak, today } = activity;
  const favHour = favouriteHour(activity.hours);
  const busiest = activity.busiestDay;
  const empty = activity.days.length === 0;
  const gridWidth = WEEKS * CELL + (WEEKS - 1) * GAP;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">{headline(activity)}</h2>
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            streak.current > 0 ? "text-amber-300" : "text-muted-foreground",
          )}
        >
          <FlameIcon className="size-3.5" />
          {streakLine(streak)}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="relative -mx-1 mt-4 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
        onMouseLeave={() => setHover(null)}
      >
        <div
          role="img"
          aria-label={`${headline(activity)}. ${streakLine(streak)}`}
          className="flex w-max gap-2"
        >
          <div
            aria-hidden
            className="grid shrink-0 pt-[18px] text-[10px] leading-none text-muted-foreground"
            style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}
          >
            {DAY_LABELS.map((d, i) => (
              <span key={i} className="flex items-center">
                {d}
              </span>
            ))}
          </div>

          <div style={{ width: gridWidth }}>
            <div
              aria-hidden
              className="mb-[7px] grid h-[11px] text-[10px] leading-none text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${WEEKS}, ${CELL}px)`, columnGap: GAP }}
            >
              {monthLabels.map((m, i) => (
                <span key={i} className="whitespace-nowrap">
                  {m}
                </span>
              ))}
            </div>

            <div
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: `repeat(7, ${CELL}px)`,
                gridAutoColumns: `${CELL}px`,
                gap: GAP,
              }}
            >
              {weeks.flat().map((date) => {
                if (date > today) return <span key={date} aria-hidden />;
                const day = byDate.get(date);
                const lvl = level(day ? day.builds + day.ships + day.projects : 0);
                const isToday = date === today;
                return (
                  <span
                    key={date}
                    aria-hidden
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHover({ date, x: r.left + r.width / 2, y: r.top });
                    }}
                    className={cn(
                      "rounded-[3px] transition-transform duration-150 hover:scale-125",
                      isToday && "outline outline-offset-1 outline-silver-900/80",
                      isToday && !reduceMotion && "activity-today",
                    )}
                    style={{
                      backgroundColor: LEVEL_COLORS[lvl],
                      boxShadow:
                        lvl === 4 ? "0 0 6px rgb(96 165 250 / 0.55)" : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {hover && (
        <DayTooltip
          hover={hover}
          day={byDate.get(hover.date)}
          today={today}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {empty
            ? "A blank canvas. Send tau a prompt and watch this light up."
            : `Builds, ships and new projects, in your local time.`}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          quiet
          {LEVEL_COLORS.map((c, i) => (
            <span
              key={i}
              className="size-[10px] rounded-[3px]"
              style={{
                backgroundColor: c,
                boxShadow: i === 4 ? "0 0 6px rgb(96 165 250 / 0.55)" : undefined,
              }}
            />
          ))}
          supernova
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
        {[
          { label: "Builds", value: totals.builds },
          { label: "Ships", value: totals.ships },
          { label: "New projects", value: totals.projects },
          { label: "Best streak", value: streak.longest, suffix: streak.longest === 1 ? "day" : "days" },
        ].map(({ label, value, suffix }) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-medium tabular-nums">
              {value.toLocaleString()}
              {suffix && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {suffix}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {(busiest || favHour !== null) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {busiest && (
            <span>
              Busiest day:{" "}
              <span className="text-foreground">{dayLabel(busiest.date, today)}</span>
              {" · "}
              {dayDetail(byDate.get(busiest.date), busiest.date)}
            </span>
          )}
          {favHour !== null && (
            <span>
              Favourite hour:{" "}
              <span className="text-foreground">{hourLabel(favHour)}</span>
            </span>
          )}
        </div>
      )}

      {!streak.activeToday && (
        <button
          type="button"
          onClick={() => void navigate(APP_HOME)}
          className="group mt-4 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-silver-400/30 px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-[color:var(--blue-500)]/50 hover:text-foreground"
        >
          <SparklesIcon className="size-3.5 shrink-0 text-[color:var(--blue-500)]" />
          {streak.current > 0
            ? "Today's square is still dark. One build keeps the streak alive."
            : "Today's square is still dark. Go make something."}
          <ArrowRightIcon className="ml-auto size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
}

function DayTooltip({
  hover,
  day,
  today,
}: {
  hover: Hover;
  day: ActivityDay | undefined;
  today: string;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background shadow-lg"
      style={{ left: hover.x, top: hover.y - 6 }}
    >
      <span className="font-medium">{dayLabel(hover.date, today)}</span>
      <span className="opacity-70"> · {dayDetail(day, hover.date)}</span>
    </div>
  );
}
