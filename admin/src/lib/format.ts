const intFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 1,284 · 12.9K · 4.2M — compact only once it stops fitting. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.abs(n) >= 10_000 ? compactFmt.format(n) : intFmt.format(Math.round(n * 100) / 100);
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return intFmt.format(Math.round(n));
}

export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function credits(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function money(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : currency === "INR" ? "₹" : "";
  const value = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

/** Seconds → "42s", "3m 12s", "4h 05m", "2d 3h". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

/** ISO/Date → "3m ago" / "in 4m". */
export function ago(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.round((Date.now() - t) / 1000);
  return diff >= 0 ? `${duration(diff)} ago` : `in ${duration(-diff)}`;
}

export function dateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function time(value: string | number | Date): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const shortId = (id: string | null | undefined): string => (id ? id.slice(0, 8) : "—");

export function mb(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`;
}

/** SCREAMING_CASE / snake_case enum → "Screaming case". */
export function label(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.toLowerCase().replace(/[_:]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A byte count as "840 B", "12.4 KB", "10 MB", "1.5 GB". */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
